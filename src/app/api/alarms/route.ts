import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { mirrorToRtdb, tryGetAhuRtdb } from "@/lib/rtdb/live-read";
import { alarmToJson, applyAlarmAck, readActiveAlarmRecords } from "@/lib/rtdb/alarms";
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
    // Phase 3 Slice 1: the ACTIVE list reads the RTDB alarmsActive index
    // (resolve/ack transitions already maintained it since Slice D).
    // Resolved history stays on PostgreSQL until the history backfill lands.
    if (state === "active") {
      try {
        const rtdb = await tryGetAhuRtdb();
        if (rtdb) {
          const records = await readActiveAlarmRecords(rtdb);
          const filtered = ahuId ? records.filter((r) => r.ahuId === ahuId) : records;
          filtered.sort((a, b) => b.triggeredAt - a.triggeredAt);
          return Response.json({
            alarms: filtered.slice(0, 400).map(alarmToJson),
            activeCount: records.length,
            state,
          });
        }
      } catch (err) {
        console.error("[alarms] RTDB active read failed, using PostgreSQL:", err instanceof Error ? err.message : err);
      }
    }
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

    const acknowledgedAt = new Date();
    await db
      .update(alarms)
      .set({ acknowledged: true, acknowledgedBy: actor.user.id, acknowledgedAt })
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
    // Phase 2 dual-write: mirror the acknowledgement into RTDB (fire-and-forget)
    mirrorToRtdb((rtdb) => applyAlarmAck(rtdb, alarm.id, actor.user.id, acknowledgedAt.getTime()));

    return Response.json({ ok: true, alarm: { ...alarm, acknowledged: true, acknowledgedBy: actor.user.id } });
  } catch (err) {
    return jsonError(err);
  }
}