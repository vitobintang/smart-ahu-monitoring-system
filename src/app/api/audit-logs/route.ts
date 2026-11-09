import { jsonError, requireAuth } from "@/lib/auth";
import { requireRtdb } from "@/lib/rtdb/live-read";
import { auditEntryToJson, distinctAuditActions, filterAuditEntries, type RtdbAuditRecord } from "@/lib/rtdb/audit";

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
    const tree = (await rtdb.get<Record<string, RtdbAuditRecord>>("auditLogs")) ?? {};
    const entries = Object.values(tree);
    const logs = filterAuditEntries(entries, { action, entity, limit: Number.isFinite(limit) ? limit : 150 });
    return Response.json({ logs: logs.map(auditEntryToJson), actions: distinctAuditActions(entries) });
  } catch (err) {
    return jsonError(err);
  }
}
