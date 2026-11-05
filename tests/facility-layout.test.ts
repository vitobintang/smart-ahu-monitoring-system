import { test } from "node:test";
import { equal, ok } from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  collidesWithAnyWall,
  computeExteriorWallSegments,
  computePolygonAreaSqM,
  DEFAULT_AHU_PLACEMENTS,
  DEFAULT_ROOM_VERTICES,
  deleteFloorVertex,
  dragFloorWall,
  extrudeWingOnWall,
  FACILITY_ZONES,
  generateRandomTreePool,
  insertVertexOnWall,
  isFootprintOnPlatform,
  isOutdoorTreeSpotClear,
  MAX_VISIBLE_OUTDOOR_TREES,
  MIN_AHU_SPACING,
  moveFloorVertex,
  resolveAhuPlacement,
  resolveWallPhysicsAndSnap,
  suggestCleanPlatformSlot,
  validateFloorplanPolygon,
  validatePlatformPlacement,
} from "../src/lib/facility-layout";
import { commandFeedbackMatches, computeAhuStatus } from "../src/lib/domain";
import { isOfflineNetworkError, isTransientDbError, summarizeDbError } from "../src/db";
import AhuSchematic from "../src/components/AhuSchematic";

test("facility room is non-rectangular multi-branch with 5 indoor AHUs and 2 outdoor AHUs", () => {
  const walls = computeExteriorWallSegments();
  ok(walls.length >= 12, `expected >= 12 outer wall segments, got ${walls.length}`);

  const placements = Object.entries(DEFAULT_AHU_PLACEMENTS).map(([id, pos]) =>
    resolveAhuPlacement({ id, mapX: pos.x, mapZ: pos.z, mapRotation: pos.rotation, mapZone: pos.zone }),
  );
  equal(placements.length, 7);

  const indoor = placements.filter((p) => p.indoor);
  const outdoor = placements.filter((p) => !p.indoor);
  equal(indoor.length, 5, "5 AHUs should sit inside the multi-branch room");
  equal(outdoor.length, 2, "2 AHUs should sit outside on the exterior grounds");

  for (const p of placements) {
    const fp = isFootprintOnPlatform(p.x, p.z, p.rotation);
    equal(fp.ok, true, `${p.id} at (${p.x}, ${p.z}, ${p.rotation}deg) must sit cleanly on floor/grounds`);
    equal(collidesWithAnyWall(p.x, p.z, p.rotation), false, `${p.id} must never overlap a wall`);
  }
});

test("unrestricted outdoor campus allows placing or moving AHUs anywhere outside while solid walls snap & block clipping", () => {
  const existing = Object.entries(DEFAULT_AHU_PLACEMENTS).map(([id, pos]) => ({
    id,
    x: pos.x,
    z: pos.z,
    rotation: pos.rotation,
  }));

  // Attempting to place directly inside a wall thickness triggers wall collision
  equal(collidesWithAnyWall(-10, -18, 0), true);

  // Indoor wall snap: near inside of North Cleanroom wall (-8, -16.5) snaps flush inside facing South (0deg)
  const indoorSnap = resolveWallPhysicsAndSnap(-8, -16.5, existing, {
    enableWallSnap: true,
    autoAlignRotation: true,
  });
  equal(indoorSnap.valid, true);
  equal(indoorSnap.indoor, true);
  equal(indoorSnap.snappedToWall, true);
  equal(indoorSnap.rotation, 0);
  equal(collidesWithAnyWall(indoorSnap.snappedX, indoorSnap.snappedZ, indoorSnap.rotation), false);

  // Outdoor wall snap: near outside of East wall (15.6, 10.2) snaps flush outside facing East (270deg)
  const outdoorWallSnap = resolveWallPhysicsAndSnap(15.6, 10.2, existing, {
    enableWallSnap: true,
    autoAlignRotation: true,
  });
  equal(outdoorWallSnap.valid, true);
  equal(outdoorWallSnap.indoor, false);
  equal(outdoorWallSnap.snappedToWall, true);
  equal(outdoorWallSnap.rotation, 270);
  equal(collidesWithAnyWall(outdoorWallSnap.snappedX, outdoorWallSnap.snappedZ, outdoorWallSnap.rotation), false);

  // Unrestricted open outdoor placement anywhere around the building (no yellow pad limitation!)
  for (const [ox, oz] of [
    [-30, -26],
    [28, 24],
    [-28, 22],
    [0, -26],
  ]) {
    const res = validatePlatformPlacement(ox, oz, existing);
    equal(res.valid, true, `Outdoor placement at (${ox}, ${oz}) should be allowed anywhere outside`);
    equal(res.indoor, false);
    equal(collidesWithAnyWall(res.snappedX, res.snappedZ, res.rotation), false);
  }
});

test("floor platform placement rejects off-site and overlapping positions and suggests clean slots", () => {
  const existing = Object.entries(DEFAULT_AHU_PLACEMENTS).map(([id, pos]) => ({
    id,
    x: pos.x,
    z: pos.z,
    rotation: pos.rotation,
  }));

  // Far beyond site boundaries
  const offMap = validatePlatformPlacement(-60, -60, existing);
  equal(offMap.valid, false);

  // Directly on top of AHU-01 (-12, -13)
  const overlap = validatePlatformPlacement(-12, -13, existing);
  equal(overlap.valid, false);
  ok(overlap.reason?.includes("AHU-01"));

  // Auto-suggested indoor and outdoor slots are guaranteed valid and collision-free
  const cleanIndoor = suggestCleanPlatformSlot(existing, true);
  equal(cleanIndoor.indoor, true);
  const checkIn = validatePlatformPlacement(cleanIndoor.x, cleanIndoor.z, existing, undefined, cleanIndoor.rotation);
  equal(checkIn.valid, true);
  for (const u of existing) {
    ok(Math.hypot(u.x - cleanIndoor.x, u.z - cleanIndoor.z) >= MIN_AHU_SPACING * 0.85);
  }

  const cleanOutdoor = suggestCleanPlatformSlot(existing, false);
  equal(cleanOutdoor.indoor, false);
  const checkOut = validatePlatformPlacement(cleanOutdoor.x, cleanOutdoor.z, existing, undefined, cleanOutdoor.rotation);
  equal(checkOut.valid, true);
  ok(FACILITY_ZONES.some((z) => !z.indoor && z.id === cleanOutdoor.zone.id));
});

test("STOP coast-down and settled 0% fan feedback keep unit online in STOP so START is immediately allowed", () => {
  const now = new Date("2026-11-05T07:00:00.000Z");

  const coasting = computeAhuStatus({
    lastSeenAt: now,
    commTimeoutSec: 30,
    faultCode: null,
    hasCriticalAlarm: false,
    fanSpeed: 14,
    runState: "RUN",
    now,
  });
  equal(coasting.status, "RUN");

  const stoppedReading = { runState: "STOP", fanSpeed: 0 };
  equal(commandFeedbackMatches("STOP", stoppedReading, { setpoint: 22, controlMode: "AUTO" }), true);

  const stoppedStatus = computeAhuStatus({
    lastSeenAt: now,
    commTimeoutSec: 30,
    faultCode: null,
    hasCriticalAlarm: false,
    fanSpeed: 0,
    runState: "STOP",
    now,
  });
  equal(stoppedStatus.status, "STOP");

  const restartedReading = { runState: "RUN", fanSpeed: 28 };
  equal(commandFeedbackMatches("START", restartedReading, { setpoint: 22, controlMode: "AUTO" }), true);
});

test("airflow SVG paths use exact integer dash-period offsets so loops never jump or pause", () => {
  const html = renderToStaticMarkup(
    React.createElement(AhuSchematic, {
      ahuId: "AHU-01",
      hasHeater: true,
      installed: ["supplyTemp", "fanSpeed", "coilTemp", "damperPosition", "filterDiffPressure", "heaterOutput"],
      status: "RUN",
      values: {
        supplyTemp: 18.5,
        fanSpeed: 78,
        coilTemp: 8.2,
        damperPosition: 72,
        filterDiffPressure: 115,
        heaterOutput: 0,
      },
      fallback: { current: false, voltage: false },
      source: "SIMULATION",
    }),
  );

  ok(html.includes("--flow-offset:-256"));
  ok(html.includes("--flow-offset:-160"));
  ok(html.includes("--flow-offset:-192"));
});

test("Supavisor EMAXCONNSESSION and offline DNS ENOTFOUND errors are classified cleanly for pool retry and circuit-breaker backoff", () => {
  const supavisorErr = new Error("Failed query: select * from ahu_private.ahus", {
    cause: Object.assign(
      new Error("(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15"),
      { code: "XX000" },
    ),
  });
  equal(isTransientDbError(supavisorErr), true);
  equal(isOfflineNetworkError(supavisorErr), false);
  ok(summarizeDbError(supavisorErr).includes("EMAXCONNSESSION"));

  const dnsErr = new Error("Failed query: select * from ahu_private.ahus", {
    cause: Object.assign(new Error("getaddrinfo ENOTFOUND aws-0-ap-southeast-1.pooler.supabase.com"), {
      code: "ENOTFOUND",
    }),
  });
  equal(isOfflineNetworkError(dnsErr), true);
  ok(summarizeDbError(dnsErr).includes("ENOTFOUND"));
});

test("3D room editor operations: drag wall, insert/move/delete corner, extrude wing, and snap AHU to custom angled wall", () => {
  const baseCheck = validateFloorplanPolygon(DEFAULT_ROOM_VERTICES);
  equal(baseCheck.valid, true);
  equal(DEFAULT_ROOM_VERTICES.length, 22);
  const baseArea = computePolygonAreaSqM(DEFAULT_ROOM_VERTICES);
  ok(baseArea > 800, `expected default multi-wing area > 800 m², got ${baseArea}`);

  // 1. Dragging the top NW Cleanroom wall (edge 0: (-20,-18) -> (-4,-18)) northward to z = -22 expands indoor floor area
  const expanded = dragFloorWall(DEFAULT_ROOM_VERTICES, 0, -12, -22, 0.5);
  ok(computePolygonAreaSqM(expanded) > baseArea);
  const ahuInExpandedWing = validatePlatformPlacement(-12, -20, [], undefined, 0, expanded);
  equal(ahuInExpandedWing.valid, true);
  equal(ahuInExpandedWing.indoor, true);

  // 2. Inserting a new corner point on East Lab's outer wall (edge 7: (22,-12) -> (22,2)) and pulling it out into an angled bay
  const splitRes = insertVertexOnWall(DEFAULT_ROOM_VERTICES, 7, { x: 22, z: -5 }, 0.5);
  ok(splitRes !== null);
  equal(splitRes!.vertices.length, 23);

  const angledRoom = moveFloorVertex(splitRes!.vertices, splitRes!.insertedIndex, 26, -5, 0.5);
  equal(validateFloorplanPolygon(angledRoom).valid, true);
  ok(computePolygonAreaSqM(angledRoom) > baseArea);

  // Magnetic wall snap aligns AHU flush against the newly created diagonal wall with zero wall collision!
  const snapDiagonal = resolveWallPhysicsAndSnap(23.6, -8.5, [], {
    enableWallSnap: true,
    autoAlignRotation: true,
    roomVertices: angledRoom,
  });
  equal(snapDiagonal.valid, true);
  equal(snapDiagonal.snappedToWall, true);
  equal(collidesWithAnyWall(snapDiagonal.snappedX, snapDiagonal.snappedZ, snapDiagonal.rotation, angledRoom), false);

  // 3. One-click Extrude Wing pops out 4 new orthogonal corners on South-East Warehouse bottom wall (edge 12: (14,20) -> (-2,20))
  const extruded = extrudeWingOnWall(DEFAULT_ROOM_VERTICES, 12, 4);
  ok(extruded !== null);
  equal(extruded!.length, 26);
  ok(computePolygonAreaSqM(extruded!) > baseArea + 30);

  // 4. Deleting the newly inserted vertex restores the 22-corner room cleanly
  const afterDelete = deleteFloorVertex(angledRoom, splitRes!.insertedIndex);
  ok(afterDelete !== null);
  equal(afterDelete!.length, 22);

  // 5. Self-intersecting bowtie walls are rejected by polygon validator
  const bowtie = [
    { x: -10, z: -10 },
    { x: 10, z: 10 },
    { x: 10, z: -10 },
    { x: -10, z: 10 },
  ];
  equal(validateFloorplanPolygon(bowtie).valid, false);
});

test("randomized outdoor trees keep a sparse count and automatically appear/disappear as the room shrinks or expands", () => {
  // Deterministic PRNG so test is 100% repeatable
  let s = 424242;
  const rng = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };

  const pool = generateRandomTreePool(DEFAULT_ROOM_VERTICES, [], rng);
  ok(pool.length >= 8 && pool.length <= 12, `expected 8..12 total pool candidates, got ${pool.length}`);

  const countVisible = (room: Array<{ x: number; z: number }>) =>
    Math.min(
      MAX_VISIBLE_OUTDOOR_TREES,
      pool.filter((t) => isOutdoorTreeSpotClear(t.x, t.z, room, [])).length,
    );

  // At default room size: just a few (4–6) outdoor trees are visible
  const defaultVisible = countVisible(DEFAULT_ROOM_VERTICES);
  ok(defaultVisible >= 3 && defaultVisible <= 6, `expected 3..6 initial trees, got ${defaultVisible}`);

  // Shrinking the room to a small central box uncovers dormant seeds -> more trees automatically appear!
  const shrunkRoom = [
    { x: -4, z: -4 },
    { x: 4, z: -4 },
    { x: 4, z: 4 },
    { x: -4, z: 4 },
  ];
  const shrunkVisible = countVisible(shrunkRoom);
  ok(shrunkVisible > defaultVisible, `expected more trees when room shrinks (${shrunkVisible} > ${defaultVisible})`);
  ok(shrunkVisible <= MAX_VISIBLE_OUTDOOR_TREES);

  // Expanding the room wide across the campus covers outdoor spots -> trees automatically disappear!
  const hugeRoom = [
    { x: -34, z: -32 },
    { x: 34, z: -32 },
    { x: 34, z: 32 },
    { x: -34, z: 32 },
  ];
  const hugeVisible = countVisible(hugeRoom);
  ok(hugeVisible < defaultVisible, `expected fewer trees when room expands (${hugeVisible} < ${defaultVisible})`);
});


