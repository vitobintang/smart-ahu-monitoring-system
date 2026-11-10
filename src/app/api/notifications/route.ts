import { jsonError, requireAuth } from "@/lib/auth";
import { requireRtdb } from "@/lib/rtdb/live-read";
import { readActiveAlarmRecords, alarmToRow } from "@/lib/rtdb/alarms";
import { readRtdbUnackedTrends, trendToRow } from "@/lib/rtdb/trends";
import { readActiveCommandSlots } from "@/lib/rtdb/commands";

export const dynamic = "force-dynamic";

interface NotificationsPayload {
  alarms: ReturnType<typeof alarmToRow>[];
  trends: ReturnType<typeof trendToRow>[];
  commands: Array<{
    id: string;
    ahuId: string;
    commandType: string;
    status: string;
    expiresAt: Date;
  }>;
  serverTime: string;
}

const g = globalThis as typeof globalThis & {
  __ahuNotifInFlight?: Promise<NotificationsPayload> | null;
  __ahuNotifCache?: { data: NotificationsPayload; expiresAt: number } | null;
};

async function loadNotifications(): Promise<NotificationsPayload> {
  const now = Date.now();
  if (g.__ahuNotifCache && g.__ahuNotifCache.expiresAt > now) {
    return g.__ahuNotifCache.data;
  }
  if (g.__ahuNotifInFlight) {
    return g.__ahuNotifInFlight;
  }

  const work = (async () => {
    const rtdb = await requireRtdb();
    // Fleet scoping: the bell only surfaces the ACTIVE fleet's events
    // (Daikin DB ⇄ My DB switch) — the idle source stays silent.
    const { readActiveFleetRecords } = await import("@/lib/rtdb/local-fleet");
    const fleetIds = new Set((await readActiveFleetRecords(rtdb)).keys());
    const [alarmRecords, trendRecords, slots] = await Promise.all([
      readActiveAlarmRecords(rtdb),
      readRtdbUnackedTrends(rtdb, 20),
      readActiveCommandSlots(rtdb),
    ]);
    const payload: NotificationsPayload = {
      alarms: alarmRecords
        .filter((r) => fleetIds.has(r.ahuId))
        .sort((a, b) => b.triggeredAt - a.triggeredAt)
        .slice(0, 20)
        .map(alarmToRow),
      trends: trendRecords.filter((t) => fleetIds.has(t.ahuId)).map(trendToRow),
      commands: [...slots.entries()]
        .filter(([ahuId, slot]) => fleetIds.has(ahuId) && (slot.status === "REQUESTED" || slot.status === "ACCEPTED"))
        .sort((a, b) => b[1].createdAt - a[1].createdAt)
        .slice(0, 10)
        .map(([ahuId, slot]) => ({
          id: slot.commandId,
          ahuId,
          commandType: slot.commandType,
          status: slot.status,
          expiresAt: new Date(slot.expiresAt),
        })),
      serverTime: new Date().toISOString(),
    };
    g.__ahuNotifCache = { data: payload, expiresAt: Date.now() + 350 };
    return payload;
  })().finally(() => {
    g.__ahuNotifInFlight = null;
  });

  g.__ahuNotifInFlight = work;
  return work;
}

/**
 * FR-18 in-app notification feed for active web sessions.
 * Constraint 4: strictly in-app — no email / SMS / WhatsApp dispatchers.
 */
export async function GET() {
  try {
    await requireAuth("view");
    const payload = await loadNotifications();
    return Response.json(payload);
  } catch (err) {
    return jsonError(err);
  }
}
