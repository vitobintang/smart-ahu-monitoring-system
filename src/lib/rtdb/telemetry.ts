import type { RtdbAdapter } from "./store";

/**
 * Telemetry records in the Realtime Database (Phase 2 data plane).
 *
 * Tree layout (agreed migration design):
 *   telemetry/{ahuId}/{YYYY-MM-DD}/{messageId} → full observation (history,
 *     sharded per UTC day; messageId key gives the same idempotency the
 *     a unique index on (ahuId, messageId))
 *   telemetryLatest/{ahuId}                    → newest observation per AHU
 *     (never regresses: late/historical samples do not overwrite newer ones)
 *
 * RTDB is authoritative —
 * authoritative until the Phase 5 cutover; a failed RTDB write is logged and
 * dropped, never surfaced to ingestion.
 *
 * All writes go through the trusted server (Admin SDK bypasses security rules).
 */

export const TELEMETRY_NODE = "telemetry";
export const TELEMETRY_LATEST_NODE = "telemetryLatest";

/** Flattened telemetry row (one per message). */
export interface RtdbTelemetryRecord {
  ahuId: string;
  messageId: string;
  /** PHYSICAL | SIMULATION */
  source: string;
  /** Device measurement time, epoch milliseconds. */
  timestamp: number;
  /** Server mirror time, epoch milliseconds. */
  receivedAt: number;
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
  runState: string | null;
  faultCode: string | null;
}

/** UTC calendar-day shard key, e.g. "2026-11-09". */
export function telemetryDateKey(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

export function telemetryNode(ahuId: string, dateKey: string, messageId: string): string {
  return `${TELEMETRY_NODE}/${ahuId}/${dateKey}/${messageId}`;
}

export function telemetryLatestNode(ahuId: string): string {
  return `${TELEMETRY_LATEST_NODE}/${ahuId}`;
}

/**
 * Writes one observation to the history tree and, transactionally, to the
 * latest pointer. Idempotent per messageId (same key → same value rewritten).
 * A late sample updates history but never regresses `telemetryLatest`.
 */
export async function writeTelemetryMirror(rtdb: RtdbAdapter, record: RtdbTelemetryRecord): Promise<void> {
  const dateKey = telemetryDateKey(record.timestamp);
  await Promise.all([
    rtdb.set(telemetryNode(record.ahuId, dateKey, record.messageId), record),
    rtdb.transaction<RtdbTelemetryRecord>(telemetryLatestNode(record.ahuId), (current) => {
      if (!current || record.timestamp >= current.timestamp) return record;
      return current; // older (late/historical) sample — keep the newer one
    }),
  ]);
}

/** Convenience read for Slice B (live dashboard values). */
export function getLatestTelemetry(rtdb: RtdbAdapter, ahuId: string): Promise<RtdbTelemetryRecord | null> {
  return rtdb.get<RtdbTelemetryRecord>(telemetryLatestNode(ahuId));
}

/** First day RTDB telemetry shards exist for (when this codebase went live). */
export const TELEMETRY_START_DATE = "2026-11-09";

/**
 * Retention: removes whole UTC day shards older than `daysToKeep` from now,
 * for every AHU. Candidate days are derived arithmetically (RTDB has no
 * keys-only listing through the Admin SDK); removing a nonexistent path is a
 * no-op, so the sweep is safe to run repeatedly. `telemetryLatest` is never
 * pruned — it always holds the newest observation per unit.
 *
 * Spark plan sizing: ~35 MB/day for the 7-AHU fleet → 30-day retention sits
 * around 1 GB only if growth doubles; the default 30 keeps comfortable
 * headroom and is tunable via TELEMETRY_RETENTION_DAYS.
 */
export async function pruneTelemetryShards(
  rtdb: RtdbAdapter,
  ahuIds: readonly string[],
  daysToKeep: number,
  now: number = Date.now(),
  startDate: string = process.env.RTDB_TELEMETRY_START_DATE ?? TELEMETRY_START_DATE,
): Promise<number> {
  const cutoffDay = telemetryDateKey(now - daysToKeep * 86_400_000);
  const candidates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  while (telemetryDateKey(cursor.getTime()) < cutoffDay && candidates.length < 366) {
    candidates.push(telemetryDateKey(cursor.getTime()));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  let removed = 0;
  for (const ahuId of ahuIds) {
    for (const day of candidates) {
      const shard = await rtdb.get<Record<string, unknown>>(`${TELEMETRY_NODE}/${ahuId}/${day}`);
      if (shard) {
        await rtdb.remove(`${TELEMETRY_NODE}/${ahuId}/${day}`);
        removed += 1;
      }
    }
  }
  return removed;
}
