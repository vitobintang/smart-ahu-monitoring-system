import { test } from "node:test";
import { equal, ok } from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  collidesWithAnyWall,
  computeExteriorWallSegments,
  DEFAULT_AHU_PLACEMENTS,
  FACILITY_ZONES,
  isFootprintOnPlatform,
  MIN_AHU_SPACING,
  resolveAhuPlacement,
  resolveWallPhysicsAndSnap,
  suggestCleanPlatformSlot,
  validatePlatformPlacement,
} from "../src/lib/facility-layout";
import { commandFeedbackMatches, computeAhuStatus } from "../src/lib/domain";
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
