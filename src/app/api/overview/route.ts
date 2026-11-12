import { requireAuth, jsonError } from "@/lib/auth";
import { getDashboard } from "@/lib/queries";
import { getSyncStatus } from "@/lib/realtime";
import { maybePulseWorkers } from "@/lib/workers";
import { tryGetAhuRtdb } from "@/lib/rtdb/live-read";
import { readTelemetryRange } from "@/lib/rtdb/history";
import { readActiveAlarmRecords, alarmToRow } from "@/lib/rtdb/alarms";
import { readRtdbUnackedTrends, trendToRow } from "@/lib/rtdb/trends";

export const dynamic = "force-dynamic";

/** Per-AHU supply-temperature series, bucketed per minute (dashboard trend). */
async function fleetSeries(windowMin: number) {
  const since = new Date(Date.now() - windowMin * 60_000);
  // Phase 5b primary flip: series read from RTDB day shards when configured.
  try {
    const rtdb = await tryGetAhuRtdb();
    if (rtdb) {
      // Series cover the ACTIVE fleet only (Daikin DB ⇄ My DB switch).
      const { readActiveFleetRecords } = await import("@/lib/rtdb/local-fleet");
      const ids = [...(await readActiveFleetRecords(rtdb)).keys()].sort();
      const ranges = await Promise.all(ids.map((id) => readTelemetryRange(rtdb, id, since.getTime(), Date.now())));
      const rows = ranges.flatMap((samples, i) =>
        samples
          .filter((s) => s.supplyTemp !== null)
          .map((s) => ({ ahuId: ids[i], t: new Date(s.timestamp), v: s.supplyTemp as number })),
      );
      return bucketFleetSeries(rows, windowMin);
    }
  } catch (err) {
    console.error("[overview] RTDB fleet series failed:", err instanceof Error ? err.message : err);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

function bucketFleetSeries(
  rows: Array<{ ahuId: string; t: Date; v: number | null }>,
  windowMin: number,
): Record<string, { t: number; v: number }[]> {
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
    // Phase 5b primary flip: recent active alarms (priority-ordered) and
    // unacknowledged trends read from RTDB when configured.
    let recentAlarms: Array<Record<string, unknown>> = [];
    let recentTrends: Array<Record<string, unknown>> = [];
    if (!lite) {
      const rtdb = await tryGetAhuRtdb();
      if (rtdb) {
        // Panels cover the ACTIVE fleet only — the idle source stays silent.
        const { readActiveFleetRecords } = await import("@/lib/rtdb/local-fleet");
        const fleetIds = new Set((await readActiveFleetRecords(rtdb)).keys());
        const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 } as Record<string, number>;
        const records = (await readActiveAlarmRecords(rtdb)).filter((r) => fleetIds.has(r.ahuId));
        recentAlarms = records
          .sort((a, b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3) || b.triggeredAt - a.triggeredAt)
          .slice(0, 12)
          .map(alarmToRow);
        recentTrends = (await readRtdbUnackedTrends(rtdb, 8))
          .filter((r) => fleetIds.has(r.ahuId))
          .map(trendToRow);
      } else {
        recentAlarms = [];
        recentTrends = [];
      }
    }

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
    overviewCache.set(key, { data: payload, expiresAt: Date.now() + 2500 });
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
