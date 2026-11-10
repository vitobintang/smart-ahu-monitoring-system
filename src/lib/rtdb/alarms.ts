import type { RtdbAdapter } from "./store";

/**
 * Alarm records in the Realtime Database (Phase 2 Slice D).
 *
 * Tree layout (one alarm record per id):
 *   alarms/{alarmId} → full alarm record (epoch-ms timestamps)
 *
 * Lifecycle mirrors:
 *   raise       → writeRtdbAlarm (full record, isActive: true)
 *   acknowledge → applyAlarmAck (owner fields patched by id)
 *   resolve     → applyAlarmResolve (isActive: false + resolvedAt)
 *
 * Alarms are id-keyed with no cross-record invariants, so transitions are
 * simple patches — unlike the command active-slot, no transaction guard is
 * needed. Writes go through this module only:
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

/**
 * Breach-timer tree (Phase 5b) — the engine's alarm debounce state, previously
 * a per-AHU breach-timer tree. Nested so an AHU-wide reset
 * (used when a unit goes OFFLINE or its alarms are force-resolved) is a single
 * node remove:
 *   alarmBreachTimers/{ahuId}/{parameter}:{DIR} → { firstAt (epoch-ms) }
 */
export const BREACH_TIMERS_NODE = "alarmBreachTimers";

export async function readRtdbBreachTimer(rtdb: RtdbAdapter, ahuId: string, parameter: string, direction: string): Promise<number | null> {
  const rec = await rtdb.get<{ firstAt: number }>(`${BREACH_TIMERS_NODE}/${ahuId}/${parameter}:${direction}`);
  return rec ? rec.firstAt : null;
}

export async function writeRtdbBreachTimer(rtdb: RtdbAdapter, ahuId: string, parameter: string, direction: string, firstAt: number): Promise<void> {
  await rtdb.set(`${BREACH_TIMERS_NODE}/${ahuId}/${parameter}:${direction}`, { firstAt });
}

export async function removeRtdbBreachTimer(rtdb: RtdbAdapter, ahuId: string, parameter: string, direction: string): Promise<void> {
  await rtdb.remove(`${BREACH_TIMERS_NODE}/${ahuId}/${parameter}:${direction}`);
}

/** Clears every timer for one AHU (the `delete … where id like 'AHU:%'` equivalent). */
export async function removeRtdbBreachTimersForAhu(rtdb: RtdbAdapter, ahuId: string): Promise<void> {
  await rtdb.remove(`${BREACH_TIMERS_NODE}/${ahuId}`);
}

/** Reads the full records of every alarm currently marked active. */
export async function readActiveAlarmRecords(rtdb: RtdbAdapter): Promise<RtdbAlarmRecord[]> {
  const index = (await rtdb.get<Record<string, boolean>>(ALARMS_ACTIVE_NODE)) ?? {};
  const ids = Object.keys(index);
  const records = await Promise.all(ids.map((id) => rtdb.get<RtdbAlarmRecord>(alarmNode(id))));
  return records.filter((r): r is RtdbAlarmRecord => r !== null);
}

/** Per-AHU active-alarm counts (the dashboard card aggregation). */
export interface AlarmCountRow {
  ahuId: string;
  active: number;
  critical: number;
  unacked: number;
}

/**
 * Aggregates the active index into per-AHU counts — the RTDB replacement for
 * the dashboard's per-AHU active/critical/unacked aggregation.
 */
export async function readAlarmCounts(rtdb: RtdbAdapter, ahuIds: string[]): Promise<Map<string, AlarmCountRow>> {
  const records = await readActiveAlarmRecords(rtdb);
  const map = new Map<string, AlarmCountRow>(ahuIds.map((id) => [id, { ahuId: id, active: 0, critical: 0, unacked: 0 }]));
  for (const r of records) {
    const row = map.get(r.ahuId);
    if (!row) continue;
    row.active += 1;
    if (r.priority === "CRITICAL") row.critical += 1;
    if (!r.acknowledged) row.unacked += 1;
  }
  return map;
}

/**
 * Full alarm history for one AHU (active + resolved), newest triggered first —
 * the RTDB replacement for the unit page's `order by triggered_at desc limit N`
 * dashboard query.
 */
export async function readAlarmHistory(rtdb: RtdbAdapter, ahuId: string, limit = 60): Promise<RtdbAlarmRecord[]> {
  const tree = (await rtdb.get<Record<string, RtdbAlarmRecord>>(ALARMS_NODE)) ?? {};
  return Object.values(tree)
    .filter((r) => r.ahuId === ahuId)
    .sort((a, b) => b.triggeredAt - a.triggeredAt)
    .slice(0, limit);
}

/**
 * Maps a record onto the alarms row shape the UI expects (Date instances,
 * same field names) so JSON responses keep their exact API shape.
 */
export function alarmToRow(record: RtdbAlarmRecord): Record<string, unknown> {
  // `n()` restores nulls RTDB stripped (see live-read.ts) — the dashboard's
  // `observedValue !== null` guard depends on it.
  const n = <T,>(value: T | undefined): T | null => (value === undefined ? null : (value as T));
  return {
    id: record.id,
    ahuId: record.ahuId,
    parameter: record.parameter,
    priority: record.priority,
    message: record.message,
    breachDirection: n(record.breachDirection),
    observedValue: n(record.observedValue),
    thresholdValue: n(record.thresholdValue),
    isActive: record.isActive,
    acknowledged: record.acknowledged,
    acknowledgedBy: n(record.acknowledgedBy),
    acknowledgedAt: record.acknowledgedAt == null ? null : new Date(record.acknowledgedAt),
    triggeredAt: new Date(record.triggeredAt),
    resolvedAt: record.resolvedAt == null ? null : new Date(record.resolvedAt),
  };
}

/** JSON shape for API responses (ISO timestamps). */
export function alarmToJson(record: RtdbAlarmRecord): Record<string, unknown> {
  // `n()` restores nulls RTDB stripped (see live-read.ts): null acknowledgedAt/
  // resolvedAt/breachDirection come back as undefined, and new Date(undefined)
  // would throw RangeError on toISOString (prod 500 on /api/alarms?state=active).
  const n = <T,>(value: T | undefined): T | null => (value === undefined ? null : (value as T));
  return {
    ...record,
    breachDirection: n(record.breachDirection),
    observedValue: n(record.observedValue),
    thresholdValue: n(record.thresholdValue),
    acknowledgedBy: n(record.acknowledgedBy),
    acknowledgedAt:
      record.acknowledgedAt === undefined || record.acknowledgedAt === null
        ? null
        : new Date(record.acknowledgedAt).toISOString(),
    triggeredAt: new Date(record.triggeredAt).toISOString(),
    resolvedAt:
      record.resolvedAt === undefined || record.resolvedAt === null
        ? null
        : new Date(record.resolvedAt).toISOString(),
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
