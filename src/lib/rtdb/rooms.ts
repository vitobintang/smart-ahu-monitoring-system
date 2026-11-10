import type { RtdbAdapter } from "./store";
import { DEFAULT_ROOMS, normalizeRoomRect, type RoomRecord } from "@/lib/facility-rooms";

/**
 * rooms/ — the ROOMS layer tree (independent of the building walls).
 * Stored verbatim-ish as flat records; grid-snapped on write.
 */

export const ROOMS_NODE = "rooms";

export function roomNode(roomId: string): string {
  return `${ROOMS_NODE}/${roomId}`;
}

export async function readRtdbRooms(rtdb: RtdbAdapter): Promise<RoomRecord[]> {
  const tree = (await rtdb.get<Record<string, RoomRecord>>(ROOMS_NODE)) ?? {};
  return Object.values(tree)
    .filter((r) => r && typeof r === "object" && typeof r.x1 === "number" && typeof r.x2 === "number")
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function readRtdbRoom(rtdb: RtdbAdapter, roomId: string): Promise<RoomRecord | null> {
  return rtdb.get<RoomRecord>(roomNode(roomId));
}

export async function writeRtdbRoom(rtdb: RtdbAdapter, room: RoomRecord): Promise<void> {
  const rect = normalizeRoomRect(room.x1, room.z1, room.x2, room.z2);
  if ("error" in rect) throw new Error(rect.error);
  await rtdb.set(roomNode(room.id), { ...room, ...rect, updatedAt: Date.now() });
}

export async function removeRtdbRoom(rtdb: RtdbAdapter, roomId: string): Promise<void> {
  await rtdb.remove(roomNode(roomId));
}

/** Seeds the default rooms when the tree is empty (idempotent). Returns count written. */
export async function ensureDefaultRooms(rtdb: RtdbAdapter, updatedBy: string | null = null): Promise<number> {
  const existing = await readRtdbRooms(rtdb);
  if (existing.length > 0) return 0;
  let written = 0;
  for (const room of DEFAULT_ROOMS) {
    await writeRtdbRoom(rtdb, { ...room, updatedAt: Date.now(), updatedBy });
    written += 1;
  }
  return written;
}
