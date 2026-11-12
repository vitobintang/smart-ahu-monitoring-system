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
    // Fleet scoping: without an explicit unit, only the ACTIVE fleet's alarms
    // are shown (Daikin DB ⇄ My DB switch) — the idle source stays silent.
    let fleetIds: Set<string> | null = null;
    if (!ahuId) {
      const { readActiveFleetRecords } = await import("@/lib/rtdb/local-fleet");
      fleetIds = new Set((await readActiveFleetRecords(rtdb)).keys());
    }
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
    const filtered = ahuId
      ? records.filter((r) => r.ahuId === ahuId)
      : records.filter((r) => fleetIds?.has(r.ahuId) ?? true);
    filtered.sort((a, b) => b.triggeredAt - a.triggeredAt);
    return Response.json({
      alarms: filtered.slice(0, 400).map(alarmToJson),
      activeCount: fleetIds
        ? (await readActiveAlarmRecords(rtdb)).filter((r) => fleetIds.has(r.ahuId)).length
        : (await readActiveAlarmRecords(rtdb)).length,
      state,
    });
  } catch (err) {
    return jsonError(err);
  }
}

/**
 * FR-15 acknowledge: stores user id + timestamp.
 * Supports acknowledging a single alarm or acknowledging all unacknowledged alarms.
 */
export async function POST(req: Request) {
  try {
    const actor = await requireAuth("ack", { mutating: true });
    const body = (await req.json()) as { alarmId?: string; all?: boolean };
    const rtdb = await requireRtdb();

    if (body.all) {
      const records = await readActiveAlarmRecords(rtdb);
      const unacked = records.filter((r) => !r.acknowledged);
      const now = Date.now();
      await Promise.all(
        unacked.map((r) => applyAlarmAck(rtdb, r.id, actor.user.id, now))
      );
      const ip = await getClientIp();
      await writeAudit({
        userId: actor.user.id,
        userEmail: actor.user.email,
        action: "ALL_ALARMS_ACKNOWLEDGED",
        entity: "alarms:all",
        ipAddress: ip,
        details: { count: unacked.length },
      });
      return Response.json({ ok: true, count: unacked.length });
    }

    if (!body.alarmId) return Response.json({ error: "alarmId is required" }, { status: 400 });

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

/**
 * Deletes / clears an individual alarm, or clears all acknowledged alarms.
 */
export async function DELETE(req: Request) {
  try {
    const actor = await requireAuth("ack", { mutating: true });
    const url = new URL(req.url);
    let body: { alarmId?: string; allAcknowledged?: boolean } = {};
    try {
      body = (await req.json()) as { alarmId?: string; allAcknowledged?: boolean };
    } catch {
      // JSON body is optional; fallback to query params
    }
    const alarmId = body.alarmId || url.searchParams.get("alarmId");
    const allAcknowledged = Boolean(body.allAcknowledged || url.searchParams.get("allAcknowledged") === "true");

    const rtdb = await requireRtdb();
    const { removeRtdbAlarm, removeRtdbAcknowledgedAlarms } = await import("@/lib/rtdb/alarms");

    const ip = await getClientIp();

    if (allAcknowledged) {
      const cleared = await removeRtdbAcknowledgedAlarms(rtdb);
      await writeAudit({
        userId: actor.user.id,
        userEmail: actor.user.email,
        action: "ACKNOWLEDGED_ALARMS_CLEARED",
        entity: "alarms:acknowledged",
        ipAddress: ip,
        details: { count: cleared },
      });
      return Response.json({ ok: true, clearedCount: cleared });
    }

    if (alarmId) {
      const deleted = await removeRtdbAlarm(rtdb, alarmId);
      if (!deleted) return Response.json({ error: "Alarm not found" }, { status: 404 });
      await writeAudit({
        userId: actor.user.id,
        userEmail: actor.user.email,
        action: "ALARM_DELETED",
        entity: `alarm:${alarmId}`,
        ipAddress: ip,
        details: { alarmId },
      });
      return Response.json({ ok: true, alarmId });
    }

    return Response.json({ error: "alarmId or allAcknowledged is required" }, { status: 400 });
  } catch (err) {
    return jsonError(err);
  }
}
