import type { RtdbAdapter } from "./store";

/**
 * Alarm records in the Realtime Database (Phase 2 Slice D).
 *
 * Tree layout (mirrors the PostgreSQL `alarms` table):
 *   alarms/{alarmId} → full alarm record (epoch-ms timestamps)
 *
 * Lifecycle mirrors:
 *   raise       → writeRtdbAlarm (full record, isActive: true)
 *   acknowledge → applyAlarmAck (owner fields patched by id)
 *   resolve     → applyAlarmResolve (isActive: false + resolvedAt)
 *
 * Alarms are id-keyed with no cross-record invariants, so transitions are
 * simple patches — unlike the command active-slot, no transaction guard is
 * needed. Phase 2 runs this as a dual-write mirror: PostgreSQL stays
 * authoritative until the Phase 5 cutover; mirror failures are logged and
 * dropped.
 */

export const ALARMS_NODE = "alarms";

/** Epoch-ms flattened `alarms` row. */
export interface RtdbAlarmRecord {
  id: string;
  ahuId: string;
  parameter: string;
  /** LOW | MEDIUM | HIGH | CRITICAL | COMMUNICATION (schema enum values). */
  priority: string;
  message: string;
  breachDirection: string | null;
  observedValue: number | null;
  thresholdValue: number | null;
  isActive: boolean;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: number | null;
  triggeredAt: number;
  resolvedAt: number | null;
}

export function alarmNode(alarmId: string): string {
  return `${ALARMS_NODE}/${alarmId}`;
}

/** Writes/overwrites the full alarm record (idempotent per alarmId). */
export function writeRtdbAlarm(rtdb: RtdbAdapter, record: RtdbAlarmRecord): Promise<void> {
  return rtdb.set(alarmNode(record.id), record);
}

/** Mirrors an acknowledgement (acknowledged: true + who/when). */
export function applyAlarmAck(rtdb: RtdbAdapter, alarmId: string, acknowledgedBy: string, acknowledgedAt: number): Promise<void> {
  return rtdb.update(alarmNode(alarmId), {
    acknowledged: true,
    acknowledgedBy,
    acknowledgedAt,
  });
}

/** Mirrors a resolution (isActive: false + resolvedAt). */
export function applyAlarmResolve(rtdb: RtdbAdapter, alarmId: string, resolvedAt: number): Promise<void> {
  return rtdb.update(alarmNode(alarmId), {
    isActive: false,
    resolvedAt,
  });
}
