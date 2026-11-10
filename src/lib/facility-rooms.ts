/**
 * facility-rooms.ts — the ROOMS layer: an independent, user-editable set of
 * named rectangular zones laid over the facility (the building outline and
 * its walls are a separate system and are NOT affected by rooms).
 *
 * Interaction model (per project owner): grid + points, like the existing
 * floorplan editor — rooms are axis-aligned rectangles whose 4 corners snap
 * to the same 0.5 m platform grid.
 *
 * Room temperature semantics (owner-confirmed):
 *   - a room's displayed temp comes ONLY from a real device reading
 *     (room_temp) of a unit placed inside that room;
 *   - rooms without a sensor show unknown (blank) — never fabricated.
 */

/** Device kinds. GTM-DAIKIN-001 is explicitly an AHU; the AC kinds are
 * stored so their 3D models exist — they get used when tokens for such
 * devices are registered. */
export type DeviceType = "AHU" | "AC_DAK" | "AC_SPLIT_WALL" | "AC_STANDING";

export const DEVICE_TYPES: readonly DeviceType[] = ["AHU", "AC_DAK", "AC_SPLIT_WALL", "AC_STANDING"];

export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  AHU: "AHU (Air Handling Unit)",
  AC_DAK: "AC Dak (ceiling cassette)",
  AC_SPLIT_WALL: "AC Split Wall",
  AC_STANDING: "AC Standing (floor tower)",
};

export function isDeviceType(value: unknown): value is DeviceType {
  return typeof value === "string" && (DEVICE_TYPES as readonly string[]).includes(value);
}

/** Axis-aligned room rectangle. Corners are grid points (0.5 m). */
export interface RoomRecord {
  id: string;
  name: string;
  /** Hex color (visual identity + 3D floor tint). */
  color: string;
  /** min corner (grid-snapped). */
  x1: number;
  z1: number;
  /** max corner (grid-snapped). */
  x2: number;
  z2: number;
  updatedAt?: number;
  updatedBy?: string | null;
}

export const ROOM_GRID_STEP = 0.5;
export const ROOM_MIN_SIZE = 1; // meters — corners too close are rejected
export const ROOM_MAX_SIZE = 80;

/** Stable visual palette cycled when rooms are created without a color. */
export const ROOM_COLORS = [
  "#6366f1", // indigo
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ec4899", // pink
  "#8b5cf6", // violet
  "#14b8a6", // teal
  "#f43f5e", // rose
] as const;

export function snapRoom(v: number): number {
  return Math.round(v / ROOM_GRID_STEP) * ROOM_GRID_STEP;
}

/** Normalizes a raw corner pair into a valid stored rect (snapped, ordered, clamped). */
export function normalizeRoomRect(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): { x1: number; z1: number; x2: number; z2: number } | { error: string } {
  const xs = [snapRoom(x1), snapRoom(x2)].sort((a, b) => a - b);
  const zs = [snapRoom(z1), snapRoom(z2)].sort((a, b) => a - b);
  const rect = { x1: xs[0], z1: zs[0], x2: xs[1], z2: zs[1] };
  const w = rect.x2 - rect.x1;
  const d = rect.z2 - rect.z1;
  if (!(w >= ROOM_MIN_SIZE && d >= ROOM_MIN_SIZE)) {
    return { error: `Room must be at least ${ROOM_MIN_SIZE} m × ${ROOM_MIN_SIZE} m.` };
  }
  if (w > ROOM_MAX_SIZE || d > ROOM_MAX_SIZE) {
    return { error: `Room must be at most ${ROOM_MAX_SIZE} m on a side.` };
  }
  return rect;
}

export function roomContains(room: Pick<RoomRecord, "x1" | "z1" | "x2" | "z2">, x: number, z: number): boolean {
  return x >= room.x1 && x <= room.x2 && z >= room.z1 && z <= room.z2;
}

/** The room containing a point, or null. Ties resolve to the first (stable). */
export function roomAt(rooms: readonly RoomRecord[], x: number, z: number): RoomRecord | null {
  for (const room of rooms) {
    if (roomContains(room, x, z)) return room;
  }
  return null;
}

export function roomCenter(room: Pick<RoomRecord, "x1" | "z1" | "x2" | "z2">): { x: number; z: number } {
  return { x: (room.x1 + room.x2) / 2, z: (room.z1 + room.z2) / 2 };
}

export function roomSize(room: Pick<RoomRecord, "x1" | "z1" | "x2" | "z2">): { w: number; d: number } {
  return { w: room.x2 - room.x1, d: room.z2 - room.z1 };
}

/** Next palette color not already taken by an existing room. */
export function nextRoomColor(rooms: readonly Pick<RoomRecord, "color">[]): string {
  const taken = new Set(rooms.map((r) => r.color));
  return ROOM_COLORS.find((c) => !taken.has(c)) ?? ROOM_COLORS[rooms.length % ROOM_COLORS.length];
}

/**
 * Default room layout: named rectangles inside the default 22-corner hall,
 * matching its wings. The NW room contains the AHU's current auto slot
 * (-12, -13), so GTM-DAIKIN-001's real room_temp shows there out of the box.
 */
export const DEFAULT_ROOMS: ReadonlyArray<Omit<RoomRecord, "updatedAt" | "updatedBy">> = [
  { id: "room-nw", name: "North-West Room", color: "#6366f1", x1: -20, z1: -18, x2: -8, z2: -8 },
  { id: "room-central", name: "Central Room", color: "#0ea5e9", x1: -8, z1: -8, x2: 10, z2: 8 },
  { id: "room-east", name: "East Room", color: "#10b981", x1: 10, z1: -12, x2: 22, z2: 2 },
  { id: "room-west", name: "West Room", color: "#f59e0b", x1: -22, z1: 0, x2: -8, z2: 12 },
  { id: "room-se", name: "South-East Room", color: "#8b5cf6", x1: -2, z1: 8, x2: 14, z2: 20 },
];

/** Room id from name-ish slug (creation helper). */
export function slugRoomId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return slug.length >= 2 ? slug : `room-${Math.random().toString(36).slice(2, 8)}`;
}
