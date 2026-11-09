import type { RtdbAdapter } from "./store";

/**
 * Telemetry records in the Realtime Database (Phase 2 data plane).
 *
 * Tree layout (agreed migration design):
 *   telemetry/{ahuId}/{YYYY-MM-DD}/{messageId} → full observation (history,
 *     sharded per UTC day; messageId key gives the same idempotency the
 *     PostgreSQL unique index telemetry_ahu_message_uidx provided)
 *   telemetryLatest/{ahuId}                    → newest observation per AHU
 *     (never regresses: late/historical samples do not overwrite newer ones)
 *
 * Phase 2 Slice A runs this as a dual-write mirror — PostgreSQL stays
 * authoritative until the Phase 5 cutover; a failed RTDB write is logged and
 * dropped, never surfaced to ingestion.
 *
 * All writes go through the trusted server (Admin SDK bypasses security rules).
 */

export const TELEMETRY_NODE = "telemetry";
export const TELEMETRY_LATEST_NODE = "telemetryLatest";

/** Flattened telemetry row — mirrors the PostgreSQL `telemetry` columns. */
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
