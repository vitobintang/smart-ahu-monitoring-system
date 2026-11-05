import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { alarms, telemetry, trendAlerts } from "@/db/schema";
import { requireAuth, jsonError } from "@/lib/auth";
import { getDashboard } from "@/lib/queries";
import { getSyncStatus } from "@/lib/realtime";
import { authoritativeTelemetry } from "@/lib/source";
import { maybePulseWorkers } from "@/lib/workers";

export const dynamic = "force-dynamic";

/** Per-AHU supply-temperature series, bucketed per minute (dashboard trend). */
async function fleetSeries(windowMin: number) {
  const since = new Date(Date.now() - windowMin * 60_000);
  const rows = await db
    .select({ ahuId: telemetry.ahuId, t: telemetry.timestamp, v: telemetry.supplyTemp })
    .from(telemetry)
    .where(and(gte(telemetry.timestamp, since), isNotNull(telemetry.supplyTemp), authoritativeTelemetry()))
    .orderBy(telemetry.timestamp);
  const bucketMs = windowMin <= 5 ? 30_000 : 60_000;
  const acc = new Map<string, Map<number, { sum: number; n: number }>>();
  for (const r of rows) {
    if (r.v === null) continue;
    const key = Math.floor(r.t.getTime() / bucketMs) * bucketMs;
    const per = acc.get(r.ahuId) ?? new Map<number, { sum: number; n: number }>();
    const cell = per.get(key) ?? { sum: 0, n: 0 };
    cell.sum += r.v;
    cell.n += 1;
    per.set(key, cell);
    acc.set(r.ahuId, per);
  }
  const out: Record<string, { t: number; v: number }[]> = {};
  for (const [ahuId, per] of acc.entries()) {
    out[ahuId] = [...per.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, c]) => ({ t, v: Number((c.sum / c.n).toFixed(2)) }));
  }
  return out;
}

const g = globalThis as typeof globalThis & {
  __ahuOverviewInFlight?: Map<string, Promise<Record<string, unknown>>>;
  __ahuOverviewCache?: Map<string, { data: Record<string, unknown>; expiresAt: number }>;
};
const overviewInFlight = (g.__ahuOverviewInFlight ??= new Map());
const overviewCache = (g.__ahuOverviewCache ??= new Map());

async function loadOverview(windowMin: number, lite: boolean): Promise<Record<string, unknown>> {
  const key = `${lite ? "lite" : "full"}:${windowMin}`;
  const now = Date.now();
  const cached = overviewCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }
  const existing = overviewInFlight.get(key);
  if (existing) return existing;

  const work = (async () => {
    maybePulseWorkers();
    const dash = await getDashboard();
    const sync = await getSyncStatus();
    const recentAlarms = lite
      ? []
      : await db
          .select()
          .from(alarms)
          .where(eq(alarms.isActive, true))
          .orderBy(
            sql`case ${alarms.priority} when 'CRITICAL' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end`,
            desc(alarms.triggeredAt),
          )
          .limit(12);
    const recentTrends = lite
      ? []
      : await db
          .select()
          .from(trendAlerts)
          .where(eq(trendAlerts.acknowledged, false))
          .orderBy(desc(trendAlerts.createdAt))
          .limit(8);
    const series = lite ? {} : await fleetSeries(windowMin);

    const payload: Record<string, unknown> = {
      ...dash,
      sync,
      recentAlarms,
      recentTrends,
      fleetSeries: series,
      windowMin,
      serverTime: new Date().toISOString(),
    };
    overviewCache.set(key, { data: payload, expiresAt: Date.now() + 350 });
    return payload;
  })().finally(() => {
    overviewInFlight.delete(key);
  });

  overviewInFlight.set(key, work);
  return work;
}

/** FR-03 monitoring dashboard overview (all four roles may view). */
export async function GET(req: Request) {
  try {
    await requireAuth("view");
    const url = new URL(req.url);
    const win = Number(url.searchParams.get("window") ?? 15);
    const windowMin = [5, 15, 30].includes(win) ? win : 15;
    const lite = url.searchParams.get("lite") === "1";
    const payload = await loadOverview(windowMin, lite);
    return Response.json(payload);
  } catch (err) {
    return jsonError(err);
  }
}
