import type { AhuRow } from "@/lib/types";
import { computeAhuStatus, PARAMETERS, type ParamKey } from "@/lib/domain";
import { computeTrendAnalyses } from "@/lib/trends";
import {
  readLatestTelemetry,
  toLatestRow,
  tryGetAhuRtdb,
  type LatestRow,
} from "@/lib/rtdb/live-read";
import { readTelemetryRange, streamTelemetryRangeDescending } from "@/lib/rtdb/history";
import { readAlarmCounts, readAlarmHistory, alarmToRow } from "@/lib/rtdb/alarms";
import { readCommandHistory, commandToRow, readActiveCommandSlots } from "@/lib/rtdb/commands";
import { readRtdbAhu, readRtdbAhus, readRtdbDevices, readRtdbThresholds, ahuToRow, deviceToRow, thresholdToRow } from "@/lib/rtdb/registry";
import { activeCommandOf } from "@/lib/rtdb/commands";
import { readRtdbTrendCounts, readRtdbTrendHistory, trendToRow } from "@/lib/rtdb/trends";
import { getLatestTelemetry } from "@/lib/rtdb/telemetry";
import type { RtdbTelemetryRecord } from "@/lib/rtdb/telemetry";
import type { RtdbAdapter } from "@/lib/rtdb/store";

/** Phase 5c: RTDB is the only store — an unconfigured environment is fatal. */
async function requireRtdb(): Promise<RtdbAdapter> {
  const rtdb = await tryGetAhuRtdb();
  if (!rtdb) throw new Error("Firebase RTDB is not configured");
  return rtdb;
}

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
/** Newest observation per AHU — RTDB `telemetryLatest` (the only store). */
async function latestRows(ahuIds: string[]): Promise<Map<string, LatestRow>> {
  const rtdb = await requireRtdb();
  const hits = await readLatestTelemetry(rtdb, ahuIds);
  const rows = new Map<string, LatestRow>();
  for (const [ahuId, record] of hits) rows.set(ahuId, toLatestRow(record));
  return rows;
}

export async function getDashboard(): Promise<{
  cards: AhuCard[];
  totals: { ahus: number; online: number; run: number; fault: number; offline: number; activeAlarms: number; unackedAlarms: number; trendAlerts: number };
  liveSource: "rtdb";
}> {
  const ahuRows: Array<AhuRow> = await (async () => {
    const rtdb = await requireRtdb();
    const registry = await readRtdbAhus(rtdb);
    return [...registry.values()]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((r) => ahuToRow(r) as unknown as AhuRow);
  })();
  const ids = ahuRows.map((a) => a.id);
  if (ids.length === 0)
    return {
      cards: [],
      liveSource: "rtdb",
      totals: { ahus: 0, online: 0, run: 0, fault: 0, offline: 0, activeAlarms: 0, unackedAlarms: 0, trendAlerts: 0 },
    };

  const [latest, alarmRows] = await Promise.all([
    latestRows(ids),
    (async () => {
      const rtdb = await requireRtdb();
      const counts = await readAlarmCounts(rtdb, ids);
      return [...counts.values()];
    })(),
  ]);

  const [trendRows, cmdRows, filterThresholdRows] = await Promise.all([
    (async () => {
      const rtdb = await requireRtdb();
      const counts = await readRtdbTrendCounts(rtdb, ids);
      return [...counts.entries()].map(([ahuId, n]) => ({ ahuId, n }));
    })(),
    (async () => {
      const rtdb = await requireRtdb();
      const slots = await readActiveCommandSlots(rtdb);
      return [...slots.entries()]
        .filter(([ahuId, slot]) => ids.includes(ahuId) && (slot.status === "REQUESTED" || slot.status === "ACCEPTED"))
        .map(([ahuId, slot]) => ({
          id: slot.commandId,
          ahuId,
          commandType: slot.commandType,
          status: slot.status,
          expiresAt: new Date(slot.expiresAt),
          createdAt: new Date(slot.createdAt),
        }))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    })(),
    (async () => {
      const rtdb = await requireRtdb();
      const all = await readRtdbThresholds(rtdb);
      return all
        .filter((t) => t.parameter === "filterDiffPressure" && ids.includes(t.ahuId))
        .map((t) => ({ ahuId: t.ahuId, lowLimit: t.lowLimit, highLimit: t.highLimit }));
    })(),
  ]);

  const alarmMap = new Map(alarmRows.map((r) => [r.ahuId, r]));
  const trendMap = new Map(trendRows.map((r) => [r.ahuId, r.n]));
  const filterLimitMap = new Map(
    filterThresholdRows.map((r) => [r.ahuId, { low: r.lowLimit, high: r.highLimit }]),
  );
  // Only in-flight commands surface as "active" (see activeCommandOf).
  const cmdMap = new Map<string, (typeof cmdRows)[number]>();
  for (const c of cmdRows) {
    if (!cmdMap.has(c.ahuId) && activeCommandOf([c])) cmdMap.set(c.ahuId, c);
  }

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
    liveSource: "rtdb" as const,
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
 * The RTDB mirror of authoritative telemetry: when any
 * PHYSICAL sample exists in the window the physical device is authoritative
 * and simulation samples are dropped. (The SQL rule reads the enabled-devices
 * table.)
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
  const rtdb = rtdbOverride ?? (await requireRtdb());
  const records = authoritativeMirrorFilter(await readTelemetryRange(rtdb, ahuId, since.getTime(), Date.now()));
  return finishSeries(records.slice(-2000).map(seriesPointFromRow), windowMin);
}

export async function getAhuDetail(ahuId: string) {
  const now = new Date();
  const since = new Date(now.getTime() - 45 * 60 * 1000);
  const rtdb = await requireRtdb();
  const [ahuRecord, thresholdRecords, deviceRecords, latestRecord, alarmRecords, commandRecords, trendRecords, samples] =
    await Promise.all([
      readRtdbAhu(rtdb, ahuId),
      readRtdbThresholds(rtdb, ahuId),
      readRtdbDevices(rtdb, ahuId),
      getLatestTelemetry(rtdb, ahuId),
      readAlarmHistory(rtdb, ahuId, 60),
      readCommandHistory(rtdb, ahuId, 25),
      readRtdbTrendHistory(rtdb, ahuId, 25),
      readTelemetryRange(rtdb, ahuId, since.getTime(), now.getTime()),
    ]);
  if (!ahuRecord) return null;

  const ahu = ahuToRow(ahuRecord) as unknown as AhuRow;
  const thresholdRows = thresholdRecords.map((r) => thresholdToRow(r));
  const deviceRows = deviceRecords
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((r) => deviceToRow(r));
  const latest = latestRecord ? ([{ ...toLatestRow(latestRecord), ahuId }] as (LatestRow & { ahuId: string })[]) : [];
  const alarmRows = alarmRecords.map(alarmToRow);
  const cmdRows = commandRecords.map(commandToRow);
  const trendRows = trendRecords.map(trendToRow);
  const trendSampleRows: Array<Record<string, unknown>> = samples.map((s) => ({
    timestamp: new Date(s.timestamp),
    roomTemp: s.roomTemp,
    supplyTemp: s.supplyTemp,
    returnTemp: s.returnTemp,
    humidity: s.humidity,
    filterDiffPressure: s.filterDiffPressure,
    fanSpeed: s.fanSpeed,
    coilTemp: s.coilTemp,
    damperPosition: s.damperPosition,
    current: s.isCurrentFallback ? null : s.current,
    voltage: s.isVoltageFallback ? null : s.voltage,
    runHours: s.runHours,
    heaterOutput: s.heaterOutput,
  }));
  const row = latest[0];
  const computed = computeAhuStatus({
    lastSeenAt: row?.timestamp ?? null,
    commTimeoutSec: ahu.commTimeoutSec,
    faultCode: row?.faultCode ?? null,
    hasCriticalAlarm: alarmRows.some((a) => a.isActive && a.priority === "CRITICAL"),
    fanSpeed: row?.fanSpeed ?? null,
    runState: row?.runState ?? null,
  });
  const analyses = computeTrendAnalyses(thresholdRows as never, trendSampleRows, now);
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
 * first (day shards read in parallel)
 * is unconfigured or the read fails. Rows ascend by measurement timestamp.
 */
export async function fetchTelemetryRange(
  ahuId: string,
  from: Date,
  to: Date,
  source: "ALL" | "PHYSICAL" | "SIMULATION",
  rtdbOverride?: RtdbAdapter | null,
): Promise<{ rows: ReportSampleRow[]; liveSource: "rtdb" }> {
  const rtdb = rtdbOverride ?? (await requireRtdb());
  const records = await readTelemetryRange(rtdb, ahuId, from.getTime(), to.getTime(), source);
  return { rows: records.map((r) => ({ ahuId, ...toLatestRow(r) })), liveSource: "rtdb" };
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
 * the RTDB history node (replacing the previous three SQL
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
  const rtdb = await requireRtdb();
  const ahuRecord = await readRtdbAhu(rtdb, input.ahuId);
  const { rows } = await fetchTelemetryRange(input.ahuId, input.from, input.to, input.source);
  return buildReportFromRows(
    input,
    {
      name: ahuRecord?.name ?? input.ahuId,
      location: ahuRecord?.location ?? "Facility Mechanical Zone",
      controlMode: (ahuRecord?.controlMode as "AUTO" | "MANUAL") ?? "AUTO",
      setpoint: ahuRecord?.setpoint ?? 22,
      commTimeoutSec: ahuRecord?.commTimeoutSec ?? 30,
      installedSensors: ahuRecord?.installedSensors ?? [],
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
 * to offset pagination otherwise or when the first RTDB read
 * fails before any bytes are emitted.
 */
export function streamReportCsv(
  input: { ahuId: string; from: Date; to: Date; source: "ALL" | "PHYSICAL" | "SIMULATION" },
  rtdbOverride?: RtdbAdapter | null,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let first = true;
  const iterator = (async function* () {
    const rtdb = rtdbOverride ?? (await requireRtdb());
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
        controller.error(err instanceof Error ? err : new Error(String(err)));
      }
    },
  });
}
