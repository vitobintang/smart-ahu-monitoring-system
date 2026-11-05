import { and, desc, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { ahuCommands, ahus, alarms, devices, sensorThresholds, telemetry, trendAlerts, users } from "@/db/schema";
import type { AhuRow } from "@/db/schema";
import { computeAhuStatus, PARAMETERS, PARAM_KEYS, type ParamKey } from "@/lib/domain";
import { computeTrendAnalyses } from "@/lib/engine";
import { authoritativeTelemetry } from "@/lib/source";

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

const col = (p: ParamKey) => sql.raw(`"${COLUMN[p]}"`);

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
async function latestRows(ahuIds: string[]) {
  const rows = await db
    .selectDistinctOn([telemetry.ahuId])
    .from(telemetry)
    .where(and(inArray(telemetry.ahuId, ahuIds), authoritativeTelemetry()))
    .orderBy(telemetry.ahuId, desc(telemetry.timestamp))
    .limit(ahuIds.length);
  const map = new Map<string, typeof telemetry.$inferSelect>();
  for (const r of rows) if (!map.has(r.ahuId)) map.set(r.ahuId, r);
  return map;
}

export async function getDashboard(): Promise<{
  cards: AhuCard[];
  totals: { ahus: number; online: number; run: number; fault: number; offline: number; activeAlarms: number; unackedAlarms: number; trendAlerts: number };
}> {
  const ahuRows = await db.select().from(ahus).orderBy(ahus.id);
  const ids = ahuRows.map((a) => a.id);
  if (ids.length === 0) return { cards: [], totals: { ahus: 0, online: 0, run: 0, fault: 0, offline: 0, activeAlarms: 0, unackedAlarms: 0, trendAlerts: 0 } };

  // Group into two compact waves so getDashboard never grabs 5 pool connections at once
  const [latest, alarmRows] = await Promise.all([
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
export async function getSeries(ahuId: string, windowMin: number): Promise<{ points: SeriesPoint[]; runProportion: number; buckets: { t: number; run: number; total: number }[] }> {
  const since = new Date(Date.now() - windowMin * 60 * 1000);
  const rows = await db
    .select()
    .from(telemetry)
    .where(and(eq(telemetry.ahuId, ahuId), gte(telemetry.timestamp, since), authoritativeTelemetry()))
    .orderBy(telemetry.timestamp)
    .limit(2000);
  const points: SeriesPoint[] = rows.map((r) => ({
    t: r.timestamp.getTime(),
    current: r.isCurrentFallback ? null : r.current,
    supplyTemp: r.supplyTemp,
    roomTemp: r.roomTemp,
    humidity: r.humidity,
    fanSpeed: r.fanSpeed,
    filterDiffPressure: r.filterDiffPressure,
    run: r.runState === "RUN" || (r.fanSpeed ?? 0) > 0,
    source: r.source,
  }));
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

export async function buildReport(input: {
  ahuId: string;
  from: Date;
  to: Date;
  source: "ALL" | "PHYSICAL" | "SIMULATION";
  sampleLimit?: number;
}): Promise<ReportResult> {
  const conds = [eq(telemetry.ahuId, input.ahuId), gte(telemetry.timestamp, input.from), lte(telemetry.timestamp, input.to)];
  if (input.source !== "ALL") conds.push(eq(telemetry.source, input.source));
  const where = and(...conds);

  const ahuRows = await db.select().from(ahus).where(eq(ahus.id, input.ahuId)).limit(1);
  const ahu = ahuRows[0];
  const installed = new Set(ahu?.installedSensors ?? []);

  const aggFields: Record<string, unknown> = {
    total: sql<number>`count(*)::int`.as("total"),
    physical: sql<number>`count(*) filter (where ${telemetry.source} = 'PHYSICAL')::int`.as("physical"),
    simulation: sql<number>`count(*) filter (where ${telemetry.source} = 'SIMULATION')::int`.as("simulation"),
    runSamples: sql<number>`count(*) filter (where ${telemetry.runState} = 'RUN' or coalesce(${telemetry.fanSpeed},0) > 0)::int`.as(
      "run_samples",
    ),
  };
  for (const p of PARAMETERS) {
    const raw = col(p.key);
    const c = p.key === "current" ? sql`case when ${telemetry.isCurrentFallback} then null else ${raw} end`
      : p.key === "voltage" ? sql`case when ${telemetry.isVoltageFallback} then null else ${raw} end` : raw;
    aggFields[`n_${p.key}`] = sql<number>`count(${c})::int`.as(`n_${p.key}`);
    aggFields[`avg_${p.key}`] = sql<number | null>`avg(${c})`.as(`avg_${p.key}`);
    aggFields[`min_${p.key}`] = sql<number | null>`min(${c})`.as(`min_${p.key}`);
    aggFields[`max_${p.key}`] = sql<number | null>`max(${c})`.as(`max_${p.key}`);
  }
  aggFields.fallback_current = sql<number>`count(*) filter (where ${telemetry.isCurrentFallback})::int`.as("fb_current");
  aggFields.fallback_voltage = sql<number>`count(*) filter (where ${telemetry.isVoltageFallback})::int`.as("fb_voltage");

  const [summary] = await db.select(aggFields as never).from(telemetry).where(where) as unknown as [
    Record<string, number | null>,
  ];

  const stats: ReportStats[] = PARAMETERS.map((p) => ({
    parameter: p.key,
    label: p.label,
    unit: p.unit,
    count: Number(summary?.[`n_${p.key}`] ?? 0),
    avg: summary?.[`avg_${p.key}`] === null || summary?.[`avg_${p.key}`] === undefined ? null : Number(summary[`avg_${p.key}`]),
    min: summary?.[`min_${p.key}`] === null || summary?.[`min_${p.key}`] === undefined ? null : Number(summary[`min_${p.key}`]),
    max: summary?.[`max_${p.key}`] === null || summary?.[`max_${p.key}`] === undefined ? null : Number(summary[`max_${p.key}`]),
    fallbackCount:
      p.key === "current"
        ? Number(summary?.fallback_current ?? 0)
        : p.key === "voltage"
          ? Number(summary?.fallback_voltage ?? 0)
          : 0,
    installed: installed.has(p.key),
  }));

  const b = bucketFor(input.to.getTime() - input.from.getTime());
  const bucketFields: Record<string, unknown> = {
    bucket: sql<number>`(floor(extract(epoch from ${telemetry.timestamp}) * 1000 / ${b.ms}) * ${b.ms})::bigint`.as("bucket"),
    count: sql<number>`count(*)::int`.as("samples"),
    runCount: sql<number>`count(*) filter (where ${telemetry.runState} = 'RUN' or coalesce(${telemetry.fanSpeed},0) > 0)::int`.as(
      "run_samples",
    ),
  };
  for (const p of PARAMETERS) {
    const raw = col(p.key);
    const valid = p.key === "current" ? sql`case when ${telemetry.isCurrentFallback} then null else ${raw} end`
      : p.key === "voltage" ? sql`case when ${telemetry.isVoltageFallback} then null else ${raw} end` : raw;
    bucketFields[`v_${p.key}`] = sql<number | null>`avg(${valid})`.as(`v_${p.key}`);
  }

  const bucketRows = (await db
    .select(bucketFields as never)
    .from(telemetry)
    .where(where)
    .groupBy(sql.raw("bucket"))
    .orderBy(sql.raw("bucket"))
    .limit(500)) as unknown as Record<string, number | null>[];

  const buckets: ReportBucket[] = bucketRows.map((r) => {
    const values: Record<string, number | null> = {};
    for (const p of PARAMETERS) values[p.key] = r[`v_${p.key}`] === null || r[`v_${p.key}`] === undefined ? null : Number(r[`v_${p.key}`]);
    return { bucket: Number(r.bucket), count: Number(r.count ?? 0), runCount: Number(r.runCount ?? 0), values };
  });

  const limit = input.sampleLimit ?? 400;
  const sampleRows = await db
    .select()
    .from(telemetry)
    .where(where)
    .orderBy(desc(telemetry.timestamp))
    .limit(limit);

  return {
    ahuId: input.ahuId,
    ahuName: ahu?.name ?? input.ahuId,
    ahuLocation: ahu?.location ?? "Facility Mechanical Zone",
    controlMode: ahu?.controlMode ?? "AUTO",
    setpoint: ahu?.setpoint ?? 22,
    commTimeoutSec: ahu?.commTimeoutSec ?? 30,
    installedSensorCount: installed.size,
    from: input.from,
    to: input.to,
    source: input.source,
    totalRows: Number(summary?.total ?? 0),
    physicalRows: Number(summary?.physical ?? 0),
    simulationRows: Number(summary?.simulation ?? 0),
    runSamples: Number(summary?.runSamples ?? 0),
    runProportion: Number(summary?.total ?? 0) === 0 ? 0 : Number(summary?.runSamples ?? 0) / Number(summary.total),
    stats,
    buckets,
    bucketLabel: b.label,
    samples: sampleRows.map((r) => ({ ...r })),
    sampleLimit: limit,
  };
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

export async function listUsers() {
  return db.select({ id: users.id, email: users.email, fullName: users.fullName, role: users.role, createdAt: users.createdAt }).from(users).orderBy(users.createdAt);
}

/** Stream every selected sample in deterministic descending timestamp/id order.
 * Chunking avoids silently truncating large reports or loading them all in RAM. */
export function streamReportCsv(input: { ahuId: string; from: Date; to: Date; source: "ALL" | "PHYSICAL" | "SIMULATION" }): ReadableStream<Uint8Array> {
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