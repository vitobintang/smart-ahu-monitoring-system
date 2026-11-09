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
export const ALARMS_ACTIVE_NODE = "alarmsActive";

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

export function alarmActiveIndexNode(alarmId: string): string {
  return `${ALARMS_ACTIVE_NODE}/${alarmId}`;
}

/**
 * Writes/overwrites the full alarm record (idempotent per alarmId) and keeps
 * the alarmsActive/{id} index in sync — the Phase 3 read path lists active
 * alarms from the index instead of scanning the full history node.
 */
export async function writeRtdbAlarm(rtdb: RtdbAdapter, record: RtdbAlarmRecord): Promise<void> {
  await Promise.all([
    rtdb.set(alarmNode(record.id), record),
    record.isActive
      ? rtdb.set(alarmActiveIndexNode(record.id), true)
      : rtdb.remove(alarmActiveIndexNode(record.id)),
  ]);
}

/** Reads the full records of every alarm currently marked active. */
export async function readActiveAlarmRecords(rtdb: RtdbAdapter): Promise<RtdbAlarmRecord[]> {
  const index = (await rtdb.get<Record<string, boolean>>(ALARMS_ACTIVE_NODE)) ?? {};
  const ids = Object.keys(index);
  const records = await Promise.all(ids.map((id) => rtdb.get<RtdbAlarmRecord>(alarmNode(id))));
  return records.filter((r): r is RtdbAlarmRecord => r !== null);
}

/** PG-JSON shape for API responses (ISO timestamps like the PostgreSQL rows). */
export function alarmToJson(record: RtdbAlarmRecord): Record<string, unknown> {
  return {
    ...record,
    acknowledgedAt: record.acknowledgedAt === null ? null : new Date(record.acknowledgedAt).toISOString(),
    triggeredAt: new Date(record.triggeredAt).toISOString(),
    resolvedAt: record.resolvedAt === null ? null : new Date(record.resolvedAt).toISOString(),
  };
}

/** Mirrors an acknowledgement (acknowledged: true + who/when). */
export function applyAlarmAck(rtdb: RtdbAdapter, alarmId: string, acknowledgedBy: string, acknowledgedAt: number): Promise<void> {
  return rtdb.update(alarmNode(alarmId), {
    acknowledged: true,
    acknowledgedBy,
    acknowledgedAt,
  });
}

/** Mirrors a resolution (isActive: false + resolvedAt) and drops the active index entry. */
export async function applyAlarmResolve(rtdb: RtdbAdapter, alarmId: string, resolvedAt: number): Promise<void> {
  await Promise.all([
    rtdb.update(alarmNode(alarmId), {
      isActive: false,
      resolvedAt,
    }),
    rtdb.remove(alarmActiveIndexNode(alarmId)),
  ]);
}
