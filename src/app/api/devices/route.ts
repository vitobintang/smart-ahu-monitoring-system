import { getClientIp, jsonError, requireAuth, writeAudit } from "@/lib/auth";
import { deviceToRow, patchRtdbAhu, readRtdbDevices } from "@/lib/rtdb/registry";
import { requireRtdb } from "@/lib/rtdb/live-read";

export const dynamic = "force-dynamic";

/**
 * Fleet device rows for the admin devices tab. The bearer-token gateway
 * registry is RETIRED: devices are the owner tree's units mirrored under
 * devices/{id}; their pre-shared tokens live in the owner project's
 * deviceOwners/{id} and are never exposed here.
 */
export async function GET() {
  try {
    await requireAuth("view");
    const rtdb = await requireRtdb();
    // Modules tab mirrors the ACTIVE device source only (Daikin DB ⇄ My DB).
    const { readActiveFleetRecords } = await import("@/lib/rtdb/local-fleet");
    const fleetIds = new Set((await readActiveFleetRecords(rtdb)).keys());
    const devices = (await readRtdbDevices(rtdb)).filter((d) => fleetIds.has(d.ahuId));
    const physicalControlUnlocked = devices.some(() => true);
    return Response.json({ devices: devices.map(deviceToRow), physicalControlUnlocked });
  } catch (err) {
    return jsonError(err);
  }
}

/** Enable/disable a unit (pause switch on the fleet meta). */
export async function POST(req: Request) {
  try {
    const actor = await requireAuth("configure", { mutating: true });
    const body = (await req.json()) as { deviceId?: string; enabled?: boolean; ahuId?: string };
    const ahuId = (body.ahuId ?? body.deviceId ?? "").replace(/^owner-/, "").trim();
    if (!ahuId) return Response.json({ error: "ahuId is required" }, { status: 400 });
    if (typeof body.enabled !== "boolean") return Response.json({ error: "enabled must be a boolean" }, { status: 400 });

    const rtdb = await requireRtdb();
    await patchRtdbAhu(rtdb, ahuId, { enabled: body.enabled });
    await writeAudit({
      userId: actor.user.id,
      userEmail: actor.user.email,
      action: "DEVICE_UPDATED",
      entity: `ahu:${ahuId}`,
      ipAddress: await getClientIp(),
      details: { enabled: body.enabled },
    });
    const devices = await readRtdbDevices(rtdb, ahuId);
    return Response.json({ device: devices[0] ? deviceToRow(devices[0]) : null });
  } catch (err) {
    return jsonError(err);
  }
}

/** Device deletion is retired — devices belong to the owner project's tree. */
export async function DELETE(): Promise<Response> {
  return Response.json(
    { error: "Devices cannot be deleted here — they live on the owner Firebase tree (devices/{id}). Pause a unit instead." },
    { status: 410 },
  );
}
