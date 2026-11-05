import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { alarms } from "@/db/schema";
import { getClientIp, jsonError, requireAuth, writeAudit } from "@/lib/auth";
import { publishRealtime } from "@/lib/realtime";

export const dynamic = "force-dynamic";

/** FR-15 distinct Active / Resolved alarm lists. */
export async function GET(req: Request) {
  try {
    await requireAuth("view");
    const url = new URL(req.url);
    const state = url.searchParams.get("state") ?? "active";
    const ahuId = url.searchParams.get("ahuId");
    const conds = [];
    if (state === "active") conds.push(eq(alarms.isActive, true));
    if (state === "resolved") conds.push(eq(alarms.isActive, false));
    if (ahuId) conds.push(eq(alarms.ahuId, ahuId));
    const [rows, counts] = await Promise.all([
      db
        .select()
        .from(alarms)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(alarms.triggeredAt))
        .limit(400),
      db
        .select({ active: sql<number>`count(*) filter (where ${alarms.isActive})::int` })
        .from(alarms),
    ]);
    return Response.json({ alarms: rows, activeCount: counts[0]?.active ?? 0, state });
  } catch (err) {
    return jsonError(err);
  }
}

/**
 * FR-15 acknowledge: stores user id + timestamp.
 * Critical rule: acknowledging NEVER clears/resolves an active alarm.
 */
export async function POST(req: Request) {
  try {
    const actor = await requireAuth("ack", { mutating: true });
    const body = (await req.json()) as { alarmId?: string };
    if (!body.alarmId) return Response.json({ error: "alarmId is required" }, { status: 400 });
    const rows = await db.select().from(alarms).where(eq(alarms.id, body.alarmId)).limit(1);
    const alarm = rows[0];
    if (!alarm) return Response.json({ error: "Alarm not found" }, { status: 404 });

    await db
      .update(alarms)
      .set({ acknowledged: true, acknowledgedBy: actor.user.id, acknowledgedAt: new Date() })
      .where(eq(alarms.id, alarm.id));

    const ip = await getClientIp();
    await writeAudit({
      userId: actor.user.id,
      userEmail: actor.user.email,
      action: "ALARM_ACKNOWLEDGED",
      entity: `alarm:${alarm.id}`,
      ipAddress: ip,
      details: {
        ahuId: alarm.ahuId,
        parameter: alarm.parameter,
        priority: alarm.priority,
        stillActive: alarm.isActive,
        note: "Acknowledgment does not resolve the alarm condition (FR-15)",
      },
    });
    await publishRealtime("notification", alarm.ahuId, {
      type: "ALARM_ACKNOWLEDGED",
      alarmId: alarm.id,
      ahuId: alarm.ahuId,
      by: actor.user.email,
      at: new Date().toISOString(),
    });
    return Response.json({ ok: true, alarm: { ...alarm, acknowledged: true, acknowledgedBy: actor.user.id } });
  } catch (err) {
    return jsonError(err);
  }
}