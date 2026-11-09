import type { RtdbAdapter } from "./store";
import { getLatestTelemetry, type RtdbTelemetryRecord } from "./telemetry";

/**
 * Phase 2 Slice B: live dashboard reads from the RTDB telemetry mirror.
 *
 * The dashboard's newest-observation read tries `telemetryLatest/{ahuId}`
 * first and falls back to PostgreSQL per-AHU whenever the mirror cannot
 * serve a unit (not mirrored yet, RTDB error, or Firebase not configured).
 * PostgreSQL remains the source of truth until the Phase 5 cutover — the
 * fallback is the normal path, not an error path.
 */

/** True when the environment carries both the public config and admin credentials. */
export function firebaseEnvConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.NEXT_PUBLIC_FIREBASE_PROJECT_ID && (env.FIREBASE_SERVICE_ACCOUNT_PATH || env.FIREBASE_SERVICE_ACCOUNT_JSON),
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
 * mirror could serve; the caller backfills the rest from PostgreSQL.
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

/**
 * Fire-and-forget RTDB mirror runner shared by the Phase 2 data-plane hooks
 * (telemetry ingest, command lifecycle, alarm lifecycle). Silent no-op when
 * Firebase env vars are absent (local/PGlite runs stay pure PostgreSQL);
 * failures are logged and never propagate to the caller.
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
 * The subset of the PostgreSQL telemetry row the dashboard card build
 * consumes (see getDashboard in src/lib/queries.ts). The full PG row is
 * structurally assignable to this; RTDB records are mapped via toLatestRow.
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
 * to preserve the exact PostgreSQL/JSON API shapes the UI was built against.
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
    isCurrentFallback: n(record.isCurrentFallback),
    voltage: n(record.voltage),
    isVoltageFallback: n(record.isVoltageFallback),
    runHours: n(record.runHours),
    heaterOutput: n(record.heaterOutput),
  };
}
