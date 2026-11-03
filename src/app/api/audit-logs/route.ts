import { and, desc, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { jsonError, requireAuth } from "@/lib/auth";

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