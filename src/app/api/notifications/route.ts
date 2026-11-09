import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { ahuCommands, alarms, trendAlerts } from "@/db/schema";
import { jsonError, requireAuth } from "@/lib/auth";
import { tryGetAhuRtdb } from "@/lib/rtdb/live-read";
import { readActiveAlarmRecords, alarmToRow } from "@/lib/rtdb/alarms";
import { readRtdbUnackedTrends, trendToRow } from "@/lib/rtdb/trends";
import { readActiveCommandSlots } from "@/lib/rtdb/commands";

export const dynamic = "force-dynamic";

interface NotificationsPayload {
  alarms: (typeof alarms.$inferSelect)[];
  trends: (typeof trendAlerts.$inferSelect)[];
  commands: (typeof ahuCommands.$inferSelect)[];
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
    // Phase 5b primary flip: active alarms, unacknowledged trend alerts and
    // active commands read from RTDB when Firebase is configured.
    try {
      const rtdb = await tryGetAhuRtdb();
      if (rtdb) {
        const [alarmRecords, trendRecords, slots] = await Promise.all([
          readActiveAlarmRecords(rtdb),
          readRtdbUnackedTrends(rtdb, 20),
          readActiveCommandSlots(rtdb),
        ]);
        const payload: NotificationsPayload = {
          alarms: alarmRecords
            .sort((a, b) => b.triggeredAt - a.triggeredAt)
            .slice(0, 20)
            .map(alarmToRow) as NotificationsPayload["alarms"],
          trends: trendRecords.map(trendToRow) as NotificationsPayload["trends"],
          commands: [...slots.entries()]
            .filter(([, slot]) => slot.status === "REQUESTED" || slot.status === "ACCEPTED")
            .sort((a, b) => b[1].createdAt - a[1].createdAt)
            .slice(0, 10)
            .map(([ahuId, slot]) => ({
              id: slot.commandId,
              ahuId,
              commandType: slot.commandType,
              status: slot.status,
              expiresAt: new Date(slot.expiresAt),
            })) as NotificationsPayload["commands"],
          serverTime: new Date().toISOString(),
        };
        g.__ahuNotifCache = { data: payload, expiresAt: Date.now() + 350 };
        return payload;
      }
    } catch (err) {
      console.error("[notifications] RTDB reads failed, using PostgreSQL:", err instanceof Error ? err.message : err);
    }

    // Run sequentially on a single warm pool connection instead of grabbing 3 slots at once
    const activeAlarms = await db
      .select()
      .from(alarms)
      .where(eq(alarms.isActive, true))
      .orderBy(desc(alarms.triggeredAt))
      .limit(20);
    const unackedTrends = await db
      .select()
      .from(trendAlerts)
      .where(eq(trendAlerts.acknowledged, false))
      .orderBy(desc(trendAlerts.createdAt))
      .limit(20);
    const activeCommands = await db
      .select()
      .from(ahuCommands)
      .where(and(inArray(ahuCommands.status, ["REQUESTED", "ACCEPTED"])))
      .orderBy(desc(ahuCommands.createdAt))
      .limit(10);

    const payload: NotificationsPayload = {
      alarms: activeAlarms,
      trends: unackedTrends,
      commands: activeCommands,
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
