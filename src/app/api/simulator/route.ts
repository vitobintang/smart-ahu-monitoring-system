import { randomId } from "@/lib/ids";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { ahus, devices } from "@/db/schema";
import { getClientIp, jsonError, requireAuth, writeAudit } from "@/lib/auth";
import { ingestTelemetry } from "@/lib/engine";
import { getOverride, setOverride, simulationTick, simOverrides } from "@/lib/workers";
import { AHU_IDS } from "@/lib/domain";

export const dynamic = "force-dynamic";

/** FR-28 built-in telemetry & control simulator console. */
export async function GET() {
  try {
    await requireAuth("control");
    const rows = await db
      .select({
        id: ahus.id,
        name: ahus.name,
        desiredRunState: ahus.desiredRunState,
        controlMode: ahus.controlMode,
        setpoint: ahus.setpoint,
        currentStatus: ahus.currentStatus,
      })
      .from(ahus)
      .orderBy(ahus.id);
    const overrides = AHU_IDS.map((id) => ({ ahuId: id, ...getOverride(id) }));
    return Response.json({
      ahus: rows,
      overrides,
      physicalControlUnlocked: false,
      note: "All simulated records are stored with source = SIMULATION (FR-09 / FR-28).",
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireAuth("control", { mutating: true });
    const body = (await req.json()) as {
      ahuId?: string;
      forcedFault?: string | null;
      commLoss?: boolean;
      rejectCommands?: boolean;
      rapidFilterFouling?: boolean;
      humiditySpike?: boolean;
      currentOverload?: boolean;
      action?: "TICK" | "RESET_ALL" | "INGEST";
      messageId?: string;
      parameters?: Record<string, number | null>;
      runState?: string;
      faultCode?: string | null;
    };

    if (body.action === "RESET_ALL") {
      for (const id of AHU_IDS) {
        setOverride(id, {
          forcedFault: null,
          commLoss: false,
          rejectCommands: false,
          rapidFilterFouling: false,
          humiditySpike: false,
          currentOverload: false,
        });
      }
      await writeAudit({
        userId: actor.user.id,
        userEmail: actor.user.email,
        action: "SIMULATOR_RESET",
        entity: "simulator",
        ipAddress: await getClientIp(),
        details: { scope: "ALL" },
      });
      return Response.json({ ok: true, overrides: AHU_IDS.map((id) => ({ ahuId: id, ...getOverride(id) })) });
    }

    if (body.action === "TICK") {
      await simulationTick();
      return Response.json({ ok: true, ranAt: new Date().toISOString() });
    }

    // Manual ingestion tester — runs the exact FR-22/FR-23 pipeline used by
    // POST /api/telemetry, authenticated with the unit's simulation device token.
    if (body.action === "INGEST") {
      const targetAhu = String(body.ahuId ?? "");
      const device = (
        await db
          .select()
          .from(devices)
          .where(and(eq(devices.ahuId, targetAhu), eq(devices.sourceType, "SIMULATION"), eq(devices.enabled, true)))
          .limit(1)
      )[0];
      if (!device) return Response.json({ error: `No enabled SIMULATION device provisioned for ${targetAhu}` }, { status: 404 });
      const result = await ingestTelemetry(device.token, {
        ahuId: targetAhu,
        messageId: body.messageId ? String(body.messageId) : randomId(),
        timestamp: new Date().toISOString(),
        parameters: (body.parameters ?? {}) as Record<string, number | null>,
        runState: body.runState ? String(body.runState) : "RUN",
        faultCode: body.faultCode ? String(body.faultCode) : null,
        setpoint: undefined,
        controlMode: null,
      });
      await writeAudit({
        userId: actor.user.id,
        userEmail: actor.user.email,
        action: "SIMULATOR_INJECT",
        entity: `telemetry:${targetAhu}`,
        ipAddress: await getClientIp(),
        details: { httpStatus: result.status, response: result.body, messageId: body.messageId ?? null },
      });
      return Response.json(result.body, { status: result.status });
    }

    const ahuId = body.ahuId;
    if (!ahuId || !AHU_IDS.includes(ahuId as (typeof AHU_IDS)[number]))
      return Response.json({ error: "A valid ahuId is required" }, { status: 400 });

    const patch: Record<string, unknown> = {};
    if (body.forcedFault !== undefined) patch.forcedFault = body.forcedFault ? String(body.forcedFault).slice(0, 60) : null;
    if (body.commLoss !== undefined) patch.commLoss = Boolean(body.commLoss);
    if (body.rejectCommands !== undefined) patch.rejectCommands = Boolean(body.rejectCommands);
    if (body.rapidFilterFouling !== undefined) patch.rapidFilterFouling = Boolean(body.rapidFilterFouling);
    if (body.humiditySpike !== undefined) patch.humiditySpike = Boolean(body.humiditySpike);
    if (body.currentOverload !== undefined) patch.currentOverload = Boolean(body.currentOverload);

    const next = setOverride(ahuId, patch);
    await writeAudit({
      userId: actor.user.id,
      userEmail: actor.user.email,
      action: "SIMULATOR_OVERRIDE",
      entity: `simulator:${ahuId}`,
      ipAddress: await getClientIp(),
      details: { patch, result: next },
    });
    return Response.json({ ok: true, ahuId, override: next, all: [...simOverrides.entries()].map(([k, v]) => ({ ahuId: k, ...v })) });
  } catch (err) {
    return jsonError(err);
  }
}