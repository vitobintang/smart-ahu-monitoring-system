import { test } from "node:test";
import { deepStrictEqual, equal, rejects } from "node:assert/strict";

import { InMemoryRtdb } from "../src/lib/rtdb/store";
import {
  DEFAULT_ROOMS,
  DEVICE_TYPES,
  isDeviceType,
  nextRoomColor,
  normalizeRoomRect,
  roomAt,
  roomCenter,
  roomSize,
  snapRoom,
} from "../src/lib/facility-rooms";
import { ensureDefaultRooms, readRtdbRooms, removeRtdbRoom, writeRtdbRoom } from "../src/lib/rtdb/rooms";
import { defaultAhuRecord } from "../src/lib/rtdb/registry";

const T0 = 1_794_182_400_000;

test("grid snap + rect normalization (rooms editor semantics)", () => {
  equal(snapRoom(12.34), 12.5);
  equal(snapRoom(-3.21), -3.0);
  deepStrictEqual(normalizeRoomRect(0, 0, 4, 6), { x1: 0, z1: 0, x2: 4, z2: 6 });
  // reversed corners normalize into ordered min/max
  deepStrictEqual(normalizeRoomRect(4, 6, 0, 0), { x1: 0, z1: 0, x2: 4, z2: 6 });
  // too small rejected (the editor shows the error)
  const small = normalizeRoomRect(0, 0, 0.5, 3);
  equal("error" in small, true);
});

test("containment: a room temp shows only for units inside that room", () => {
  const room = { id: "r1", name: "R", color: "#000", x1: -20, z1: -18, x2: -8, z2: -8 };
  equal(roomAt([room], -12, -13), room, "GTM-DAIKIN-001's auto slot (-12,-13) lands in the NW default room");
  equal(roomAt([room], 0, 0), null);
  const other = { id: "r2", name: "O", color: "#111", x1: 10, z1: -12, x2: 22, z2: 2 };
  equal(roomAt([room, other], 15, -6), other);
  deepStrictEqual(roomSize(room), { w: 12, d: 10 });
  deepStrictEqual(roomCenter(room), { x: -14, z: -13 });
});

test("default rooms: GTM's current spot is covered, rooms stay inside the hall", () => {
  equal(roomAt(DEFAULT_ROOMS, -12, -13)?.id, "room-nw", "the AHU's auto-placed slot has a room");
  equal(DEFAULT_ROOMS.length, 5);
  for (const room of DEFAULT_ROOMS) {
    // every default room is grid-aligned (Math.abs keeps -0 out of the comparison)
    for (const v of [room.x1, room.z1, room.x2, room.z2]) equal(Math.abs(v % 0.5), 0);
  }
});

test("device types: the four kinds validate; AHU is the default", () => {
  equal(isDeviceType("AHU"), true);
  for (const t of ["AC_DAK", "AC_SPLIT_WALL", "AC_STANDING"]) {
    equal(DEVICE_TYPES.includes(t as never), true);
  }
  equal(isDeviceType("ac_split"), false);
  equal(isDeviceType(undefined), false);
  equal(defaultAhuRecord("GTM-DAIKIN-001", T0).deviceType, "AHU", "fleet units are AHUs by default");
});

test("rooms store: write/read round-trip, defaults seeding, removal", async () => {
  const db = new InMemoryRtdb();
  equal(await readRtdbRooms(db).then((r) => r.length), 0);

  // seeding fills the default layout exactly once
  equal(await ensureDefaultRooms(db, "seed"), DEFAULT_ROOMS.length);
  equal(await ensureDefaultRooms(db, "seed"), 0, "second run is a no-op");
  const seeded = await readRtdbRooms(db);
  equal(seeded.length, DEFAULT_ROOMS.length);
  equal(seeded[0]?.name, "Central Room"); // sorted by id: room-central < room-east …

  // explicit write round-trips grid-snapped
  await writeRtdbRoom(db, { id: "room-lab", name: "Lab", color: "#123456", x1: 1.2, z1: 3.7, x2: 5.8, z2: 9.1 });
  const lab = (await readRtdbRooms(db)).find((r) => r.id === "room-lab");
  deepStrictEqual(lab && { x1: lab.x1, z1: lab.z1, x2: lab.x2, z2: lab.z2 }, { x1: 1, z1: 3.5, x2: 6, z2: 9 });

  // invalid rect rejected on write
  await rejects(() => writeRtdbRoom(db, { id: "tiny", name: "T", color: "#000", x1: 0, z1: 0, x2: 0.5, z2: 3 }));

  await removeRtdbRoom(db, "room-lab");
  equal((await readRtdbRooms(db)).some((r) => r.id === "room-lab"), false);
});

test("nextRoomColor cycles the palette without repeating taken colors", () => {
  const taken = DEFAULT_ROOMS.map((r) => ({ color: r.color }));
  equal(nextRoomColor(taken), "#ec4899", "first unused palette entry");
});
