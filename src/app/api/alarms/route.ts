import { requireRtdb } from "@/lib/rtdb/live-read";
import {
  ALARMS_NODE,
  alarmNode,
  alarmToJson,
  applyAlarmAck,
  readActiveAlarmRecords,
  type RtdbAlarmRecord,
} from "@/lib/rtdb/alarms";
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

    const rtdb = await requireRtdb();
    let records: RtdbAlarmRecord[];
    if (state === "active") {
      // The ACTIVE list reads the alarmsActive index (kept in sync by the
      // engine on every raise/resolve transition).
      records = await readActiveAlarmRecords(rtdb);
    } else {
      // Resolved history scans the full alarms node.
      const tree = (await rtdb.get<Record<string, RtdbAlarmRecord>>(ALARMS_NODE)) ?? {};
      records = Object.values(tree).filter((r) => !r.isActive);
    }
    const filtered = ahuId ? records.filter((r) => r.ahuId === ahuId) : records;
    filtered.sort((a, b) => b.triggeredAt - a.triggeredAt);
    return Response.json({
      alarms: filtered.slice(0, 400).map(alarmToJson),
      activeCount: (await readActiveAlarmRecords(rtdb)).length,
      state,
    });
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

    const rtdb = await requireRtdb();
    const alarm = await rtdb.get<RtdbAlarmRecord>(alarmNode(body.alarmId));
    if (!alarm) return Response.json({ error: "Alarm not found" }, { status: 404 });

    const acknowledgedAt = new Date();
    await applyAlarmAck(rtdb, alarm.id, actor.user.id, acknowledgedAt.getTime());

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

    return Response.json({
      ok: true,
      alarm: alarmToJson({
        ...alarm,
        acknowledged: true,
        acknowledgedBy: actor.user.id,
        acknowledgedAt: acknowledgedAt.getTime(),
      }),
    });
  } catch (err) {
    return jsonError(err);
  }
}
