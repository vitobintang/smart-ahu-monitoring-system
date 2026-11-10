import type { RtdbAdapter } from "./store";

/**
 * Audit trail in the Realtime Database (Phase 2 Slice E).
 *
 * Tree layout (one immutable audit entry per id):
 *   auditLogs/{entryId} → one append-only audit entry (epoch-ms timestamps)
 *
 * RTDB is the source of truth.
 * cutover; this tree receives the same entries via the writeAudit() hook.
 * Append-only and id-keyed — no cross-record invariants, so a plain set is
 * Note: entries are
 * mirrored immediately; in the rare case that transaction later rolls back,
 * the RTDB mirror keeps a phantom entry (harmless in an append-only mirror,
 * audit trail is append-only).
 */

export const AUDIT_LOGS_NODE = "auditLogs";

/** Epoch-ms flattened `audit_logs` row. */
export interface RtdbAuditRecord {
  id: string;
  userId: string | null;
  userEmail: string | null;
  action: string;
  entity: string;
  details: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: number;
}

export function auditLogNode(entryId: string): string {
  return `${AUDIT_LOGS_NODE}/${entryId}`;
}

/** Appends one audit entry (idempotent per entryId). */
export function writeRtdbAuditLog(rtdb: RtdbAdapter, record: RtdbAuditRecord): Promise<void> {
  return rtdb.set(auditLogNode(record.id), record);
}

/** JSON shape for API responses (ISO timestamps). */
export function auditEntryToJson(record: RtdbAuditRecord): Record<string, unknown> {
  return { ...record, createdAt: new Date(record.createdAt).toISOString() };
}

export interface AuditEntryFilter {
  /** Substring match on action (mirrors the SQL `LIKE '%action%'`). */
  action?: string | null;
  /** Exact entity match (mirrors the SQL `= entity`). */
  entity?: string | null;
  /** When set, entries tied to a unit OUTSIDE this fleet are hidden (device-source switch). */
  fleetIds?: ReadonlySet<string> | null;
  /** Extra entity→unit resolutions (e.g. "alarm:{id}" → ahuId) for the fleet filter. */
  unitRefs?: ReadonlyMap<string, string>;
  limit?: number;
}

/** Entity prefixes that reference a unit directly ("ahu:{id}", "device:{id}"). */
const UNIT_ENTITY_PREFIXES = ["ahu:", "device:", "unit:"];

/**
 * The unit an audit entry refers to, or null for GLOBAL entries (user
 * management, auth, device-source switch) that must stay visible on every
 * fleet. Resolution: direct entity ref → entity lookup map (alarm/command
 * ids) → details.ahuId written by the engine.
 */
export function auditEntryUnitId(entry: RtdbAuditRecord, unitRefs: ReadonlyMap<string, string> = new Map()): string | null {
  const entity = entry.entity ?? "";
  for (const prefix of UNIT_ENTITY_PREFIXES) {
    if (entity.startsWith(prefix)) return entity.slice(prefix.length).replace(/^owner-/, "");
  }
  const viaRef = unitRefs.get(entity);
  if (viaRef) return viaRef.replace(/^owner-/, "");
  const details = entry.details as { ahuId?: unknown } | null;
  if (details && typeof details.ahuId === "string" && details.ahuId) {
    return details.ahuId.replace(/^owner-/, "");
  }
  // Dangling alarm/command refs cannot be tied to the active fleet — treat
  // them as fleet-bound (hidden) rather than global.
  if (entity.startsWith("alarm:") || entity.startsWith("command:")) return "";
  return null;
}

/** Newest-first filter over audit entries (pure — shared by the API flip). */
export function filterAuditEntries(entries: RtdbAuditRecord[], filter: AuditEntryFilter): RtdbAuditRecord[] {
  const limit = Number.isFinite(filter.limit) ? Number(filter.limit) : 150;
  const unitRefs = filter.unitRefs ?? new Map<string, string>();
  return entries
    .filter((e) => (filter.action ? e.action.includes(filter.action) : true))
    .filter((e) => (filter.entity ? e.entity === filter.entity : true))
    .filter((e) => {
      if (!filter.fleetIds) return true;
      const unit = auditEntryUnitId(e, unitRefs);
      return unit === null || filter.fleetIds.has(unit);
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/** Distinct actions across the whole audit tree, sorted (dropdown options). */
export function distinctAuditActions(entries: RtdbAuditRecord[]): string[] {
  return [...new Set(entries.map((e) => e.action))].sort();
}
