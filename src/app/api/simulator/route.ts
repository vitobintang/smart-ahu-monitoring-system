import { getClientIp, jsonError, requireAuth, writeAudit } from "@/lib/auth";
import { getOverride, setOverride, simulationTick, simOverrides } from "@/lib/workers";
import { AHU_IDS } from "@/lib/domain";
import { requireRtdb } from "@/lib/rtdb/live-read";
import { ahuToRow } from "@/lib/rtdb/registry";

export const dynamic = "force-dynamic";

/** FR-28 built-in telemetry & control simulator console. */
export async function GET() {
  try {
    await requireAuth("control");
    const rtdb = await requireRtdb();
    // Console lists the ACTIVE fleet only (Daikin DB ⇄ My DB switch).
    const { readActiveFleetRecords } = await import("@/lib/rtdb/local-fleet");
    const registry = await readActiveFleetRecords(rtdb);
    const rows = [...registry.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((record) => {
        const row = ahuToRow(record) as Record<string, unknown>;
        return {
          id: record.id,
          name: row.name,
          desiredRunState: row.desiredRunState,
          controlMode: row.controlMode,
          setpoint: row.setpoint,
          currentStatus: row.currentStatus,
        };
      });
    const ids = rows.length > 0 ? rows.map((r) => r.id) : [...AHU_IDS];
    const overrides = ids.map((id) => ({ ahuId: id, ...getOverride(id) }));
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
      messageId?: string;
      measuredAt?: string;
      readings?: { roomTemp?: number | null; humidity?: number | null };
      runState?: string;
      faultCode?: string | null;
      setpoint?: number | null;
    };
    const ip = await getClientIp();
    void actor;

    // Manual tester: accept the classic payload shape but store it in the
    // mirrored DAIKIN format (same path the sampler and simulator use).
    const rtdb = await requireRtdb();
    const { readActiveFleetRecords } = await import("@/lib/rtdb/local-fleet");
    const { processDaikinSnapshotRtdb } = await import("@/lib/rtdb/lifecycle");
    const registry = await readActiveFleetRecords(rtdb);
    const ahuId = body.ahuId && registry.has(body.ahuId) ? body.ahuId : [...registry.keys()][0];
    if (!ahuId) return Response.json({ error: "No fleet units exist yet" }, { status: 404 });
    const ahu = registry.get(ahuId)!;

    const status: Record<string, unknown> = {
      power: body.runState ? body.runState === "RUN" : ahu.desiredRunState === "RUN",
      setpoint: typeof body.setpoint === "number" ? body.setpoint : ahu.setpoint,
      mode: "cool",
      fan: 2,
      online: true,
      s21_connected: true,
      state_valid: true,
      simulated: true,
      timestamp: body.measuredAt ? new Date(body.measuredAt).getTime() || Date.now() : Date.now(),
    };
    if (body.readings?.roomTemp != null) status.room_temp = body.readings.roomTemp;
    if (body.readings?.humidity != null) status.humidity = body.readings.humidity;
    if (body.faultCode) status.fault = body.faultCode;
    const node: Record<string, unknown> = { status };

    const result = await processDaikinSnapshotRtdb(rtdb, ahuId, node);
    await writeAudit({
      userId: actor.user.id,
      userEmail: actor.user.email,
      action: "SIMULATION_INGESTED",
      entity: `ahu:${ahuId}`,
      ipAddress: ip,
      details: { simulated: true, ok: result.ok },
    });
    return Response.json(result.body, { status: result.status });
  } catch (err) {
    return jsonError(err);
  }
}
