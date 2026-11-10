import { test } from "node:test";
import { ok, equal } from "node:assert/strict";

import {
  AC_FLOOR_HALF,
  AC_SPLIT_HALF_DEPTH,
  CEILING_HEIGHT,
  DEFAULT_ROOM_VERTICES,
  OUTDOOR_CAMPUS_BOUNDS,
  WALL_FLUSH_GAP,
  WALL_HALF_THICK,
  computeExteriorWallSegments,
  normalizeRotation,
  type WallSegment,
} from "../src/lib/facility-layout";
import {
  isAcDeviceType,
  resolveAcDevicePlacement,
  resolveWallPhysicsAndSnap,
  suggestAcDeviceSlot,
} from "../src/lib/facility-placement";

/** Nearest-face distance from a point to any wall centerline (for preconditions). */
function nearestWallFaceDist(x: number, z: number): { dist: number; seg: WallSegment; side: 1 | -1 } {
  let best = { dist: Infinity, seg: null as unknown as WallSegment, side: 1 as 1 | -1 };
  for (const seg of computeExteriorWallSegments(null)) {
    const dx = seg.x2 - seg.x1;
    const dz = seg.z2 - seg.z1;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    const tx = dx / len;
    const tz = dz / len;
    const nx = -tz;
    const nz = tx;
    const along = (x - seg.x1) * tx + (z - seg.z1) * tz;
    if (along < 0 || along > len) continue;
    const signedPerp = (x - seg.x1) * nx + (z - seg.z1) * nz;
    const faceDist = Math.abs(Math.abs(signedPerp) - WALL_HALF_THICK);
    if (faceDist < best.dist) best = { dist: faceDist, seg, side: signedPerp >= 0 ? 1 : -1 };
  }
  return best;
}

function centroid(): { x: number; z: number } {
  const x = DEFAULT_ROOM_VERTICES.reduce((s, v) => s + v.x, 0) / DEFAULT_ROOM_VERTICES.length;
  const z = DEFAULT_ROOM_VERTICES.reduce((s, v) => s + v.z, 0) / DEFAULT_ROOM_VERTICES.length;
  return { x, z };
}

test("isAcDeviceType narrows exactly the three AC kinds", () => {
  equal(isAcDeviceType("AC_DAK"), true);
  equal(isAcDeviceType("AC_SPLIT_WALL"), true);
  equal(isAcDeviceType("AC_STANDING"), true);
  equal(isAcDeviceType("AHU"), false);
  equal(isAcDeviceType(null), false);
  equal(isAcDeviceType(undefined), false);
});

test("AC_SPLIT_WALL: refuses mid-floor placement — it must mount on a wall", () => {
  const { x, z } = centroid();
  ok(nearestWallFaceDist(x, z).dist > 2.4, "test precondition: centroid far from every wall");
  const check = resolveAcDevicePlacement("AC_SPLIT_WALL", x, z, []);
  equal(check.valid, false);
  ok(check.reason?.includes("wall"), `reason mentions the wall: ${check.reason}`);
});

test("AC_SPLIT_WALL: snaps flush onto the nearest wall, back plate against the face", () => {
  const seg = computeExteriorWallSegments(null).find((s) => Math.hypot(s.x2 - s.x1, s.z2 - s.z1) >= 4);
  ok(seg, "test precondition: a long enough wall exists");
  const len = Math.hypot(seg!.x2 - seg!.x1, seg!.z2 - seg!.z1);
  const tx = (seg!.x2 - seg!.x1) / len;
  const tz = (seg!.z2 - seg!.z1) / len;
  const nx = -tz;
  const nz = tx;
  const along = len / 2;
  // 1 m off the wall face — well inside the 2.4 m snap range
  const rawX = seg!.x1 + tx * along + nx * (WALL_HALF_THICK + 1);
  const rawZ = seg!.z1 + tz * along + nz * (WALL_HALF_THICK + 1);

  const check = resolveAcDevicePlacement("AC_SPLIT_WALL", rawX, rawZ, []);
  equal(check.valid, true);
  equal(check.snappedToWall, true);

  // Final position sits exactly on the flush offset from the wall centerline.
  const finalAlong = (check.snappedX - seg!.x1) * tx + (check.snappedZ - seg!.z1) * tz;
  const finalPerp = (check.snappedX - seg!.x1) * nx + (check.snappedZ - seg!.z1) * nz;
  ok(Math.abs(finalAlong) <= len / 2 + 0.01, "stays on the wall span");
  const expectedPerp = (WALL_HALF_THICK + WALL_FLUSH_GAP + AC_SPLIT_HALF_DEPTH) * Math.sign(finalPerp);
  ok(Math.abs(Math.abs(finalPerp) - Math.abs(expectedPerp)) < 0.02, `flush offset, got ${finalPerp.toFixed(3)}`);

  // The unit's back (local -Z) faces the wall: back direction ≈ -side * normal.
  const ry = (-check.rotation * Math.PI) / 180;
  const backX = -Math.sin(ry);
  const backZ = -Math.cos(ry);
  const side = finalPerp >= 0 ? 1 : -1;
  const towardWall = { x: -side * nx, z: -side * nz };
  ok(backX * towardWall.x + backZ * towardWall.z > 0.99, "back plate faces the wall");
});

test("AC_DAK: cannot exist outdoors — it mounts against the ceiling slab", () => {
  const outdoor = resolveAcDevicePlacement("AC_DAK", OUTDOOR_CAMPUS_BOUNDS.xMax - 2, OUTDOOR_CAMPUS_BOUNDS.zMax - 2, []);
  equal(outdoor.valid, false);
  ok(outdoor.reason?.includes("ceiling"), `reason mentions the ceiling: ${outdoor.reason}`);

  const { x, z } = centroid();
  const indoor = resolveAcDevicePlacement("AC_DAK", x, z, []);
  equal(indoor.valid, true);
  equal(indoor.indoor, true);
  // Cassette stays at the ceiling plane; rotation free.
  equal(indoor.rotation, normalizeRotation(0));
  ok(CEILING_HEIGHT > 2.5);
});

test("AC_STANDING: stands on the floor and is pushed out of walls", () => {
  const seg = computeExteriorWallSegments(null).find((s) => Math.hypot(s.x2 - s.x1, s.z2 - s.z1) >= 4)!;
  const len = Math.hypot(seg.x2 - seg.x1, seg.z2 - seg.z1);
  const tx = (seg.x2 - seg.x1) / len;
  const tz = (seg.z2 - seg.z1) / len;
  const nx = -tz;
  const nz = tx;
  // Raw point exactly ON the wall centerline — the tower must be pushed clear.
  const rawX = seg.x1 + tx * (len / 2);
  const rawZ = seg.z1 + tz * (len / 2);
  const check = resolveAcDevicePlacement("AC_STANDING", rawX, rawZ, []);
  equal(check.valid, true);
  const perp = Math.abs((check.snappedX - seg.x1) * nx + (check.snappedZ - seg.z1) * nz);
  ok(perp >= WALL_HALF_THICK + AC_FLOOR_HALF - 0.02, `clear of the wall face, perp=${perp.toFixed(3)}`);
});

test("AC units keep clearance from other registered units", () => {
  const { x, z } = centroid();
  const blocked = resolveAcDevicePlacement("AC_STANDING", x, z, [{ id: "GTM-DAIKIN-001", x, z }]);
  equal(blocked.valid, false);
  ok(blocked.reason?.includes("GTM-DAIKIN-001"));
});

test("suggestAcDeviceSlot returns a mount-valid slot for every AC kind", () => {
  for (const deviceType of ["AC_SPLIT_WALL", "AC_DAK", "AC_STANDING"] as const) {
    const slot = suggestAcDeviceSlot(deviceType, [], null);
    const check = resolveAcDevicePlacement(deviceType, slot.x, slot.z, []);
    equal(check.valid, true, `${deviceType} slot should re-validate: ${check.reason}`);
    if (deviceType === "AC_SPLIT_WALL") equal(check.snappedToWall, true);
    if (deviceType === "AC_DAK") equal(check.indoor, true);
  }
});

test("2026-11-10: NO device may sit outside the building", () => {
  // AHU outdoors is now rejected by the main solver.
  const outdoor = resolveWallPhysicsAndSnap(OUTDOOR_CAMPUS_BOUNDS.xMax - 3, OUTDOOR_CAMPUS_BOUNDS.zMax - 3, []);
  equal(outdoor.valid, false);
  ok(outdoor.reason?.includes("inside the building"), `reason: ${outdoor.reason}`);

  // Standing units too.
  const tower = resolveAcDevicePlacement("AC_STANDING", OUTDOOR_CAMPUS_BOUNDS.xMax - 3, OUTDOOR_CAMPUS_BOUNDS.zMax - 3, []);
  equal(tower.valid, false);

  // A split dragged onto an OUTER wall face must land on the INDOOR face.
  const seg = computeExteriorWallSegments(null).find((s) => Math.hypot(s.x2 - s.x1, s.z2 - s.z1) >= 4)!;
  const len = Math.hypot(seg.x2 - seg.x1, seg.z2 - seg.z1);
  const tx = (seg.x2 - seg.x1) / len;
  const tz = (seg.z2 - seg.z1) / len;
  const nx = -tz;
  const nz = tx;
  const { x: cx, z: cz } = centroid();
  const toRoom = { x: cx - seg.x1, z: cz - seg.z1 };
  const roomSide = Math.sign(toRoom.x * nx + toRoom.z * nz) as 1 | -1;
  const outsideX = seg.x1 + tx * (len / 2) + nx * -roomSide * 0.8;
  const outsideZ = seg.z1 + tz * (len / 2) + nz * -roomSide * 0.8;
  const split = resolveAcDevicePlacement("AC_SPLIT_WALL", outsideX, outsideZ, []);
  equal(split.valid, true);
  equal(split.indoor, true, "split must hang on the indoor face");
});
