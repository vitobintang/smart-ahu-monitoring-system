import { and, desc, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { jsonError, requireAuth } from "@/lib/auth";
import { tryGetAhuRtdb } from "@/lib/rtdb/live-read";
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
    const conds = [];
    if (action) conds.push(like(auditLogs.action, `%${action}%`));
    if (entity) conds.push(eq(auditLogs.entity, entity));
    // Phase 3 Slice 1: RTDB auditLogs first, PostgreSQL fallback on any failure.
    try {
      const rtdb = await tryGetAhuRtdb();
      if (rtdb) {
        const tree = (await rtdb.get<Record<string, RtdbAuditRecord>>("auditLogs")) ?? {};
        const entries = Object.values(tree);
        const logs = filterAuditEntries(entries, { action, entity, limit: Number.isFinite(limit) ? limit : 150 });
        return Response.json({ logs: logs.map(auditEntryToJson), actions: distinctAuditActions(entries) });
      }
    } catch (err) {
      console.error("[audit] RTDB read failed, using PostgreSQL:", err instanceof Error ? err.message : err);
    }
    const rows = await db
      .select()
      .from(auditLogs)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(Number.isFinite(limit) ? limit : 150);
    const actions = await db.selectDistinct({ action: auditLogs.action }).from(auditLogs);
    return Response.json({ logs: rows, actions: actions.map((a) => a.action).sort() });
  } catch (err) {
    return jsonError(err);
  }
}