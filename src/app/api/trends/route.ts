import { getClientIp, jsonError, requireAuth, writeAudit } from "@/lib/auth";
import { requireRtdb } from "@/lib/rtdb/live-read";
import { ackRtdbTrendAlert, readRtdbTrendHistory, trendToRow, TREND_ALERTS_NODE, type RtdbTrendRecord } from "@/lib/rtdb/trends";
import { publishRealtime } from "@/lib/realtime";
import { analyseTrendsBatch } from "@/lib/trends";

export const dynamic = "force-dynamic";

/** FR-16 / FR-17 / FR-18: trend proximity estimation + warning history. */
export async function GET(req: Request) {
  try {
    await requireAuth("view");
    const url = new URL(req.url);
    const ahuId = url.searchParams.get("ahuId");
    const unackedOnly = url.searchParams.get("unacked") === "1";

    const rtdb = await requireRtdb();
    const [analyses, history] = await Promise.all([
      analyseTrendsBatch(ahuId ? [ahuId] : undefined),
      ahuId
        ? readRtdbTrendHistory(rtdb, ahuId, 200)
        : (async () => {
            const tree = (await rtdb.get<Record<string, RtdbTrendRecord>>(TREND_ALERTS_NODE)) ?? {};
            return Object.values(tree)
              .sort((a, b) => b.createdAt - a.createdAt)
              .slice(0, 200);
          })(),
    ]);
    const filteredHistory = unackedOnly ? history.filter((t) => !t.acknowledged) : history;

    return Response.json({ analyses, history: filteredHistory.map(trendToRow) });
  } catch (err) {
    return jsonError(err);
  }
}

/** FR-18 acknowledge a trend warning. */
export async function POST(req: Request) {
  try {
    const actor = await requireAuth("ack", { mutating: true });
    const body = (await req.json()) as { trendId?: string };
    if (!body.trendId) return Response.json({ error: "trendId is required" }, { status: 400 });
    const rtdb = await requireRtdb();
    const tree = (await rtdb.get<Record<string, RtdbTrendRecord>>(TREND_ALERTS_NODE)) ?? {};
    const trend = tree[body.trendId];
    if (!trend) return Response.json({ error: "Trend alert not found" }, { status: 404 });

    await ackRtdbTrendAlert(rtdb, trend.id, actor.user.id, Date.now());

    const ip = await getClientIp();
    await writeAudit({
      userId: actor.user.id,
      userEmail: actor.user.email,
      action: "TREND_ALERT_ACKNOWLEDGED",
      entity: `trend:${trend.id}`,
      ipAddress: ip,
      details: {
        ahuId: trend.ahuId,
        parameter: trend.parameter,
        horizon: trend.estimatedMin,
        direction: trend.direction,
      },
    });
    await publishRealtime("notification", trend.ahuId, {
      type: "TREND_ACKNOWLEDGED",
      trendId: trend.id,
      ahuId: trend.ahuId,
      by: actor.user.email,
      at: new Date().toISOString(),
    });
    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}