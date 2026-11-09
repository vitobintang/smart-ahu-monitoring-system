import type { RtdbAdapter } from "./store";

/**
 * Audit trail in the Realtime Database (Phase 2 Slice E).
 *
 * Tree layout (mirrors the PostgreSQL `audit_logs` table):
 *   auditLogs/{entryId} → one append-only audit entry (epoch-ms timestamps)
 *
 * PostgreSQL's audit_logs table remains the source of truth until the Phase 5
 * cutover; this tree receives the same entries via the writeAudit() hook.
 * Append-only and id-keyed — no cross-record invariants, so a plain set is
 * sufficient. Note: entries written inside a PostgreSQL transaction are
 * mirrored immediately; in the rare case that transaction later rolls back,
 * the RTDB mirror keeps a phantom entry (harmless in an append-only mirror,
 * PostgreSQL truth is unaffected).
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
