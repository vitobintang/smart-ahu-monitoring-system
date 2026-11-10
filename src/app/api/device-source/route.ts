import { getClientIp, jsonError, requireAuth } from "@/lib/auth";
import { requireRtdb } from "@/lib/rtdb/live-read";
import { auditRtdb } from "@/lib/rtdb/lifecycle";
import { ensureLocalFleet, isDeviceSource, listLocalDeviceIds, readDeviceSource, writeDeviceSource } from "@/lib/rtdb/local-fleet";

export const dynamic = "force-dynamic";

/**
 * Device-data source switch: "daikin" (the collaborator's real owner tree) or
 * "local" (the fictional fleet hosted in this app's own database, identical
 * structure). Changes ONLY which devices feed the app — never auth, users,
 * rooms or settings.
 */
export async function GET() {
  try {
    await requireAuth("view");
    const rtdb = await requireRtdb();
    const source = await readDeviceSource(rtdb);
    const localIds = await listLocalDeviceIds(rtdb);
    return Response.json({ source, localFleetSize: localIds.length, localIds });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PUT(req: Request) {
  try {
    const actor = await requireAuth("configure", { mutating: true });
    const ip = await getClientIp();
    const body = (await req.json()) as { source?: string };
    if (!isDeviceSource(body.source)) {
      return Response.json({ error: 'source must be "daikin" or "local"' }, { status: 400 });
    }
    const rtdb = await requireRtdb();
    const before = await readDeviceSource(rtdb);
    let seeded: string[] = [];
    if (body.source === "local") {
      seeded = await ensureLocalFleet(rtdb);
    }
    await writeDeviceSource(rtdb, body.source);
    await auditRtdb(rtdb, {
      userId: actor.user.id,
      userEmail: actor.user.email,
      action: "DEVICE_SOURCE_SWITCHED",
      entity: "settings/deviceSource",
      ipAddress: ip,
      details: { from: before, to: body.source, seededUnits: seeded },
    });
    return Response.json({ ok: true, source: body.source, seededUnits: seeded });
  } catch (err) {
    return jsonError(err);
  }
}
