import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ahus } from "@/db/schema";
import { jsonError, requireAuth, getClientIp, writeAudit } from "@/lib/auth";
import { buildReport, streamReportCsv } from "@/lib/queries";
import { AHU_IDS, MAX_REPORT_RANGE_DAYS } from "@/lib/domain";

export const dynamic = "force-dynamic";

/**
 * FR-10 data logger report · FR-11 summary statistics + interval breakdown
 * · FR-12 CSV export. Maximum queryable range: 31 days.
 */
export async function GET(req: Request) {
  try {
    const actor = await requireAuth("view");
    const url = new URL(req.url);
    const ahuId = url.searchParams.get("ahuId") ?? AHU_IDS[0];
    const source = (url.searchParams.get("source") ?? "ALL").toUpperCase();
    const format = url.searchParams.get("format") ?? "json";
    const now = new Date();
    const to = url.searchParams.get("to") ? new Date(url.searchParams.get("to") as string) : now;
    const from = url.searchParams.get("from")
      ? new Date(url.searchParams.get("from") as string)
      : new Date(now.getTime() - 24 * 3600 * 1000);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
      return Response.json({ error: "Invalid from/to date" }, { status: 400 });
    if (from >= to) return Response.json({ error: "`from` must be earlier than `to`" }, { status: 400 });
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (days > MAX_REPORT_RANGE_DAYS)
      return Response.json(
        { error: `Report range is limited to ${MAX_REPORT_RANGE_DAYS} days (requested ${days.toFixed(1)} days)` },
        { status: 400 },
      );
    const [exists] = await db.select({ id: ahus.id }).from(ahus).where(eq(ahus.id, ahuId)).limit(1);
    if (!exists)
      return Response.json({ error: `Unknown AHU "${ahuId}"` }, { status: 400 });
    if (!["ALL", "PHYSICAL", "SIMULATION"].includes(source))
      return Response.json({ error: "source must be ALL, PHYSICAL or SIMULATION" }, { status: 400 });

    const report = await buildReport({
      ahuId,
      from,
      to,
      source: source as "ALL" | "PHYSICAL" | "SIMULATION",
      sampleLimit: format === "csv" ? 1 : Number(url.searchParams.get("limit") ?? 300),
    });

    if (format === "csv") {
      const ip = await getClientIp();
      await writeAudit({
        userId: actor.user.id,
        userEmail: actor.user.email,
        action: "REPORT_EXPORT_STARTED",
        entity: `report:${ahuId}`,
        ipAddress: ip,
        details: { format: "CSV", from: from.toISOString(), to: to.toISOString(), source, matchedRowsAtRequest: report.totalRows },
      });
      return new Response(streamReportCsv({ ahuId, from, to, source: source as "ALL" | "PHYSICAL" | "SIMULATION" }), {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="ahu-datalogger-${ahuId}-${from.toISOString().slice(0, 10)}_${to
            .toISOString()
            .slice(0, 10)}.csv"`,
        },
      });
    }

    return Response.json(report);
  } catch (err) {
    return jsonError(err);
  }
}