import type { RtdbAdapter } from "./store";
import { getLatestTelemetry, type RtdbTelemetryRecord } from "./telemetry";

/**
 * Live dashboard reads from `telemetryLatest/{ahuId}` — RTDB is the sole
 * source of truth. Individual per-AHU misses are tolerated (allSettled) so a
 * single gap never blanks the whole fleet card row.
 */

/** True when the environment carries both the public config and admin credentials. */
export function firebaseEnvConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.NEXT_PUBLIC_FIREBASE_PROJECT_ID &&
      (env.FIREBASE_SERVICE_ACCOUNT_PATH || env.FIREBASE_SERVICE_ACCOUNT || env.FIREBASE_SERVICE_ACCOUNT_JSON),
  );
}

/** Admin RTDB adapter, or null when Firebase is not configured / fails to boot. */
export async function tryGetAhuRtdb(env: NodeJS.ProcessEnv = process.env): Promise<RtdbAdapter | null> {
  if (!firebaseEnvConfigured(env)) return null;
  try {
    const { getAhuRtdb } = await import("@/lib/firebase/admin");
    return await getAhuRtdb(env);
  } catch (err) {
    console.error("[live-read] Firebase Admin unavailable:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Reads `telemetryLatest/{ahuId}` for every id in parallel. Individual
 * failures/misses are skipped (allSettled), so the result holds the units the
 * mirror could serve; the dashboard shows those units without latest data.
 */
export async function readLatestTelemetry(
  rtdb: RtdbAdapter,
  ahuIds: string[],
): Promise<Map<string, RtdbTelemetryRecord>> {
  const results = await Promise.allSettled(ahuIds.map((id) => getLatestTelemetry(rtdb, id)));
  const hits = new Map<string, RtdbTelemetryRecord>();
  results.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value) hits.set(ahuIds[index], result.value);
  });
  return hits;
}

/** RTDB or throw — every server path now requires the RTDB to be configured. */
export async function requireRtdb(env: NodeJS.ProcessEnv = process.env): Promise<RtdbAdapter> {
  const rtdb = await tryGetAhuRtdb(env);
  if (!rtdb) throw new Error("Firebase RTDB is not configured");
  return rtdb;
}

/**
 * Fire-and-forget RTDB write runner. Silent no-op when Firebase is not
 * configured; failures are logged and never propagate to the caller.
 */
export function mirrorToRtdb(fn: (rtdb: RtdbAdapter) => Promise<void>): void {
  if (!firebaseEnvConfigured()) return;
  void (async () => {
    const { getAhuRtdb } = await import("@/lib/firebase/admin");
    await fn(await getAhuRtdb());
  })().catch((err) => {
    console.error("[rtdb-mirror] write failed:", err instanceof Error ? err.message : err);
  });
}

/**
 * The telemetry-row subset the dashboard card build consumes (see
 * getDashboard in src/lib/queries.ts); RTDB records are mapped via toLatestRow.
 */
export interface LatestRow {
  timestamp: Date;
  source: string | null;
  messageId: string | null;
  faultCode: string | null;
  runState: string | null;
  roomTemp: number | null;
  supplyTemp: number | null;
  returnTemp: number | null;
  humidity: number | null;
  filterDiffPressure: number | null;
  fanSpeed: number | null;
  coilTemp: number | null;
  damperPosition: number | null;
  current: number | null;
  isCurrentFallback: boolean;
  voltage: number | null;
  isVoltageFallback: boolean;
  runHours: number | null;
  heaterOutput: number | null;
}

/** Maps a mirrored RTDB record onto the dashboard's LatestRow shape. */
/**
 * RTDB stores no null object fields (they are stripped on write), so missing
 * keys read back as undefined. Every row mapper normalizes them back to null
 * to preserve the exact JSON API shapes the UI was built against.
 */
function n<T>(value: T | undefined): T | null {
  return value === undefined ? null : (value as T);
}

export function toLatestRow(record: RtdbTelemetryRecord): LatestRow {
  return {
    timestamp: new Date(record.timestamp),
    source: n(record.source),
    messageId: n(record.messageId),
    faultCode: n(record.faultCode),
    runState: n(record.runState),
    roomTemp: n(record.roomTemp),
    supplyTemp: n(record.supplyTemp),
    returnTemp: n(record.returnTemp),
    humidity: n(record.humidity),
    filterDiffPressure: n(record.filterDiffPressure),
    fanSpeed: n(record.fanSpeed),
    coilTemp: n(record.coilTemp),
    damperPosition: n(record.damperPosition),
    current: n(record.current),
    isCurrentFallback: Boolean(record.isCurrentFallback),
    voltage: n(record.voltage),
    isVoltageFallback: Boolean(record.isVoltageFallback),
    runHours: n(record.runHours),
    heaterOutput: n(record.heaterOutput),
  };
}
