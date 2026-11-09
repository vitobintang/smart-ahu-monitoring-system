import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { randomId } from "@/lib/ids";
import { db } from "@/db";
import { ahus, sensorThresholds, telemetry, trendAlerts } from "@/db/schema";
import { PARAM_KEYS, PARAM_MAP, type ParamKey } from "@/lib/domain";
import { publishRealtime } from "@/lib/realtime";
import { tryGetAhuRtdb } from "@/lib/rtdb/live-read";
import { readTelemetryRange } from "@/lib/rtdb/history";
import { readRtdbAhu, readRtdbAhus, readRtdbThresholds, thresholdToRow } from "@/lib/rtdb/registry";
import { writeRtdbTrendAlert, type RtdbTrendRecord } from "@/lib/rtdb/trends";
import { mirrorToRtdb } from "@/lib/rtdb/live-read";
import { writeAudit } from "@/lib/auth";
import { authoritativeTelemetry } from "@/lib/source";

type Client = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/* ------------------------------------------------------------------ */
/* FR-16 / FR-17: Trend Proximity Estimation                          */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* FR-16 / FR-17: Trend Proximity Estimation                          */
/* ------------------------------------------------------------------ */

export interface TrendAnalysis {
  parameter: ParamKey;
  label: string;
  unit: string;
  limitType: "HIGH" | "LOW" | null;
  limit: number | null;
  direction: "RISING" | "FALLING" | "FLAT";
  sampleCount: number;
  spanMin: number;
  sufficient: boolean;
  isReliable: boolean;
  unreliabilityReason: string | null;
  slopePerMin: number;
  r2: number;
  residualStd: number;
  currentValue: number | null;
  projectedValue: number | null;
  minutesToBreach: number | null;
  horizon: 15 | 30 | null;
  series: { t: number; v: number }[];
  projection: { t: number; v: number }[];
}

const MIN_SAMPLES = 8;
const MIN_SPAN_MIN = 5;
const MIN_R2 = 0.35;

export function computeTrendAnalyses(
  thresholds: Array<{
    parameter: string;
    trendEnabled: boolean;
    highLimit: number | null;
    lowLimit: number | null;
  }>,
  rows: Array<Record<string, unknown>>,
  now = new Date(),
): TrendAnalysis[] {
  const out: TrendAnalysis[] = [];
  for (const th of thresholds) {
    if (!th.trendEnabled) continue;
    const key = th.parameter as ParamKey;
    if (!PARAM_KEYS.includes(key)) continue;
    const meta = PARAM_MAP[key];
    const points = rows
      .map((r) => ({
        t: new Date(r.timestamp as string | number | Date).getTime(),
        v: r[key] as number | null | undefined,
      }))
      .filter(
        (p): p is { t: number; v: number } =>
          Number.isFinite(p.t) && typeof p.v === "number" && Number.isFinite(p.v),
      );

    const spanMin = points.length > 1 ? (points[points.length - 1].t - points[0].t) / 60000 : 0;
    const sufficient = points.length >= MIN_SAMPLES && spanMin >= MIN_SPAN_MIN;

    let slope = 0;
    let intercept = 0;
    let r2 = 0;
    let residualStd = 0;
    if (points.length >= 2) {
      const n = points.length;
      const sx = points.reduce((a, p) => a + p.t, 0);
      const sy = points.reduce((a, p) => a + p.v, 0);
      const sxx = points.reduce((a, p) => a + p.t * p.t, 0);
      const sxy = points.reduce((a, p) => a + p.t * p.v, 0);
      const denom = n * sxx - sx * sx;
      slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
      intercept = (sy - slope * sx) / n;
      const meanY = sy / n;
      const ssTot = points.reduce((a, p) => a + (p.v - meanY) ** 2, 0);
      const ssRes = points.reduce((a, p) => a + (p.v - (slope * p.t + intercept)) ** 2, 0);
      r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
      residualStd = Math.sqrt(ssRes / Math.max(1, n - 2));
    }
    const slopePerMin = slope * 60000;
    const lastT = points.length > 0 ? points[points.length - 1].t : now.getTime();
    const currentValue = points.length > 0 ? points[points.length - 1].v : null;

    let limitType: "HIGH" | "LOW" | null = null;
    let limit: number | null = null;
    if (slopePerMin > 1e-9 && th.highLimit !== null) {
      limitType = "HIGH";
      limit = th.highLimit;
    } else if (slopePerMin < -1e-9 && th.lowLimit !== null) {
      limitType = "LOW";
      limit = th.lowLimit;
    }

    let minutesToBreach: number | null = null;
    let projectedValue: number | null = null;
    let horizon: 15 | 30 | null = null;
    if (limit !== null && currentValue !== null && Math.abs(slopePerMin) > 1e-9) {
      const distance = limitType === "HIGH" ? limit - currentValue : currentValue - limit;
      const rate = Math.abs(slopePerMin);
      if (distance > 0) {
        const m = distance / rate;
        minutesToBreach = m;
        if (m <= 30) horizon = m <= 15 ? 15 : 30;
      } else {
        minutesToBreach = 0;
        horizon = 15;
      }
      projectedValue = currentValue + slopePerMin * (horizon ?? 30);
    } else if (currentValue !== null) {
      projectedValue = currentValue + slopePerMin * 30;
    }

    const direction: TrendAnalysis["direction"] =
      slopePerMin > 1e-6 ? "RISING" : slopePerMin < -1e-6 ? "FALLING" : "FLAT";

    let isReliable = sufficient && r2 >= MIN_R2;
    let reason: string | null = null;
    if (!sufficient) {
      isReliable = false;
      reason =
        points.length < MIN_SAMPLES
          ? `Insufficient data: ${points.length}/${MIN_SAMPLES} samples`
          : `Insufficient history: ${spanMin.toFixed(1)} min span (< ${MIN_SPAN_MIN} min)`;
    } else if (r2 < MIN_R2) {
      isReliable = false;
      reason = `Variance too high: R² ${r2.toFixed(2)} < ${MIN_R2} (residual σ ${residualStd.toFixed(2)})`;
    }

    out.push({
      parameter: key,
      label: meta.label,
      unit: meta.unit,
      limitType,
      limit,
      direction,
      sampleCount: points.length,
      spanMin: Number(spanMin.toFixed(1)),
      sufficient,
      isReliable,
      unreliabilityReason: reason,
      slopePerMin: Number(slopePerMin.toFixed(4)),
      r2: Number(r2.toFixed(3)),
      residualStd: Number(residualStd.toFixed(3)),
      currentValue: currentValue === null ? null : Number(currentValue.toFixed(meta.decimals)),
      projectedValue: projectedValue === null ? null : Number(projectedValue.toFixed(meta.decimals)),
      minutesToBreach: minutesToBreach === null ? null : Number(minutesToBreach.toFixed(1)),
      horizon,
      series: points.map((p) => ({ t: p.t, v: Number(p.v.toFixed(meta.decimals)) })),
      projection:
        currentValue !== null && horizon
          ? [
              { t: lastT, v: Number(currentValue.toFixed(meta.decimals)) },
              { t: lastT + horizon * 60000, v: Number((currentValue + slopePerMin * horizon).toFixed(meta.decimals)) },
            ]
          : [],
    });
  }
  return out;
}


/** Maps an RTDB telemetry record onto the PG trend-projection row shape. */
function rtdbSampleRow(s: import("@/lib/rtdb/telemetry").RtdbTelemetryRecord, wanted: Set<string>): Record<string, unknown> {
  const row: Record<string, unknown> = { timestamp: new Date(s.timestamp) };
  for (const key of PARAM_KEYS) {
    if (!wanted.has(key)) continue;
    if (key === "current") row[key] = s.isCurrentFallback ? null : s.current;
    else if (key === "voltage") row[key] = s.isVoltageFallback ? null : s.voltage;
    else row[key] = s[key as keyof typeof s] ?? null;
  }
  return row;
}

export async function analyseTrends(
  ahuId: string,
  now = new Date(),
  exec: Client = db,
): Promise<TrendAnalysis[]> {
  // Phase 5b primary flip: registry + thresholds + the 45-minute sample
  // window all read from RTDB when Firebase is configured; PostgreSQL below.
  try {
    const rtdb = await tryGetAhuRtdb();
    if (rtdb) {
      const [ahuRecord, rtdbThresholds] = await Promise.all([
        readRtdbAhu(rtdb, ahuId),
        readRtdbThresholds(rtdb, ahuId),
      ]);
      const wantedRtdb = new Set(rtdbThresholds.filter((t) => t.trendEnabled).map((t) => t.parameter));
      if (ahuRecord && wantedRtdb.size > 0) {
        const sinceRtdb = now.getTime() - 45 * 60 * 1000;
        const samples = await readTelemetryRange(rtdb, ahuId, sinceRtdb, now.getTime());
        const rows = samples.map((s) => rtdbSampleRow(s, wantedRtdb));
        const mapped = rtdbThresholds
          .filter((t) => t.trendEnabled)
          .map((t) => thresholdToRow(t) as unknown as typeof sensorThresholds.$inferSelect);
        return computeTrendAnalyses(mapped, rows, now);
      }
      if (ahuRecord && wantedRtdb.size === 0) return [];
    }
  } catch (err) {
    console.error("[trends] RTDB reads failed, using PostgreSQL:", err instanceof Error ? err.message : err);
  }

  const [ahuRows, thresholds] = await Promise.all([
    exec.select().from(ahus).where(eq(ahus.id, ahuId)).limit(1),
    exec
      .select()
      .from(sensorThresholds)
      .where(and(eq(sensorThresholds.ahuId, ahuId), eq(sensorThresholds.trendEnabled, true))),
  ]);
  if (!ahuRows[0] || thresholds.length === 0) return [];

  const since = new Date(now.getTime() - 45 * 60 * 1000);
  const wanted = new Set(thresholds.map((t) => t.parameter));
  const projection: Record<string, unknown> = { timestamp: telemetry.timestamp };
  for (const key of PARAM_KEYS) {
    if (wanted.has(key)) {
      projection[key] =
        key === "current"
          ? sql`case when ${telemetry.isCurrentFallback} then null else ${telemetry.current} end`.as("current")
          : key === "voltage"
            ? sql`case when ${telemetry.isVoltageFallback} then null else ${telemetry.voltage} end`.as("voltage")
            : telemetry[key];
    }
  }
  const rows = (await exec
    .select(projection as never)
    .from(telemetry)
    .where(and(eq(telemetry.ahuId, ahuId), gt(telemetry.timestamp, since), authoritativeTelemetry()))
    .orderBy(telemetry.timestamp)) as unknown as Array<Record<string, unknown>>;

  return computeTrendAnalyses(thresholds, rows, now);
}

/** Batched fleet trend analysis in a single parallel DB round-trip. */
export async function analyseTrendsBatch(
  ahuIds?: string[],
  now = new Date(),
): Promise<Record<string, TrendAnalysis[]>> {
  // Phase 5b primary flip: the fleet batch reads registry, thresholds and
  // sample windows from RTDB when Firebase is configured.
  try {
    const rtdb = await tryGetAhuRtdb();
    if (rtdb) {
      const registry = await readRtdbAhus(rtdb);
      const filtered = ahuIds && ahuIds.length > 0 ? ahuIds.filter((id) => registry.has(id)) : [...registry.keys()];
      const idsRtdb = filtered.sort();
      const allRtdbThresholds = (await readRtdbThresholds(rtdb)).filter((t) => t.trendEnabled && idsRtdb.includes(t.ahuId));
      const outRtdb: Record<string, TrendAnalysis[]> = {};
      for (const id of idsRtdb) outRtdb[id] = [];
      if (idsRtdb.length > 0 && allRtdbThresholds.length > 0) {
        const sinceRtdb = now.getTime() - 45 * 60 * 1000;
        const wantedRtdb = new Set(allRtdbThresholds.map((t) => t.parameter));
        const samplesByAhu = await Promise.all(idsRtdb.map((id) => readTelemetryRange(rtdb, id, sinceRtdb, now.getTime())));
        for (let i = 0; i < idsRtdb.length; i++) {
          const id = idsRtdb[i];
          const ths = allRtdbThresholds.filter((t) => t.ahuId === id);
          const wantedThis = new Set(ths.map((t) => t.parameter));
          const rows = samplesByAhu[i].map((s) => rtdbSampleRow(s, wantedThis));
          const mapped = ths.map((t) => thresholdToRow(t) as unknown as typeof sensorThresholds.$inferSelect);
          outRtdb[id] = computeTrendAnalyses(mapped, rows, now);
        }
      }
      return outRtdb;
    }
  } catch (err) {
    console.error("[trends] RTDB batch failed, using PostgreSQL:", err instanceof Error ? err.message : err);
  }

  const [ahuRows, allThresholds] = await Promise.all([
    ahuIds && ahuIds.length > 0
      ? db.select({ id: ahus.id }).from(ahus).where(inArray(ahus.id, ahuIds)).orderBy(ahus.id)
      : db.select({ id: ahus.id }).from(ahus).orderBy(ahus.id),
    ahuIds && ahuIds.length > 0
      ? db
          .select()
          .from(sensorThresholds)
          .where(and(inArray(sensorThresholds.ahuId, ahuIds), eq(sensorThresholds.trendEnabled, true)))
      : db.select().from(sensorThresholds).where(eq(sensorThresholds.trendEnabled, true)),
  ]);

  const ids = ahuRows.map((a) => a.id);
  const out: Record<string, TrendAnalysis[]> = {};
  for (const id of ids) out[id] = [];
  if (ids.length === 0 || allThresholds.length === 0) return out;

  const since = new Date(now.getTime() - 45 * 60 * 1000);
  const wanted = new Set(allThresholds.map((t) => t.parameter));
  const projection: Record<string, unknown> = {
    ahuId: telemetry.ahuId,
    timestamp: telemetry.timestamp,
  };
  for (const key of PARAM_KEYS) {
    if (wanted.has(key)) {
      projection[key] =
        key === "current"
          ? sql`case when ${telemetry.isCurrentFallback} then null else ${telemetry.current} end`.as("current")
          : key === "voltage"
            ? sql`case when ${telemetry.isVoltageFallback} then null else ${telemetry.voltage} end`.as("voltage")
            : telemetry[key];
    }
  }

  const allRows = (await db
    .select(projection as never)
    .from(telemetry)
    .where(and(inArray(telemetry.ahuId, ids), gt(telemetry.timestamp, since), authoritativeTelemetry()))
    .orderBy(telemetry.timestamp)) as unknown as Array<Record<string, unknown>>;

  const rowsByAhu = new Map<string, Array<Record<string, unknown>>>();
  for (const r of allRows) {
    const id = String(r.ahuId);
    const list = rowsByAhu.get(id) ?? [];
    list.push(r);
    rowsByAhu.set(id, list);
  }

  const thByAhu = new Map<string, typeof allThresholds>();
  for (const th of allThresholds) {
    const list = thByAhu.get(th.ahuId) ?? [];
    list.push(th);
    thByAhu.set(th.ahuId, list);
  }

  for (const id of ids) {
    out[id] = computeTrendAnalyses(thByAhu.get(id) ?? [], rowsByAhu.get(id) ?? [], now);
  }
  return out;
}

/** FR-18: persist trend warnings (deduplicated per parameter/horizon). */
export async function runTrendDetection(ahuId: string, now = new Date(), exec: Client = db) {
  const analyses = await analyseTrends(ahuId, now, exec);
  const created: string[] = [];
  for (const a of analyses) {
    if (!a.horizon || a.minutesToBreach === null || a.minutesToBreach <= 0) continue;
    const recent = await exec
      .select({ id: trendAlerts.id })
      .from(trendAlerts)
      .where(
        and(
          eq(trendAlerts.ahuId, ahuId),
          eq(trendAlerts.parameter, a.parameter),
          eq(trendAlerts.estimatedMin, a.horizon),
          gt(trendAlerts.createdAt, new Date(now.getTime() - 10 * 60 * 1000)),
        ),
      )
      .limit(1);
    if (recent.length > 0) continue;

    const id = randomId();
    await exec.insert(trendAlerts).values({
      id,
      ahuId,
      parameter: a.parameter,
      estimatedMin: a.horizon,
      direction: a.direction,
      isReliable: a.isReliable,
      unreliabilityReason: a.unreliabilityReason,
      sampleCount: a.sampleCount,
      variance: a.residualStd,
      slopePerMin: a.slopePerMin,
      currentValue: a.currentValue,
      projectedValue: a.projectedValue,
      thresholdValue: a.limit,
      minutesToBreach: a.minutesToBreach,
      acknowledged: false,
      createdAt: now,
    });
    // Phase 5b dual-write: the trend alert mirrors into RTDB.
    const record: RtdbTrendRecord = {
      id,
      ahuId,
      parameter: a.parameter,
      estimatedMin: a.horizon,
      direction: a.direction,
      isReliable: a.isReliable,
      unreliabilityReason: a.unreliabilityReason,
      sampleCount: a.sampleCount,
      variance: a.residualStd,
      slopePerMin: a.slopePerMin,
      currentValue: a.currentValue,
      projectedValue: a.projectedValue,
      thresholdValue: a.limit,
      minutesToBreach: a.minutesToBreach,
      acknowledged: false,
      acknowledgedBy: null,
      acknowledgedAt: null,
      createdAt: now.getTime(),
    };
    // Phase 5b slice 3: the alert write is RTDB-native when Firebase is
    // configured (the PG insert above remains for legacy/test runs).
    try {
      const rtdbPrimary = await tryGetAhuRtdb();
      if (rtdbPrimary) await writeRtdbTrendAlert(rtdbPrimary, record);
      else mirrorToRtdb((rtdb) => writeRtdbTrendAlert(rtdb, record));
    } catch (err) {
      console.error("[trends] RTDB alert write failed:", err instanceof Error ? err.message : err);
    }
    await writeAudit({
      action: "TREND_ALERT_TRIGGERED",
      entity: `trend:${id}`,
      details: {
        ahuId,
        parameter: a.parameter,
        horizon: a.horizon,
        direction: a.direction,
        reliable: a.isReliable,
        minutesToBreach: a.minutesToBreach,
      },
    });
    await publishRealtime("trend", ahuId, {
      type: "TREND_ALERT",
      trendId: id,
      ahuId,
      parameter: a.parameter,
      horizon: a.horizon,
      direction: a.direction,
      minutesToBreach: a.minutesToBreach,
      at: now.toISOString(),
    });
    created.push(id);
  }
  return created;
}
