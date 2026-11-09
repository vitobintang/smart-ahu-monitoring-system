import { randomHex, randomId } from "@/lib/ids";
import type { DataSource } from "@/lib/types";
import { getClientIp, jsonError, requireAuth, writeAudit } from "@/lib/auth";
import { readAuthoritativeSource, reconcileAhuSourceTransition, refreshAhuStatus } from "@/lib/engine";
import { resetSimulatorUnit, simulationTick } from "@/lib/workers";
import { readRtdbAhu, readRtdbDevices, readRtdbAhus, removeRtdbDevice, setRtdbDevice, deviceToRow } from "@/lib/rtdb/registry";
import { requireRtdb } from "@/lib/rtdb/live-read";

export const dynamic = "force-dynamic";



/** FR-21 device provisioning — Admin only (issues device authentication tokens). */
export async function GET() {
  try {
    await requireAuth("manageUsers");
    const rtdb = await requireRtdb();
    const [devices, ahuRegistry] = await Promise.all([readRtdbDevices(rtdb), readRtdbAhus(rtdb)]);
    const rows = devices
      .sort((a, b) => a.ahuId.localeCompare(b.ahuId) || a.createdAt - b.createdAt)
      .map((d) => {
        const row = deviceToRow(d);
        return {
          id: d.id,
          ahuId: d.ahuId,
          label: d.label,
          sourceType: d.sourceType,
          enabled: d.enabled,
          createdAt: row.createdAt,
        };
      });
    const ahuRows = [...ahuRegistry.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((a) => ({ id: a.id, name: a.name }));
    return Response.json({
      devices: rows,
      ahus: ahuRows,
      physicalControlUnlocked: false,
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireAuth("manageUsers", { mutating: true });
    const ip = await getClientIp();
    const body = (await req.json()) as {
      ahuId?: string;
      label?: string;
      sourceType?: DataSource;
      deviceId?: string;
      enabled?: boolean;
    };
    const rtdb = await requireRtdb();

    // revoke / re-enable an existing provisioned device
    if (body.deviceId) {
      const all = await readRtdbDevices(rtdb);
      const existing = all.find((d) => d.id === body.deviceId);
      if (!existing) return Response.json({ error: "Device not found" }, { status: 404 });
      const nextEnabled = Boolean(body.enabled);
      const prevSource = await readAuthoritativeSource(rtdb, existing.ahuId);
      await setRtdbDevice(rtdb, { ...existing, enabled: nextEnabled });
      const nextSource = await readAuthoritativeSource(rtdb, existing.ahuId);
      const reconciled = await reconcileAhuSourceTransition(rtdb, {
        ahuId: existing.ahuId,
        prevSource,
        nextSource,
        userId: actor.user.id,
        userEmail: actor.user.email,
        ipAddress: ip,
      });
      await writeAudit({
        userId: actor.user.id,
        userEmail: actor.user.email,
        action: "DEVICE_UPDATED",
        entity: `device:${existing.id}`,
        ipAddress: ip,
        details: {
          from: existing.enabled,
          to: nextEnabled,
          ahuId: existing.ahuId,
          prevSource,
          nextSource,
          ...reconciled,
        },
      });

      if (prevSource === "SIMULATION" && nextSource !== "SIMULATION") {
        resetSimulatorUnit(existing.ahuId);
      }
      if (nextSource === "SIMULATION" && process.env.SIMULATION_ENABLED !== "false") {
        await simulationTick();
      }
      await refreshAhuStatus(existing.ahuId);

      return Response.json({
        ok: true,
        device: {
          id: existing.id,
          ahuId: existing.ahuId,
          label: existing.label,
          sourceType: existing.sourceType,
          enabled: nextEnabled,
          createdAt: new Date(existing.createdAt).toISOString(),
        },
      });
    }

    const ahuId = body.ahuId;
    if (!ahuId) return Response.json({ error: "ahuId is required" }, { status: 400 });
    const ahu = await readRtdbAhu(rtdb, ahuId);
    if (!ahu) return Response.json({ error: `AHU ${ahuId} is not registered` }, { status: 404 });
    const sourceType: DataSource = body.sourceType === "PHYSICAL" ? "PHYSICAL" : "SIMULATION";

    // Prevent duplicate SIMULATION controllers on the same AHU unit
    if (sourceType === "SIMULATION") {
      const existingSim = (await readRtdbDevices(rtdb, ahuId)).find((d) => d.sourceType === "SIMULATION");
      if (existingSim) {
        return Response.json(
          {
            error: `${ahuId} already has a Simulation Controller ("${existingSim.label}"). Toggle the existing controller or choose PHYSICAL to connect a hardware gateway.`,
          },
          { status: 409 },
        );
      }
    }

    const cleanLabel = (
      body.label?.trim() ||
      (sourceType === "PHYSICAL" ? `${ahuId} Hardware Gateway` : `${ahuId} Simulation Controller`)
    ).slice(0, 120);

    const id = randomId();
    const token = `${sourceType === "PHYSICAL" ? "phy" : "sim"}_${ahuId.toLowerCase()}_${randomHex(24)}`;
    const prevSource = await readAuthoritativeSource(rtdb, ahuId);
    await setRtdbDevice(rtdb, { id, ahuId, label: cleanLabel, token, sourceType, enabled: true, createdAt: Date.now() });
    const nextSource = await readAuthoritativeSource(rtdb, ahuId);
    const reconciled = await reconcileAhuSourceTransition(rtdb, {
      ahuId,
      prevSource,
      nextSource,
      userId: actor.user.id,
      userEmail: actor.user.email,
      ipAddress: ip,
    });

    await writeAudit({
      userId: actor.user.id,
      userEmail: actor.user.email,
      action: "DEVICE_PROVISIONED",
      entity: `device:${id}`,
      ipAddress: ip,
      details: {
        ahuId,
        sourceType,
        label: cleanLabel,
        prevSource,
        nextSource,
        ...reconciled,
      },
    });

    if (prevSource === "SIMULATION" && nextSource !== "SIMULATION") {
      resetSimulatorUnit(ahuId);
    }

    if (nextSource === "SIMULATION" && process.env.SIMULATION_ENABLED !== "false") {
      await simulationTick();
    }
    await refreshAhuStatus(ahuId);

    return Response.json(
      { ok: true, device: { id, ahuId, token, sourceType, label: cleanLabel } },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const actor = await requireAuth("manageUsers", { mutating: true });
    const ip = await getClientIp();
    const url = new URL(req.url);
    const deviceId = url.searchParams.get("deviceId")?.trim();
    if (!deviceId) {
      return Response.json({ error: "deviceId is required" }, { status: 400 });
    }
    const rtdb = await requireRtdb();

    const all = await readRtdbDevices(rtdb);
    const existing = all.find((d) => d.id === deviceId);
    if (!existing) {
      return Response.json({ error: "Module not found" }, { status: 404 });
    }

    const prevSource = await readAuthoritativeSource(rtdb, existing.ahuId);
    await removeRtdbDevice(rtdb, existing.ahuId, existing.id);
    const nextSource = await readAuthoritativeSource(rtdb, existing.ahuId);
    const reconciled = await reconcileAhuSourceTransition(rtdb, {
      ahuId: existing.ahuId,
      prevSource,
      nextSource,
      userId: actor.user.id,
      userEmail: actor.user.email,
      ipAddress: ip,
    });
    await writeAudit({
      userId: actor.user.id,
      userEmail: actor.user.email,
      action: "DEVICE_REMOVED",
      entity: `device:${existing.id}`,
      ipAddress: ip,
      details: {
        ahuId: existing.ahuId,
        label: existing.label,
        sourceType: existing.sourceType,
        prevSource,
        nextSource,
        ...reconciled,
      },
    });

    if (prevSource === "SIMULATION" && nextSource !== "SIMULATION") {
      resetSimulatorUnit(existing.ahuId);
    }
    if (nextSource === "SIMULATION" && process.env.SIMULATION_ENABLED !== "false") {
      await simulationTick();
    }
    await refreshAhuStatus(existing.ahuId);

    return Response.json({ ok: true, removedId: existing.id, ahuId: existing.ahuId });
  } catch (err) {
    return jsonError(err);
  }
}
