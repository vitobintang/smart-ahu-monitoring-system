import type { RtdbAdapter } from "./store";

/**
 * Device data plane — the APP database mirrors the OWNER project's layout.
 *
 *   devices/{id}                        verbatim live copy of the owner's
 *     └─ app/                           device node (his fields only) +
 *                                       app-owned metadata subtree
 *   deviceHistory/{id}/{YYYY-MM-DD}/{s21-{id}-{ts}}
 *                                       verbatim snapshot per accepted sync
 *                                       (UTC day shard, idempotent key)
 *
 * `RtdbTelemetryRecord` is a VIEW synthesized from those snapshots so the
 * dashboard/reports layer keeps its stable shape. Field extraction is
 * tolerant: known Daikin S21 fields (room_temp, fan, power, setpoint, mode,
 * state_valid, simulated, timestamp) map onto the record; unknown fields are
 * still stored verbatim and simply read as null until the mapper learns them.
 *
 * All writes go through the trusted server (Admin SDK bypasses security rules).
 */

export const DEVICE_HISTORY_NODE = "deviceHistory";
/** The fleet/live tree in the APP database — mirrors the owner project's layout. */
export const DEVICE_MIRROR_NODE = "devices";
/** App-owned metadata subtree under each device node (never touched by sync). */
export const APP_META_CHILD = "app";

/** Legacy alias (old node name) kept only for migration tooling references. */
export const TELEMETRY_NODE = DEVICE_HISTORY_NODE;

/** Flattened telemetry row (one per message) — synthesized view of a snapshot. */
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
  return `${DEVICE_HISTORY_NODE}/${ahuId}/${dateKey}/${messageId}`;
}

/** Deterministic snapshot key — idempotency per (device, device timestamp). */
export function snapshotMessageId(ahuId: string, timestampMs: number): string {
  return `s21-${ahuId}-${timestampMs}`;
}

/** Latest pointer: the mirror node itself IS the latest state. */
export function telemetryLatestNode(ahuId: string): string {
  return `${DEVICE_MIRROR_NODE}/${ahuId}`;
}

function toMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = value.length >= 12 && /^\d+$/.test(value) ? Number(value) : Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function num(...candidates: unknown[]): number | null {
  for (const v of candidates) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * VERIFIED owner layout: live fields sit at devices/{id}/status. Accept either
 * the wrapped device node or a bare status payload.
 */
export function unwrapStatus(snapshot: Record<string, unknown>): Record<string, unknown> {
  const status = snapshot["status"];
  if (status && typeof status === "object" && !Array.isArray(status)) {
    return status as Record<string, unknown>;
  }
  return snapshot;
}

/**
 * Synthesizes the stable telemetry view from a verbatim device snapshot.
 * Returns null when the snapshot carries no usable timestamp.
 */
export function snapshotToRecord(ahuId: string, snapshot: Record<string, unknown>): RtdbTelemetryRecord | null {
  const node = unwrapStatus(snapshot);
  const ts = toMs(node.timestamp);
  if (ts === null) return null;
  const power = node.power;
  return {
    ahuId,
    messageId: snapshotMessageId(ahuId, ts),
    // source "mock" or simulated flag → SIMULATION (per the verified bridge shape)
    source: node.simulated === true || node.source === "mock" ? "SIMULATION" : "PHYSICAL",
    timestamp: ts,
    receivedAt: ts,
    roomTemp: num(node.room_temp, node.roomTemp),
    supplyTemp: num(node.supply_temp, node.supplyTemp),
    returnTemp: num(node.return_temp, node.returnTemp),
    humidity: num(node.humidity),
    filterDiffPressure: num(node.filter_diff_pressure, node.filterDiffPressure),
    fanSpeed: num(node.fan), // "auto" (string) → null; numeric strings map
    coilTemp: num(node.coil_temp, node.coilTemp),
    damperPosition: num(node.damper_position, node.damperPosition),
    current: num(node.current),
    isCurrentFallback: false,
    voltage: num(node.voltage),
    isVoltageFallback: false,
    runHours: num(node.run_hours, node.runHours),
    heaterOutput: num(node.heater_output, node.heaterOutput),
    runState: power === true ? "RUN" : power === false ? "STOP" : null,
    faultCode: node.state_valid === false ? "INVALID" : str(node.fault),
  };
}

/**
 * Writes one verbatim device snapshot: history shard + live mirror update.
 * Idempotent per snapshot key (re-processing the same device timestamp is a
 * no-op). The mirror update writes ONLY the snapshot's own fields, so the
 * app-owned `app/` metadata subtree is never touched. Returns the synthesized
 * record and whether anything was written.
 */
export async function writeDeviceSnapshot(
  rtdb: RtdbAdapter,
  ahuId: string,
  snapshot: Record<string, unknown>,
): Promise<{ written: boolean; record: RtdbTelemetryRecord | null }> {
  const record = snapshotToRecord(ahuId, snapshot);
  if (!record) return { written: false, record: null };
  const path = telemetryNode(ahuId, telemetryDateKey(record.timestamp), record.messageId);
  // The live mirror never regresses: a late/historical snapshot lands in
  // history only — devices/{id}/status keeps the newest reported state.
  const mirrorNow = await rtdb.get<{ timestamp?: unknown }>(`${DEVICE_MIRROR_NODE}/${ahuId}/status`);
  const mirrorTs = typeof mirrorNow?.timestamp === "number" ? mirrorNow.timestamp : null;
  const mirrorIsNewer = mirrorTs !== null && record.timestamp < mirrorTs;
  const existing = await rtdb.get<unknown>(path);
  if (existing !== null && existing !== undefined) {
    // duplicate: report the view of the FIRST stored snapshot
    const stored =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? snapshotToRecord(ahuId, existing as Record<string, unknown>)
        : null;
    return { written: false, record: stored ?? record };
  }
  await rtdb.set(path, snapshot);
  if (!mirrorIsNewer) {
    await rtdb.update(`${DEVICE_MIRROR_NODE}/${ahuId}`, snapshot);
  }
  return { written: true, record };
}

/** Live device view: reads the mirror node and synthesizes the telemetry row. */
export async function getLatestTelemetry(rtdb: RtdbAdapter, ahuId: string): Promise<RtdbTelemetryRecord | null> {
  const node = await rtdb.get<Record<string, unknown>>(telemetryLatestNode(ahuId));
  if (!node || typeof node !== "object") return null;
  return snapshotToRecord(ahuId, node);
}

/** First day RTDB history shards exist for (when this codebase went live). */
export const TELEMETRY_START_DATE = "2026-11-09";

/**
 * Retention: removes whole UTC day shards older than `daysToKeep` from now,
 * for every device. Candidate days are derived arithmetically (RTDB has no
 * keys-only listing through the Admin SDK); removing a nonexistent path is a
 * no-op, so the sweep is safe to run repeatedly. The live `devices/` mirror
 * is never pruned.
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
      const shard = await rtdb.get<Record<string, unknown>>(`${DEVICE_HISTORY_NODE}/${ahuId}/${day}`);
      if (shard) {
        await rtdb.remove(`${DEVICE_HISTORY_NODE}/${ahuId}/${day}`);
        removed += 1;
      }
    }
  }
  return removed;
}
