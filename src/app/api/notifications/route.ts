import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { ahuCommands, alarms, trendAlerts } from "@/db/schema";
import { jsonError, requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * FR-18 in-app notification feed for active web sessions.
 * Constraint 4: strictly in-app — no email / SMS / WhatsApp dispatchers.
 */
export async function GET() {
  try {
    await requireAuth("view");
    const [activeAlarms, unackedTrends, activeCommands] = await Promise.all([
      db
        .select()
        .from(alarms)
        .where(eq(alarms.isActive, true))
        .orderBy(desc(alarms.triggeredAt))
        .limit(20),
      db
        .select()
        .from(trendAlerts)
        .where(eq(trendAlerts.acknowledged, false))
        .orderBy(desc(trendAlerts.createdAt))
        .limit(20),
      db
        .select()
        .from(ahuCommands)
        .where(and(inArray(ahuCommands.status, ["REQUESTED", "ACCEPTED"])))
        .orderBy(desc(ahuCommands.createdAt))
        .limit(10),
    ]);
    return Response.json({
      alarms: activeAlarms,
      trends: unackedTrends,
      commands: activeCommands,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    return jsonError(err);
  }
}