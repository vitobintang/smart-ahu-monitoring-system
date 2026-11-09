import { getClientIp, jsonError, requireAuth } from "@/lib/auth";
import { acceptPendingCommands, COMMAND_TYPES, createCommand, expireStaleCommands, type CommandType } from "@/lib/engine";
import { getOverride, maybePulseWorkers } from "@/lib/workers";
import { requireRtdb } from "@/lib/rtdb/live-read";
import { commandToRow, readCommandHistory, type RtdbCommandRecord } from "@/lib/rtdb/commands";

export const dynamic = "force-dynamic";

/** FR-26 command tracking list. */
export async function GET(req: Request) {
  try {
    await requireAuth("view");
    maybePulseWorkers();
    await expireStaleCommands();
    const url = new URL(req.url);
    const ahuId = url.searchParams.get("ahuId");
    const rtdb = await requireRtdb();
    let all: Array<Record<string, unknown>>;
    if (ahuId) {
      all = (await readCommandHistory(rtdb, ahuId, 60)).map(commandToRow);
    } else {
      const tree = (await rtdb.get<Record<string, RtdbCommandRecord>>("commands")) ?? {};
      all = Object.values(tree)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 60)
        .map(commandToRow);
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