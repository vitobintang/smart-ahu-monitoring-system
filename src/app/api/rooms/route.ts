import { getClientIp, jsonError, requireAuth, writeAudit } from "@/lib/auth";
import { normalizeRoomRect, type RoomRecord } from "@/lib/facility-rooms";
import { readRtdbRooms, removeRtdbRoom, writeRtdbRoom } from "@/lib/rtdb/rooms";
import { requireRtdb } from "@/lib/rtdb/live-read";

export const dynamic = "force-dynamic";

/** The ROOMS layer (independent of the building outline/walls). */
export async function GET() {
  try {
    await requireAuth("view");
    const rtdb = await requireRtdb();
    return Response.json({ rooms: await readRtdbRooms(rtdb) });
  } catch (err) {
    return jsonError(err);
  }
}

/** Create or update one room (grid-snapped rectangle). */
export async function PUT(req: Request) {
  try {
    const actor = await requireAuth("configure", { mutating: true });
    const body = (await req.json()) as Partial<RoomRecord>;
    const id = (body.id ?? "").trim();
    const name = (body.name ?? "").trim();
    if (!id || id.length > 64) return Response.json({ error: "id is required (max 64 chars)." }, { status: 400 });
    if (!name || name.length > 80) return Response.json({ error: "name is required (max 80 chars)." }, { status: 400 });
    if (typeof body.x1 !== "number" || typeof body.z1 !== "number" || typeof body.x2 !== "number" || typeof body.z2 !== "number") {
      return Response.json({ error: "x1/z1/x2/z2 numbers are required." }, { status: 400 });
    }
    const rect = normalizeRoomRect(body.x1, body.z1, body.x2, body.z2);
    if ("error" in rect) return Response.json({ error: rect.error }, { status: 400 });

    const color = /^#[0-9a-fA-F]{6}$/.test(body.color ?? "") ? body.color! : "#6366f1";
    const rtdb = await requireRtdb();
    const room: RoomRecord = {
      id,
      name,
      color,
      ...rect,
      updatedAt: Date.now(),
      updatedBy: actor.user.username || actor.user.email,
    };
    await writeRtdbRoom(rtdb, room);
    await writeAudit({
      userId: actor.user.id,
      userEmail: actor.user.email,
      action: "ROOM_UPDATED",
      entity: `room:${id}`,
      ipAddress: await getClientIp(),
      details: { name, ...rect, color },
    });
    return Response.json({ room });
  } catch (err) {
    return jsonError(err);
  }
}

/** Remove a room (the devices inside are unaffected). */
export async function DELETE(req: Request) {
  try {
    const actor = await requireAuth("configure", { mutating: true });
    const roomId = new URL(req.url).searchParams.get("roomId") ?? "";
    if (!roomId) return Response.json({ error: "roomId is required." }, { status: 400 });

    const rtdb = await requireRtdb();
    await removeRtdbRoom(rtdb, roomId);
    await writeAudit({
      userId: actor.user.id,
      userEmail: actor.user.email,
      action: "ROOM_DELETED",
      entity: `room:${roomId}`,
      ipAddress: await getClientIp(),
      details: {},
    });
    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
