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
  limit?: number;
}

/** Newest-first filter over audit entries (pure — shared by the API flip). */
export function filterAuditEntries(entries: RtdbAuditRecord[], filter: AuditEntryFilter): RtdbAuditRecord[] {
  const limit = Number.isFinite(filter.limit) ? Number(filter.limit) : 150;
  return entries
    .filter((e) => (filter.action ? e.action.includes(filter.action) : true))
    .filter((e) => (filter.entity ? e.entity === filter.entity : true))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/** Distinct actions across the whole audit tree, sorted (dropdown options). */
export function distinctAuditActions(entries: RtdbAuditRecord[]): string[] {
  return [...new Set(entries.map((e) => e.action))].sort();
}
