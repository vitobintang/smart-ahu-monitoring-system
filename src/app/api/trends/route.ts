import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { trendAlerts } from "@/db/schema";
import { getClientIp, jsonError, requireAuth, writeAudit } from "@/lib/auth";
import { publishRealtime } from "@/lib/realtime";
import { analyseTrendsBatch } from "@/lib/engine";

export const dynamic = "force-dynamic";

/** FR-16 / FR-17 / FR-18: trend proximity estimation + warning history. */
export async function GET(req: Request) {
  try {
    await requireAuth("view");
    const url = new URL(req.url);
    const ahuId = url.searchParams.get("ahuId");
    const unackedOnly = url.searchParams.get("unacked") === "1";

    const conds = [];
    if (ahuId) conds.push(eq(trendAlerts.ahuId, ahuId));
    if (unackedOnly) conds.push(eq(trendAlerts.acknowledged, false));

    const [analyses, history] = await Promise.all([
      analyseTrendsBatch(ahuId ? [ahuId] : undefined),
      db
        .select()
        .from(trendAlerts)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(trendAlerts.createdAt))
        .limit(200),
    ]);

    return Response.json({ analyses, history });
  } catch (err) {
    return jsonError(err);
  }
}

/** FR-18 acknowledge a trend warning. */
export async function POST(req: Request) {
  try {
    const actor = await requireAuth("ack", { mutating: true });
    const body = (await req.json()) as { trendId?: string };
    if (!body.trendId) return Response.json({ error: "trendId is required" }, { status: 400 });
    const rows = await db.select().from(trendAlerts).where(eq(trendAlerts.id, body.trendId)).limit(1);
    const trend = rows[0];
    if (!trend) return Response.json({ error: "Trend alert not found" }, { status: 404 });

    await db
      .update(trendAlerts)
      .set({ acknowledged: true, acknowledgedBy: actor.user.id, acknowledgedAt: new Date() })
      .where(eq(trendAlerts.id, trend.id));

    const ip = await getClientIp();
    await writeAudit({
      userId: actor.user.id,
      userEmail: actor.user.email,
      action: "TREND_ALERT_ACKNOWLEDGED",
      entity: `trend:${trend.id}`,
      ipAddress: ip,
      details: {
        ahuId: trend.ahuId,
        parameter: trend.parameter,
        horizon: trend.estimatedMin,
        direction: trend.direction,
      },
    });
    await publishRealtime("notification", trend.ahuId, {
      type: "TREND_ACKNOWLEDGED",
      trendId: trend.id,
      ahuId: trend.ahuId,
      by: actor.user.email,
      at: new Date().toISOString(),
    });
    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}