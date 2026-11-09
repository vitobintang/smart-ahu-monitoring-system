import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ahuCommands } from "@/db/schema";
import { getClientIp, jsonError, requireAuth } from "@/lib/auth";
import { acceptPendingCommands, COMMAND_TYPES, createCommand, expireStaleCommands, type CommandType } from "@/lib/engine";
import { getOverride, maybePulseWorkers } from "@/lib/workers";
import { tryGetAhuRtdb } from "@/lib/rtdb/live-read";

export const dynamic = "force-dynamic";

/** FR-26 command tracking list. */
export async function GET(req: Request) {
  try {
    await requireAuth("view");
    maybePulseWorkers();
    await expireStaleCommands();
    const url = new URL(req.url);
    const ahuId = url.searchParams.get("ahuId");
    // Phase 5b slice 3: the tracking list reads the RTDB command tree when
    // Firebase is configured; PostgreSQL remains the fallback.
    let all: Array<Record<string, unknown>> = [];
    const rtdb = await tryGetAhuRtdb();
    if (rtdb) {
      const { readCommandHistory, commandToRow } = await import("@/lib/rtdb/commands");
      if (ahuId) {
        all = (await readCommandHistory(rtdb, ahuId, 60)).map(commandToRow);
      } else {
        const tree = (await rtdb.get<Record<string, import("@/lib/rtdb/commands").RtdbCommandRecord>>("commands")) ?? {};
        all = Object.values(tree)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 60)
          .map(commandToRow);
      }
    } else {
      const rows = await db
        .select()
        .from(ahuCommands)
        .where(ahuId ? eq(ahuCommands.ahuId, ahuId) : undefined)
        .orderBy(desc(ahuCommands.createdAt))
        .limit(60);
      all = rows;
    }
    return Response.json({ commands: all, types: COMMAND_TYPES });
  } catch (err) {
    return jsonError(err);
  }
}

/** FR-25 AHU control (Admin / Engineering / Operator). */
export async function POST(req: Request) {
  try {
    const actor = await requireAuth("control", { mutating: true });
    const ip = await getClientIp();
    const body = (await req.json()) as { ahuId?: string; commandType?: string; payload?: { setpoint?: number } };
    if (!body.ahuId) return Response.json({ error: "ahuId is required" }, { status: 400 });
    const outcome = await createCommand({
      ahuId: body.ahuId,
      commandType: body.commandType as CommandType,
      payload: body.payload,
      userId: actor.user.id,
      userEmail: actor.user.email,
      ipAddress: ip,
    });
    if ("error" in outcome) {
      return Response.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
    }
    let nextStatus = outcome.status;
    if (process.env.SIMULATION_ENABLED !== "false" && !getOverride(body.ahuId).rejectCommands && !getOverride(body.ahuId).commLoss) {
      const accepted = await acceptPendingCommands(body.ahuId);
      if (accepted.length > 0) nextStatus = "ACCEPTED";
    }
    return Response.json({ ok: true, commandId: outcome.commandId, status: nextStatus });
  } catch (err) {
    return jsonError(err);
  }
}