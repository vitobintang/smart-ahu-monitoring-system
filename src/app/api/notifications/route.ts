import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { ahuCommands, alarms, trendAlerts } from "@/db/schema";
import { jsonError, requireAuth } from "@/lib/auth";

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
