import { jsonError, requireAuth } from "@/lib/auth";
import { requireRtdb } from "@/lib/rtdb/live-read";
import { AUDIT_LOGS_NODE, auditEntryToJson, distinctAuditActions, filterAuditEntries, type RtdbAuditRecord } from "@/lib/rtdb/audit";

export const dynamic = "force-dynamic";

/** FR-29 immutable audit log viewer — Admin + Engineering only. */
export async function GET(req: Request) {
  try {
    await requireAuth("viewAudit");
    const url = new URL(req.url);
    const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 150));
    const action = url.searchParams.get("action");
    const entity = url.searchParams.get("entity");

    const rtdb = await requireRtdb();
    const tree = (await rtdb.get<Record<string, RtdbAuditRecord>>(AUDIT_LOGS_NODE)) ?? {};
    const entries = Object.values(tree);
    // The trail itself is append-only (FR-29) — the VIEW follows the active
    // device source: entries tied to idle-source units are hidden, global
    // entries (users, auth, source switch) stay visible.
    const { readActiveFleetRecords } = await import("@/lib/rtdb/local-fleet");
    const fleetIds = new Set((await readActiveFleetRecords(rtdb)).keys());
    const alarms = (await rtdb.get<Record<string, { ahuId?: string }>>("alarms")) ?? {};
    const unitRefs = new Map<string, string>(Object.entries(alarms).map(([id, a]) => [`alarm:${id}`, a?.ahuId ?? ""]));
    const logs = filterAuditEntries(entries, {
      action,
      entity,
      fleetIds,
      unitRefs,
      limit: Number.isFinite(limit) ? limit : 150,
    });
    return Response.json({ logs: logs.map(auditEntryToJson), actions: distinctAuditActions(entries) });
  } catch (err) {
    return jsonError(err);
  }
}
