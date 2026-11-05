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

test("facility room is non-rectangular multi-branch with 5 indoor AHUs and 2 outdoor wall-mounted AHUs", () => {
  const walls = computeExteriorWallSegments();
  ok(walls.length >= 12, `expected >= 12 outer wall segments, got ${walls.length}`);

  const placements = Object.entries(DEFAULT_AHU_PLACEMENTS).map(([id, pos]) =>
    resolveAhuPlacement({ id, mapX: pos.x, mapZ: pos.z, mapRotation: pos.rotation, mapZone: pos.zone }),
  );
  equal(placements.length, 7);

  const indoor = placements.filter((p) => p.indoor);
  const outdoor = placements.filter((p) => !p.indoor);
  equal(indoor.length, 5, "5 AHUs should sit inside the multi-branch room");
  equal(outdoor.length, 2, "2 AHUs should sit outside on outdoor concrete pads");

  for (const p of placements) {
    const fp = isFootprintOnPlatform(p.x, p.z, p.rotation);
    equal(fp.ok, true, `${p.id} at (${p.x}, ${p.z}, ${p.rotation}deg) must sit cleanly on a floor platform`);
    equal(collidesWithAnyWall(p.x, p.z, p.rotation), false, `${p.id} must never overlap a wall`);
  }

  // Outdoor AHU-06 sits flush against East exterior wall (x = 14) and AHU-07 flush against North wall (z = -12)
  ok(Math.abs(DEFAULT_AHU_PLACEMENTS["AHU-06"].x - 14) <= 1.2, "AHU-06 should sit flush against x=14 exterior wall");
  ok(Math.abs(DEFAULT_AHU_PLACEMENTS["AHU-07"].z - -12) <= 1.2, "AHU-07 should sit flush against z=-12 exterior wall");
});

test("solid wall physics blocks passing through walls and magnetically snaps flush to walls", () => {
  const existing = Object.entries(DEFAULT_AHU_PLACEMENTS).map(([id, pos]) => ({
    id,
    x: pos.x,
    z: pos.z,
    rotation: pos.rotation,
  }));

  // Attempting to place directly inside a wall thickness triggers wall collision
  equal(collidesWithAnyWall(-10, -18, 0), true);

  // Dragging cursor past the North Cleanroom wall (-8, -24) with clampVoidToWall keeps AHU inside & snapped flush
  const draggedAgainstNorthWall = resolveWallPhysicsAndSnap(-8, -24, existing, {
    clampVoidToWall: true,
    enableWallSnap: true,
    autoAlignRotation: true,
  });
  equal(draggedAgainstNorthWall.valid, true);
  equal(draggedAgainstNorthWall.indoor, true);
  equal(draggedAgainstNorthWall.snappedToWall, true);
  equal(draggedAgainstNorthWall.rotation, 0);
  equal(
    collidesWithAnyWall(
      draggedAgainstNorthWall.snappedX,
      draggedAgainstNorthWall.snappedZ,
      draggedAgainstNorthWall.rotation,
    ),
    false,
  );

  // Bringing an AHU near the outdoor side of the East wall (15.6, 10.5) snaps it flush against x=14 facing East (270deg)
  const outdoorSnap = resolveWallPhysicsAndSnap(15.6, 10.2, existing, {
    clampVoidToWall: true,
    enableWallSnap: true,
    autoAlignRotation: true,
  });
  equal(outdoorSnap.valid, true);
  equal(outdoorSnap.indoor, false);
  equal(outdoorSnap.snappedToWall, true);
  equal(outdoorSnap.rotation, 270);
  equal(
    collidesWithAnyWall(outdoorSnap.snappedX, outdoorSnap.snappedZ, outdoorSnap.rotation),
    false,
  );
});

test("floor platform placement rejects off-platform and overlapping positions and suggests clean slots", () => {
  const existing = Object.entries(DEFAULT_AHU_PLACEMENTS).map(([id, pos]) => ({
    id,
    x: pos.x,
    z: pos.z,
    rotation: pos.rotation,
  }));

  // Far outside any slab
  const offMap = validatePlatformPlacement(-45, -45, existing);
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
