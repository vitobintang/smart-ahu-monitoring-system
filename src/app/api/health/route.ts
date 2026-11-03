import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Liveness probe.
 *
 * This endpoint never returns 5xx solely because PostgreSQL is still warming up.
 * After a container or process restart, database connectivity can lag the Node
 * listener by several seconds; returning 500 during liveness checks would cause
 * load balancers or orchestrators to recycle a healthy web process.
 *
 * It therefore reports process liveness unconditionally and surfaces database
 * readiness as a separate, non-fatal field.
 */
export async function GET() {
  let database: "connected" | "warming-up" = "warming-up";
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("probe timeout")), 1500)),
    ]);
    database = "connected";
  } catch {
    database = "warming-up";
  }
  const mem = process.memoryUsage();
  return Response.json({
    ok: true,
    service: "smart-monitoring-ahu",
    database,
    memPct: Math.round((mem.heapUsed / Math.max(1, mem.heapTotal)) * 100),
    time: new Date().toISOString(),
  });
}