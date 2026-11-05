import { getClientIp, jsonError, requireAuth, writeAudit } from "@/lib/auth";
import { validateFloorplanPolygon, type FloorVertex } from "@/lib/facility-layout";
import {
  getActiveFloorplan,
  resetCustomFloorplan,
  saveCustomFloorplan,
} from "@/lib/floorplan-store";

export const dynamic = "force-dynamic";

function clearOverviewCache() {
  const g = globalThis as typeof globalThis & {
    __ahuOverviewCache?: Map<string, unknown>;
  };
  g.__ahuOverviewCache?.clear();
}

/** Returns the active 3D facility room polygon (custom if saved, otherwise default 22-corner hall). */
export async function GET() {
  try {
    await requireAuth("view");
    const floorplan = await getActiveFloorplan();
    return Response.json(floorplan);
  } catch (err) {
    return jsonError(err);
  }
}

/** Saves an edited 3D facility room polygon to PostgreSQL and nudges any wall-grazed AHUs. */
export async function PUT(req: Request) {
  try {
    const actor = await requireAuth("control", { mutating: true });
    const ip = await getClientIp();
    const body = (await req.json()) as { vertices?: FloorVertex[] };

    if (!Array.isArray(body.vertices)) {
      return Response.json({ error: "vertices array is required." }, { status: 400 });
    }

    const check = validateFloorplanPolygon(body.vertices);
    if (!check.valid) {
      return Response.json(
        { error: check.reason ?? "Invalid room geometry." },
        { status: 400 },
      );
    }

    const updatedBy = actor.user.username || actor.user.email;
    const { state, nudgedUnits } = await saveCustomFloorplan(body.vertices, updatedBy);
    clearOverviewCache();

    await writeAudit({
      userId: actor.user.id,
      userEmail: actor.user.email,
      action: "FACILITY_FLOORPLAN_UPDATED",
      entity: "facility_floorplan:1",
      details: {
        vertexCount: state.vertices.length,
        areaSqM: state.areaSqM,
        nudgedUnits,
      },
      ipAddress: ip,
    });

    return Response.json({ ...state, nudgedUnits });
  } catch (err) {
    return jsonError(err);
  }
}

/** Resets the 3D facility room polygon back to the default multi-branch architectural layout. */
export async function DELETE() {
  try {
    const actor = await requireAuth("control", { mutating: true });
    const ip = await getClientIp();
    const state = await resetCustomFloorplan();
    clearOverviewCache();

    await writeAudit({
      userId: actor.user.id,
      userEmail: actor.user.email,
      action: "FACILITY_FLOORPLAN_RESET",
      entity: "facility_floorplan:1",
      details: { areaSqM: state.areaSqM },
      ipAddress: ip,
    });

    return Response.json(state);
  } catch (err) {
    return jsonError(err);
  }
}
