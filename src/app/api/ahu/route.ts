import { tryGetAhuRtdb } from "@/lib/rtdb/live-read";
import { readRtdbAhus, ahuToRow, type RtdbAhuRecord } from "@/lib/rtdb/registry";

async function requireRtdb() {
  const rtdb = await tryGetAhuRtdb();
  if (!rtdb) throw new Error("Firebase RTDB is not configured");
  return rtdb;
}
import { getClientIp, jsonError, requireAuth, writeAudit } from "@/lib/auth";
import { PARAMETERS, PARAM_KEYS, SETPOINT_MAX, SETPOINT_MIN, type ParamKey } from "@/lib/domain";
import { normalizeRotation } from "@/lib/facility-layout";
import { resolveAhuPlacement, validatePlatformPlacement } from "@/lib/facility-placement";
import { getActiveFloorplan } from "@/lib/floorplan-store";
import { randomHex, randomId } from "@/lib/ids";
import { simulationTick } from "@/lib/workers";

export const dynamic = "force-dynamic";

const AHU_ID_RE = /^[A-Z0-9][A-Z0-9_-]{2,23}$/;

/** Lists all registered AHU units ordered by ID, including resolved 3D floor coordinates. */
export async function GET() {
  try {
    await requireAuth("view");
    const rtdb = await requireRtdb();
    const [registry, floorplan] = await Promise.all([
      readRtdbAhus(rtdb),
      getActiveFloorplan(),
    ]);
    const rows = [...registry.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => ahuToRow(r) as unknown as RtdbAhuRecord & Record<string, unknown>);
    const resolved: Array<{ id: string; x: number; z: number }> = [];
    const units = rows.map((row) => {
      const p = resolveAhuPlacement(row, resolved, floorplan.vertices);
      resolved.push({ id: row.id, x: p.x, z: p.z });
      return {
        ...row,
        mapX: p.x,
        mapZ: p.z,
        mapRotation: p.rotation,
        mapZone: p.zone,
        indoor: p.indoor,
      };
    });
    return Response.json({ ahus: units });
  } catch (err) {
    return jsonError(err);
  }
}

/** Creates a new AHU unit and places its 3D model onto the facility floor platform. */
export async function POST(req: Request) {
  try {
    const actor = await requireAuth("configure", { mutating: true });
    const ip = await getClientIp();
    const body = (await req.json()) as {
      id?: string;
      name?: string;
      location?: string;
      setpoint?: number;
      commTimeoutSec?: number;
      hasHeater?: boolean;
      installedSensors?: string[];
      desiredRunState?: "RUN" | "STOP";
      provisionSimulator?: boolean;
      /** Pre-shared AHU device token — written to the OWNER tree (deviceOwners/{id} + devices/{id}). */
      deviceToken?: string;
      mapX?: number;
      mapZ?: number;
      mapRotation?: number;
    };

    const rawId = typeof body.id === "string" ? body.id.trim().toUpperCase() : "";
    if (!AHU_ID_RE.test(rawId)) {
      return Response.json(
        { error: "AHU ID must be 3–24 uppercase characters (e.g. AHU-08)." },
        { status: 400 },
      );
    }

    const registry = await readRtdbAhus(await requireRtdb());
    if ([...registry.values()].some((r) => r.id.toUpperCase() === rawId)) {
      return Response.json(
        { error: `AHU ${rawId} already exists.` },
        { status: 409 },
      );
    }

    if (typeof body.mapX !== "number" || !Number.isFinite(body.mapX) || typeof body.mapZ !== "number" || !Number.isFinite(body.mapZ)) {
      return Response.json(
        { error: "Please select a floor platform position in the 3D facility room." },
        { status: 400 },
      );
    }

    const floorplan = await getActiveFloorplan();
    const existingPlacements: Array<{ id: string; x: number; z: number; rotation?: number }> = [];
    for (const r of [...registry.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      const p = resolveAhuPlacement(r, existingPlacements, floorplan.vertices);
      existingPlacements.push({ id: r.id, x: p.x, z: p.z, rotation: p.rotation });
    }

    const requestedRot =
      typeof body.mapRotation === "number" && Number.isFinite(body.mapRotation)
        ? normalizeRotation(body.mapRotation)
        : undefined;
    const placement = validatePlatformPlacement(
      body.mapX,
      body.mapZ,
      existingPlacements,
      undefined,
      requestedRot,
      floorplan.vertices,
    );
    if (!placement.valid || !placement.zone) {
      return Response.json(
        { error: placement.reason ?? "Invalid 3D floor platform position." },
        { status: 400 },
      );
    }

    const rotation = placement.rotation;
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim().slice(0, 120)
        : `${rawId} Air Handling Unit`;
    const location =
      typeof body.location === "string" && body.location.trim()
        ? body.location.trim().slice(0, 160)
        : placement.zone.label;

    const setpoint =
      typeof body.setpoint === "number" && Number.isFinite(body.setpoint)
        ? Math.min(SETPOINT_MAX, Math.max(SETPOINT_MIN, Number(body.setpoint.toFixed(1))))
        : 22.0;
    const commTimeoutSec =
      typeof body.commTimeoutSec === "number" && Number.isFinite(body.commTimeoutSec)
        ? Math.min(3600, Math.max(5, Math.round(body.commTimeoutSec)))
        : 30;
    const hasHeater = Boolean(body.hasHeater);
    const desiredRunState = body.desiredRunState === "STOP" ? "STOP" : "RUN";
    const provisionSimulator = body.provisionSimulator !== false;
    const deviceToken =
      typeof body.deviceToken === "string" && body.deviceToken.trim().length >= 8 && body.deviceToken.trim().length <= 128
        ? body.deviceToken.trim()
        : null;

    let sensors: ParamKey[] = Array.isArray(body.installedSensors)
      ? body.installedSensors.filter((s): s is ParamKey => PARAM_KEYS.includes(s as ParamKey))
      : PARAMETERS.map((p) => p.key).filter((k) => hasHeater || k !== "heaterOutput");
    if (!hasHeater) sensors = sensors.filter((k) => k !== "heaterOutput");
    if (sensors.length === 0) {
      sensors = PARAMETERS.map((p) => p.key).filter((k) => hasHeater || k !== "heaterOutput");
    }

    // Phase 5c: registration writes the RTDB registry + default thresholds natively.
    const rtdb = await (async () => {
      const { tryGetAhuRtdb } = await import("@/lib/rtdb/live-read");
      const rtdb = await tryGetAhuRtdb();
      if (!rtdb) throw new Error("Firebase RTDB is not configured");
      return rtdb;
    })();
    const { writeRtdbAhu, setRtdbThreshold, setRtdbDevice } = await import("@/lib/rtdb/registry");
    const { tryGetOwnerRtdb } = await import("@/lib/firebase/admin");
    const ownerRtdb = await tryGetOwnerRtdb();
    const nowMs = Date.now();
    await writeRtdbAhu(rtdb, {
      id: rawId,
      name,
      location,
      commTimeoutSec,
      hasHeater,
      installedSensors: sensors,
      currentStatus: "OFFLINE",
      lastSeenAt: null,
      controlMode: "AUTO",
      desiredRunState,
      setpoint,
      faultCode: null,
      // A registered device token means the app IS the commissioned controller.
      physicalControlEnabled: deviceToken !== null,
      mapX: placement.snappedX,
      mapZ: placement.snappedZ,
      mapRotation: rotation,
      mapZone: placement.zone!.label,
      updatedAt: nowMs,
    });
    for (const p of PARAMETERS) {
      const isInstalled = sensors.includes(p.key);
      await setRtdbThreshold(rtdb, {
        id: `${rawId}:${p.key}`,
        ahuId: rawId,
        parameter: p.key,
        enabled: isInstalled && (p.defaultLow !== null || p.defaultHigh !== null),
        lowLimit: p.defaultLow,
        highLimit: p.defaultHigh,
        delaySec: p.key === "current" ? 10 : 5,
        priority: p.defaultPriority,
        validMin: p.validMin,
        validMax: p.validMax,
        unit: p.unit,
        label: p.label,
        trendEnabled: isInstalled && p.trendByDefault,
        updatedAt: nowMs,
      });
    }
    if (provisionSimulator) {
      await setRtdbDevice(rtdb, {
        id: randomId(),
        ahuId: rawId,
        label: `${rawId} Simulation Controller`,
        token: `sim_${rawId.toLowerCase().replace(/[^a-z0-9]/g, "")}_${randomHex(8)}`,
        sourceType: "SIMULATION",
        enabled: true,
        createdAt: nowMs,
      });
    }
    if (deviceToken && ownerRtdb) {
      // Owner devices tree: register the pre-shared token and create the
      // device record — the S21 bridge owns the node from here on.
      const { writeDeviceOwnerToken, initialDaikinDeviceRecord } = await import("@/lib/rtdb/daikin");
      await writeDeviceOwnerToken(ownerRtdb, rawId, deviceToken);
      if ((await ownerRtdb.get(`devices/${rawId}`)) === null) {
        await ownerRtdb.set(`devices/${rawId}`, initialDaikinDeviceRecord(nowMs));
      }
    }
    await writeAudit({
      userId: actor.user.id,
      userEmail: actor.user.email,
      action: "AHU_CREATED",
      entity: `ahu:${rawId}`,
      ipAddress: ip,
      details: {
        id: rawId,
        name,
        location,
        hasHeater,
        setpoint,
        provisionSimulator,
        deviceRegistered: deviceToken !== null,
        mapX: placement.snappedX,
        mapZ: placement.snappedZ,
        mapRotation: rotation,
        mapZone: placement.zone!.label,
      },
    });

    // Clear short overview cache so the newly added AHU appears immediately
    const g = globalThis as typeof globalThis & {
      __ahuOverviewCache?: Map<string, unknown>;
    };
    g.__ahuOverviewCache?.clear();

    if (provisionSimulator && process.env.SIMULATION_ENABLED !== "false") {
      await simulationTick();
      g.__ahuOverviewCache?.clear();
    }

    return Response.json(
      {
        ok: true,
        ahu: {
          id: rawId,
          name,
          location,
          mapX: placement.snappedX,
          mapZ: placement.snappedZ,
          mapRotation: rotation,
          mapZone: placement.zone.label,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return jsonError(err);
  }
}
