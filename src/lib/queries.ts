import { and, desc, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { ahuCommands, ahus, alarms, devices, sensorThresholds, telemetry, trendAlerts } from "@/db/schema";
import type { AhuRow } from "@/db/schema";
import { computeAhuStatus, PARAMETERS, PARAM_KEYS, type ParamKey } from "@/lib/domain";
import { computeTrendAnalyses } from "@/lib/trends";
import { authoritativeTelemetry } from "@/lib/source";
import {
  readLatestTelemetry,
  toLatestRow,
  tryGetAhuRtdb,
  type LatestRow,
} from "@/lib/rtdb/live-read";
import { readTelemetryRange, streamTelemetryRangeDescending } from "@/lib/rtdb/history";
import type { RtdbTelemetryRecord } from "@/lib/rtdb/telemetry";
import type { RtdbAdapter } from "@/lib/rtdb/store";

export const COLUMN: Record<ParamKey, string> = {
  roomTemp: "room_temp",
  supplyTemp: "supply_temp",
  returnTemp: "return_temp",
  humidity: "humidity",
  filterDiffPressure: "filter_diff_pressure",
  fanSpeed: "fan_speed",
  coilTemp: "coil_temp",
  damperPosition: "damper_position",
  current: "current",
  voltage: "voltage",
  runHours: "run_hours",
  heaterOutput: "heater_output",
};


export interface AhuCard {
  ahu: AhuRow;
  status: AhuRow["currentStatus"];
  ageSec: number | null;
  stale: boolean;
  lastSeenAt: Date | null;
  source: string | null;
  values: Record<string, number | null>;
  fallback: { current: boolean; voltage: boolean };
  activeAlarms: number;
  criticalAlarms: number;
  unackedAlarms: number;
  trendAlerts: number;
  filterLimits: { low: number | null; high: number | null };
  activeCommand: { id: string; commandType: string; status: string; expiresAt: Date } | null;
}

/**
 * Latest telemetry row per AHU.
 * Uses a Postgres `DISTINCT ON` + LIMIT so the dashboard never materialises the
 * whole (continuously growing) telemetry table on every poll.
 */
async function pgLatestRows(ahuIds: string[]): Promise<Map<string, LatestRow>> {
  if (ahuIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([telemetry.ahuId])
    .from(telemetry)
    .where(and(inArray(telemetry.ahuId, ahuIds), authoritativeTelemetry()))
    .orderBy(telemetry.ahuId, desc(telemetry.timestamp))
    .limit(ahuIds.length);
  const map = new Map<string, LatestRow>();
  for (const r of rows) if (!map.has(r.ahuId)) map.set(r.ahuId, r);
  return map;
}

/**
 * Newest observation per AHU — Phase 2 Slice B: RTDB telemetryLatest first
 * (live mirror), PostgreSQL backfill for every unit the mirror cannot serve.
 * Any RTDB failure silently degrades to the pure-PostgreSQL read.
 */
async function latestRows(ahuIds: string[]): Promise<{ rows: Map<string, LatestRow>; liveSource: "rtdb" | "postgres" }> {
  try {
    const rtdb = await tryGetAhuRtdb();
    if (rtdb) {
      const hits = await readLatestTelemetry(rtdb, ahuIds);
      if (hits.size > 0) {
        const rows = new Map<string, LatestRow>();
        for (const [ahuId, record] of hits) rows.set(ahuId, toLatestRow(record));
        for (const [ahuId, row] of await pgLatestRows(ahuIds.filter((id) => !hits.has(id)))) {
          rows.set(ahuId, row);
        }
        return { rows, liveSource: "rtdb" };
      }
    }
  } catch (err) {
    console.error("[live-read] RTDB latest read failed, using PostgreSQL:", err instanceof Error ? err.message : err);
  }
  return { rows: await pgLatestRows(ahuIds), liveSource: "postgres" };
}

export async function getDashboard(): Promise<{
  cards: AhuCard[];
  totals: { ahus: number; online: number; run: number; fault: number; offline: number; activeAlarms: number; unackedAlarms: number; trendAlerts: number };
  liveSource: "rtdb" | "postgres";
}> {
  const ahuRows = await db.select().from(ahus).orderBy(ahus.id);
  const ids = ahuRows.map((a) => a.id);
  if (ids.length === 0)
    return {
      cards: [],
      liveSource: "postgres",
      totals: { ahus: 0, online: 0, run: 0, fault: 0, offline: 0, activeAlarms: 0, unackedAlarms: 0, trendAlerts: 0 },
    };

  // Group into two compact waves so getDashboard never grabs 5 pool connections at once
  const [{ rows: latest, liveSource }, alarmRows] = await Promise.all([
    latestRows(ids),
    db
      .select({
        ahuId: alarms.ahuId,
        active: sql<number>`count(*) filter (where ${alarms.isActive})::int`.as("active"),
        critical: sql<number>`count(*) filter (where ${alarms.isActive} and ${alarms.priority} = 'CRITICAL')::int`.as("critical"),
        unacked: sql<number>`count(*) filter (where ${alarms.isActive} and not ${alarms.acknowledged})::int`.as("unacked"),
      })
      .from(alarms)
      .where(inArray(alarms.ahuId, ids))
      .groupBy(alarms.ahuId),
  ]);

  const [trendRows, cmdRows, filterThresholdRows] = await Promise.all([
    db
      .select({ ahuId: trendAlerts.ahuId, n: sql<number>`count(*) filter (where not ${trendAlerts.acknowledged})::int` })
      .from(trendAlerts)
      .where(inArray(trendAlerts.ahuId, ids))
      .groupBy(trendAlerts.ahuId),
    db
      .select()
      .from(ahuCommands)
      .where(and(inArray(ahuCommands.ahuId, ids), inArray(ahuCommands.status, ["REQUESTED", "ACCEPTED"])))
      .orderBy(desc(ahuCommands.createdAt)),
    db
      .select({
        ahuId: sensorThresholds.ahuId,
        lowLimit: sensorThresholds.lowLimit,
        highLimit: sensorThresholds.highLimit,
      })
      .from(sensorThresholds)
      .where(and(inArray(sensorThresholds.ahuId, ids), eq(sensorThresholds.parameter, "filterDiffPressure"))),
  ]);

  const alarmMap = new Map(alarmRows.map((r) => [r.ahuId, r]));
  const trendMap = new Map(trendRows.map((r) => [r.ahuId, r.n]));
  const filterLimitMap = new Map(
    filterThresholdRows.map((r) => [r.ahuId, { low: r.lowLimit, high: r.highLimit }]),
  );
  const cmdMap = new Map<string, (typeof cmdRows)[number]>();
  for (const c of cmdRows) if (!cmdMap.has(c.ahuId)) cmdMap.set(c.ahuId, c);

  const cards: AhuCard[] = ahuRows.map((ahu) => {
    const row = latest.get(ahu.id);
    const computed = computeAhuStatus({
      lastSeenAt: row?.timestamp ?? null,
      commTimeoutSec: ahu.commTimeoutSec,
      faultCode: row?.faultCode ?? null,
      hasCriticalAlarm: (alarmMap.get(ahu.id)?.critical ?? 0) > 0,
      fanSpeed: row?.fanSpeed ?? null,
      runState: row?.runState ?? null,
    });
    return {
      ahu,
      status: computed.status,
      ageSec: computed.ageSec === null ? null : Number(computed.ageSec.toFixed(0)),
      stale: computed.stale,
      lastSeenAt: row?.timestamp ?? null,
      source: row?.source ?? null,
      values: {
        roomTemp: row?.roomTemp ?? null,
        supplyTemp: row?.supplyTemp ?? null,
        returnTemp: row?.returnTemp ?? null,
        humidity: row?.humidity ?? null,
        filterDiffPressure: row?.filterDiffPressure ?? null,
        fanSpeed: row?.fanSpeed ?? null,
        coilTemp: row?.coilTemp ?? null,
        damperPosition: row?.damperPosition ?? null,
        current: row?.current ?? null,
        voltage: row?.voltage ?? null,
        runHours: row?.runHours ?? null,
        heaterOutput: row?.heaterOutput ?? null,
      },
      fallback: {
        current: Boolean(row?.isCurrentFallback),
        voltage: Boolean(row?.isVoltageFallback),
      },
      activeAlarms: alarmMap.get(ahu.id)?.active ?? 0,
      criticalAlarms: alarmMap.get(ahu.id)?.critical ?? 0,
      unackedAlarms: alarmMap.get(ahu.id)?.unacked ?? 0,
      trendAlerts: trendMap.get(ahu.id) ?? 0,
      filterLimits: filterLimitMap.get(ahu.id) ?? { low: null, high: null },
      activeCommand: cmdMap.has(ahu.id)
        ? {
            id: cmdMap.get(ahu.id)!.id,
            commandType: cmdMap.get(ahu.id)!.commandType,
            status: cmdMap.get(ahu.id)!.status,
            expiresAt: cmdMap.get(ahu.id)!.expiresAt,
          }
        : null,
    };
  });

  return {
    cards,
    /** Which store served the newest-observation reads ("rtdb" = Firebase mirror). */
    liveSource,
    totals: {
      ahus: cards.length,
      online: cards.filter((c) => c.status === "RUN" || c.status === "STOP" || c.status === "FAULT").length,
      run: cards.filter((c) => c.status === "RUN").length,
      fault: cards.filter((c) => c.status === "FAULT").length,
      offline: cards.filter((c) => c.status === "OFFLINE").length,
      activeAlarms: cards.reduce((a, c) => a + c.activeAlarms, 0),
      unackedAlarms: cards.reduce((a, c) => a + c.unackedAlarms, 0),
      trendAlerts: cards.reduce((a, c) => a + c.trendAlerts, 0),
    },
  };
}

export interface SeriesPoint {
  t: number;
  current: number | null;
  supplyTemp: number | null;
  roomTemp: number | null;
  humidity: number | null;
  fanSpeed: number | null;
  filterDiffPressure: number | null;
  run: boolean;
  source: string;
}

/** FR-08: live chart series with RUN sample proportion. */
function seriesPointFromRow(r: {
  timestamp: Date | number;
  source: string;
  runState: string | null;
  fanSpeed: number | null;
  isCurrentFallback: boolean;
  current: number | null;
  supplyTemp: number | null;
  roomTemp: number | null;
  humidity: number | null;
  filterDiffPressure: number | null;
}): SeriesPoint {
  return {
    t: (r.timestamp instanceof Date ? r.timestamp.getTime() : r.timestamp),
    current: r.isCurrentFallback ? null : r.current,
    supplyTemp: r.supplyTemp,
    roomTemp: r.roomTemp,
    humidity: r.humidity,
    fanSpeed: r.fanSpeed,
    filterDiffPressure: r.filterDiffPressure,
    run: r.runState === "RUN" || (r.fanSpeed ?? 0) > 0,
    source: r.source,
  };
}

function finishSeries(points: SeriesPoint[], windowMin: number) {
  const bucketMs = windowMin <= 5 ? 30_000 : 60_000;
  const bucketMap = new Map<number, { run: number; total: number }>();
  for (const p of points) {
    const key = Math.floor(p.t / bucketMs) * bucketMs;
    const b = bucketMap.get(key) ?? { run: 0, total: 0 };
    b.total += 1;
    if (p.run) b.run += 1;
    bucketMap.set(key, b);
  }
  const buckets = [...bucketMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, v]) => ({ t, ...v }));
  const runProportion = points.length === 0 ? 0 : points.filter((p) => p.run).length / points.length;
  return { points, runProportion, buckets };
}

/**
 * The mirror approximation of PostgreSQL's authoritativeTelemetry(): when any
 * PHYSICAL sample exists in the window the physical device is authoritative
 * and simulation samples are dropped. (The SQL rule reads the enabled-devices
 * table; the PG fallback path below stays exact.)
 */
function authoritativeMirrorFilter(records: RtdbTelemetryRecord[]): RtdbTelemetryRecord[] {
  const hasPhysical = records.some((r) => r.source === "PHYSICAL");
  return hasPhysical ? records.filter((r) => r.source === "PHYSICAL") : records;
}

export async function getSeries(
  ahuId: string,
  windowMin: number,
  rtdbOverride?: RtdbAdapter | null,
): Promise<{ points: SeriesPoint[]; runProportion: number; buckets: { t: number; run: number; total: number }[] }> {
  const since = new Date(Date.now() - windowMin * 60 * 1000);
  try {
    const rtdb = rtdbOverride ?? (await tryGetAhuRtdb());
    if (rtdb) {
      const records = authoritativeMirrorFilter(await readTelemetryRange(rtdb, ahuId, since.getTime(), Date.now()));
      return finishSeries(records.slice(-2000).map(seriesPointFromRow), windowMin);
    }
  } catch (err) {
    console.error("[series] RTDB read failed, using PostgreSQL:", err instanceof Error ? err.message : err);
  }
  const rows = await db
    .select()
    .from(telemetry)
    .where(and(eq(telemetry.ahuId, ahuId), gte(telemetry.timestamp, since), authoritativeTelemetry()))
    .orderBy(telemetry.timestamp)
    .limit(2000);
  return finishSeries(rows.map(seriesPointFromRow), windowMin);
}

export async function getAhuDetail(ahuId: string) {
  const now = new Date();
  const since = new Date(now.getTime() - 45 * 60 * 1000);
  const trendProjection: Record<string, unknown> = { timestamp: telemetry.timestamp };
  for (const key of PARAM_KEYS) {
    trendProjection[key] =
      key === "current"
        ? sql`case when ${telemetry.isCurrentFallback} then null else ${telemetry.current} end`.as("current")
        : key === "voltage"
          ? sql`case when ${telemetry.isVoltageFallback} then null else ${telemetry.voltage} end`.as("voltage")
          : telemetry[key];
  }

  const [ahuRows, latest, thresholdRows, deviceRows, alarmRows, cmdRows, trendRows, trendSampleRows] =
    await Promise.all([
      db.select().from(ahus).where(eq(ahus.id, ahuId)).limit(1),
      db.select().from(telemetry).where(and(eq(telemetry.ahuId, ahuId), authoritativeTelemetry())).orderBy(desc(telemetry.timestamp)).limit(1),
      db.select().from(sensorThresholds).where(eq(sensorThresholds.ahuId, ahuId)),
      db.select({ id: devices.id, ahuId: devices.ahuId, label: devices.label, sourceType: devices.sourceType, enabled: devices.enabled, createdAt: devices.createdAt }).from(devices).where(eq(devices.ahuId, ahuId)).orderBy(devices.createdAt),
      db.select().from(alarms).where(eq(alarms.ahuId, ahuId)).orderBy(desc(alarms.triggeredAt)).limit(60),
      db.select().from(ahuCommands).where(eq(ahuCommands.ahuId, ahuId)).orderBy(desc(ahuCommands.createdAt)).limit(25),
      db.select().from(trendAlerts).where(eq(trendAlerts.ahuId, ahuId)).orderBy(desc(trendAlerts.createdAt)).limit(25),
      db
        .select(trendProjection as never)
        .from(telemetry)
        .where(and(eq(telemetry.ahuId, ahuId), gt(telemetry.timestamp, since), authoritativeTelemetry()))
        .orderBy(telemetry.timestamp) as unknown as Promise<Array<Record<string, unknown>>>,
    ]);
  const ahu = ahuRows[0];
  if (!ahu) return null;
  const row = latest[0];
  const computed = computeAhuStatus({
    lastSeenAt: row?.timestamp ?? null,
    commTimeoutSec: ahu.commTimeoutSec,
    faultCode: row?.faultCode ?? null,
    hasCriticalAlarm: alarmRows.some((a) => a.isActive && a.priority === "CRITICAL"),
    fanSpeed: row?.fanSpeed ?? null,
    runState: row?.runState ?? null,
  });
  const analyses = computeTrendAnalyses(thresholdRows, trendSampleRows, now);
  return { ahu, latest: row ?? null, thresholds: thresholdRows, devices: deviceRows, alarms: alarmRows, commands: cmdRows, trends: trendRows, analyses, computed };
}

/* ------------------------------------------------------------------ */
/* FR-10 / FR-11: data logger report                                  */
/* ------------------------------------------------------------------ */

export interface ReportStats {
  parameter: ParamKey;
  label: string;
  unit: string;
  count: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  fallbackCount: number;
  installed: boolean;
}

export interface ReportBucket {
  bucket: number;
  count: number;
  runCount: number;
  values: Record<string, number | null>;
}

export interface ReportResult {
  ahuId: string;
  ahuName: string;
  ahuLocation: string;
  controlMode: string;
  setpoint: number;
  commTimeoutSec: number;
  installedSensorCount: number;
  from: Date;
  to: Date;
  source: "ALL" | "PHYSICAL" | "SIMULATION";
  totalRows: number;
  physicalRows: number;
  simulationRows: number;
  runSamples: number;
  runProportion: number;
  stats: ReportStats[];
  buckets: ReportBucket[];
  bucketLabel: string;
  samples: Array<Record<string, unknown>>;
  sampleLimit: number;
}

function bucketFor(rangeMs: number): { trunc: "minute" | "hour" | "day"; label: string; ms: number } {
  const hours = rangeMs / 3_600_000;
  if (hours <= 6) return { trunc: "minute", label: "5-minute interval", ms: 300_000 };
  if (hours <= 48) return { trunc: "hour", label: "1-hour interval", ms: 3_600_000 };
  return { trunc: "day", label: "1-day interval", ms: 86_400_000 };
}

/** Flattened telemetry sample shared by the report pipeline (PG row or RTDB mirror). */
export type ReportSampleRow = LatestRow & { ahuId: string };

/**
 * Phase 3 Slice 1: source-agnostic report range fetch — RTDB history tree
 * first (day shards read in parallel), full PostgreSQL fallback when Firebase
 * is unconfigured or the read fails. Rows ascend by measurement timestamp.
 */
export async function fetchTelemetryRange(
  ahuId: string,
  from: Date,
  to: Date,
  source: "ALL" | "PHYSICAL" | "SIMULATION",
  rtdbOverride?: RtdbAdapter | null,
): Promise<{ rows: ReportSampleRow[]; liveSource: "rtdb" | "postgres" }> {
  try {
    const rtdb = rtdbOverride ?? (await tryGetAhuRtdb());
    if (rtdb) {
      const records = await readTelemetryRange(rtdb, ahuId, from.getTime(), to.getTime(), source);
      return { rows: records.map((r) => ({ ahuId, ...toLatestRow(r) })), liveSource: "rtdb" };
    }
  } catch (err) {
    console.error("[report] RTDB history read failed, using PostgreSQL:", err instanceof Error ? err.message : err);
  }
  const conds = [eq(telemetry.ahuId, ahuId), gte(telemetry.timestamp, from), lte(telemetry.timestamp, to)];
  if (source !== "ALL") conds.push(eq(telemetry.source, source));
  const pgRows = await db
    .select()
    .from(telemetry)
    .where(and(...conds))
    .orderBy(telemetry.timestamp);
  return { rows: pgRows.map((r) => ({ ...r, ahuId })), liveSource: "postgres" };
}

/** Aggregation value: fallback-marked current/voltage readings are excluded (SQL parity). */
function validParamValue(row: ReportSampleRow, key: ParamKey): number | null {
  if (key === "current") return row.isCurrentFallback ? null : row.current;
  if (key === "voltage") return row.isVoltageFallback ? null : row.voltage;
  return row[key];
}

function isRunSample(row: ReportSampleRow): boolean {
  return row.runState === "RUN" || (row.fanSpeed ?? 0) > 0;
}

/**
 * Pure report builder over flattened rows — ONE implementation serves both
 * the RTDB and PostgreSQL paths (replacing the previous three SQL
 * aggregates: summary, bucketed averages, samples page). Excluded
 * fallback-marked values and NULL-ignoring averages match the SQL semantics.
 */
export function buildReportFromRows(
  input: { ahuId: string; from: Date; to: Date; source: "ALL" | "PHYSICAL" | "SIMULATION"; sampleLimit?: number },
  ahuMeta: {
    name: string;
    location: string;
    controlMode: string;
    setpoint: number;
    commTimeoutSec: number;
    installedSensors: string[];
  },
  rows: ReportSampleRow[],
): ReportResult {
  const installed = new Set(ahuMeta.installedSensors);
  const runSamples = rows.filter(isRunSample).length;
  const physicalRows = rows.filter((r) => r.source === "PHYSICAL").length;

  const stats: ReportStats[] = PARAMETERS.map((p) => {
    let count = 0;
    let sum = 0;
    let min: number | null = null;
    let max: number | null = null;
    for (const row of rows) {
      const v = validParamValue(row, p.key);
      if (v === null || v === undefined) continue;
      count += 1;
      sum += v;
      if (min === null || v < min) min = v;
      if (max === null || v > max) max = v;
    }
    return {
      parameter: p.key,
      label: p.label,
      unit: p.unit,
      count,
      avg: count === 0 ? null : sum / count,
      min,
      max,
      fallbackCount:
        p.key === "current"
          ? rows.filter((r) => r.isCurrentFallback).length
          : p.key === "voltage"
            ? rows.filter((r) => r.isVoltageFallback).length
            : 0,
      installed: installed.has(p.key),
    };
  });

  const b = bucketFor(input.to.getTime() - input.from.getTime());
  const bucketMap = new Map<number, { count: number; runCount: number; sums: Record<string, number>; ns: Record<string, number> }>();
  for (const row of rows) {
    const key = Math.floor(row.timestamp.getTime() / b.ms) * b.ms;
    const cell = bucketMap.get(key) ?? { count: 0, runCount: 0, sums: {}, ns: {} };
    cell.count += 1;
    if (isRunSample(row)) cell.runCount += 1;
    for (const p of PARAMETERS) {
      const v = validParamValue(row, p.key);
      if (v === null || v === undefined) continue;
      cell.sums[p.key] = (cell.sums[p.key] ?? 0) + v;
      cell.ns[p.key] = (cell.ns[p.key] ?? 0) + 1;
    }
    bucketMap.set(key, cell);
  }
  const buckets: ReportBucket[] = [...bucketMap.entries()]
    .sort((a, b2) => a[0] - b2[0])
    .slice(0, 500)
    .map(([bucket, cell]) => {
      const values: Record<string, number | null> = {};
      for (const p of PARAMETERS) {
        const n = cell.ns[p.key] ?? 0;
        values[p.key] = n === 0 ? null : cell.sums[p.key] / n;
      }
      return { bucket, count: cell.count, runCount: cell.runCount, values };
    });

  const limit = input.sampleLimit ?? 400;
  const ascending = rows.slice(-limit);
  const samples = ascending.reverse();

  return {
    ahuId: input.ahuId,
    ahuName: ahuMeta.name,
    ahuLocation: ahuMeta.location,
    controlMode: ahuMeta.controlMode,
    setpoint: ahuMeta.setpoint,
    commTimeoutSec: ahuMeta.commTimeoutSec,
    installedSensorCount: installed.size,
    from: input.from,
    to: input.to,
    source: input.source,
    totalRows: rows.length,
    physicalRows,
    simulationRows: rows.length - physicalRows,
    runSamples,
    runProportion: rows.length === 0 ? 0 : runSamples / rows.length,
    stats,
    buckets,
    bucketLabel: b.label,
    samples: samples as unknown as Array<Record<string, unknown>>,
    sampleLimit: limit,
  };
}

export async function buildReport(input: {
  ahuId: string;
  from: Date;
  to: Date;
  source: "ALL" | "PHYSICAL" | "SIMULATION";
  sampleLimit?: number;
}): Promise<ReportResult> {
  const ahuRows = await db.select().from(ahus).where(eq(ahus.id, input.ahuId)).limit(1);
  const ahu = ahuRows[0];
  const { rows } = await fetchTelemetryRange(input.ahuId, input.from, input.to, input.source);
  return buildReportFromRows(
    input,
    {
      name: ahu?.name ?? input.ahuId,
      location: ahu?.location ?? "Facility Mechanical Zone",
      controlMode: ahu?.controlMode ?? "AUTO",
      setpoint: ahu?.setpoint ?? 22,
      commTimeoutSec: ahu?.commTimeoutSec ?? 30,
      installedSensors: ahu?.installedSensors ?? [],
    },
    rows,
  );
}

/** Prevent spreadsheet programs executing untrusted text as formulas. */
export function spreadsheetSafe(value: string): string {
  return /^[\s\u0000-\u001f]*[=+@-]/.test(value) ? `'${value}` : value;
}

export function reportToCsv(report: ReportResult): string {
  const headers = [
    "timestamp",
    "source",
    "message_id",
    "run_state",
    "fault_code",
    ...PARAMETERS.map((p) => p.key),
    "current_quality",
    "voltage_quality",
  ];
  const lines = [headers.join(",")];
  for (const s of report.samples) {
    const row = s as unknown as Record<string, unknown> & { timestamp: Date };
    const cells: string[] = [
      new Date(row.timestamp).toISOString(),
      String(row.source ?? ""),
      spreadsheetSafe(String(row.messageId ?? "")),
      String(row.runState ?? ""),
      spreadsheetSafe(String(row.faultCode ?? "")),
    ];
    for (const p of PARAMETERS) {
      const v = row[p.key];
      cells.push(v === null || v === undefined ? "" : String(v));
    }
    cells.push(row.isCurrentFallback ? "ESTIMATED_FALLBACK" : row.current === null ? "NULL_UNAVAILABLE" : String(row.source === "SIMULATION" ? "SIMULATED" : "OK"));
    cells.push(row.isVoltageFallback ? "ESTIMATED_FALLBACK" : row.voltage === null ? "NULL_UNAVAILABLE" : String(row.source === "SIMULATION" ? "SIMULATED" : "OK"));
    lines.push(cells.map((c) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","));
  }
  return lines.join("\n");
}

/**
 * FR-12 full CSV export. Phase 3: streams from the RTDB day shards (one shard
 * in RAM at a time, newest day first) when Firebase is configured; falls back
 * to the PostgreSQL cursor pagination otherwise or when the first RTDB read
 * fails before any bytes are emitted.
 */
export function streamReportCsv(
  input: { ahuId: string; from: Date; to: Date; source: "ALL" | "PHYSICAL" | "SIMULATION" },
  rtdbOverride?: RtdbAdapter | null,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let first = true;
  const iterator = (async function* () {
    let rtdb: RtdbAdapter | null = null;
    try {
      rtdb = rtdbOverride ?? (await tryGetAhuRtdb());
    } catch {
      rtdb = null;
    }
    if (!rtdb) return;
    for await (const chunk of streamTelemetryRangeDescending(rtdb, input.ahuId, input.from.getTime(), input.to.getTime(), input.source)) {
      yield chunk.map((record) => toLatestRow({ ...record, ahuId: input.ahuId }));
    }
  })();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          if (first) {
            // configured RTDB but an empty range — emit the header-only CSV
            const csv = reportToCsv({ samples: [] } as unknown as ReportResult);
            controller.enqueue(encoder.encode(csv + "\n"));
          }
          controller.close();
          return;
        }
        if (value.length === 0) return; // skip empty chunks, keep pulling
        const csv = reportToCsv({ samples: value } as unknown as ReportResult);
        const output = first ? csv : csv.slice(csv.indexOf("\n") + 1);
        first = false;
        controller.enqueue(encoder.encode(output + "\n"));
      } catch (err) {
        console.error("[csv] RTDB stream failed:", err instanceof Error ? err.message : err);
        if (first) {
          // Nothing emitted yet — clean PostgreSQL fallback.
          const reader = streamReportCsvFromPostgres(input).getReader();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            const csv = first ? new TextDecoder().decode(value) : new TextDecoder().decode(value).slice(new TextDecoder().decode(value).indexOf("\n") + 1);
            first = false;
            controller.enqueue(encoder.encode(csv + "\n"));
          }
          controller.close();
        } else {
          // Mid-stream: error like the PostgreSQL streamer does (truncated
          // download) — restarting would duplicate already-emitted rows.
          controller.error(err instanceof Error ? err : new Error(String(err)));
        }
      }
    },
  });
}

/** PostgreSQL cursor-paginated CSV streamer (RAM bounded, descending order). */
function streamReportCsvFromPostgres(input: { ahuId: string; from: Date; to: Date; source: "ALL" | "PHYSICAL" | "SIMULATION" }): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cursor: number | undefined;
  let first = true;
  let finished = false;
  return new ReadableStream({
    async pull(controller) {
      if (finished) { controller.close(); return; }
      try {
        const conditions = [eq(telemetry.ahuId, input.ahuId), gte(telemetry.timestamp, input.from), lte(telemetry.timestamp, input.to)];
        if (input.source !== "ALL") conditions.push(eq(telemetry.source, input.source));
        if (cursor !== undefined) conditions.push(sql`(${telemetry.timestamp}, ${telemetry.id}) < (select timestamp, id from ahu_private.telemetry where id = ${cursor})`);
        const rows = await db.select().from(telemetry).where(and(...conditions)).orderBy(desc(telemetry.timestamp), desc(telemetry.id)).limit(1000);
        // Reuse the CSV escaping and quality columns used by the ordinary report.
        const csv = reportToCsv({ samples: rows } as unknown as ReportResult);
        const output = first ? csv : csv.slice(csv.indexOf("\n") + 1);
        first = false;
        if (rows.length) {
          controller.enqueue(encoder.encode(output + "\n"));
          cursor = rows[rows.length - 1].id;
        } else {
          if (cursor === undefined) controller.enqueue(encoder.encode(csv + "\n"));
          finished = true; controller.close();
        }
      } catch (error) { controller.error(error); }
    },
  });
}