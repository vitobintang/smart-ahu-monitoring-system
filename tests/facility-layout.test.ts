import { test } from "node:test";
import { equal, ok } from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  computeExteriorWallSegments,
  DEFAULT_AHU_PLACEMENTS,
  FACILITY_ZONES,
  isFootprintOnPlatform,
  MIN_AHU_SPACING,
  resolveAhuPlacement,
  suggestCleanPlatformSlot,
  validatePlatformPlacement,
} from "../src/lib/facility-layout";
import { commandFeedbackMatches, computeAhuStatus } from "../src/lib/domain";
import AhuSchematic from "../src/components/AhuSchematic";

test("facility room is non-rectangular multi-branch with 5 indoor AHUs and 2 outdoor AHUs", () => {
  const walls = computeExteriorWallSegments();
  // A plain rectangle has only 4 wall segments; a multi-branch complex has >= 12 outer segments
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
    const fp = isFootprintOnPlatform(p.x, p.z);
    equal(fp.ok, true, `${p.id} at (${p.x}, ${p.z}) must sit cleanly on a floor platform`);
  }
});

test("floor platform placement rejects off-platform and overlapping positions and suggests clean slots", () => {
  const existing = Object.entries(DEFAULT_AHU_PLACEMENTS).map(([id, pos]) => ({
    id,
    x: pos.x,
    z: pos.z,
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
  const checkIn = validatePlatformPlacement(cleanIndoor.x, cleanIndoor.z, existing);
  equal(checkIn.valid, true);
  for (const u of existing) {
    ok(Math.hypot(u.x - cleanIndoor.x, u.z - cleanIndoor.z) >= MIN_AHU_SPACING);
  }

  const cleanOutdoor = suggestCleanPlatformSlot(existing, false);
  equal(cleanOutdoor.indoor, false);
  const checkOut = validatePlatformPlacement(cleanOutdoor.x, cleanOutdoor.z, existing);
  equal(checkOut.valid, true);
  ok(FACILITY_ZONES.some((z) => !z.indoor && z.id === cleanOutdoor.zone.id));
});

test("STOP coast-down and settled 0% fan feedback keep unit online in STOP so START is immediately allowed", () => {
  const now = new Date("2026-11-05T07:00:00.000Z");

  // Coasting tick: impeller still spinning -> runState RUN + fanSpeed 14 -> status RUN (never false OFFLINE)
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

  // Settled STOP tick: fanSpeed locked at 0 + runState STOP -> confirms STOP and keeps unit in STOP (not OFFLINE)
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

  // Subsequent START tick: immediate spin-up above 0% + runState RUN -> confirms START and returns to RUN
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

  // 18+14 = 32 -> 8*32 = 256; 9+11 = 20 -> 8*20 = 160; 14+10 = 24 -> 8*24 = 192
  ok(html.includes("--flow-offset:-256"));
  ok(html.includes("--flow-offset:-160"));
  ok(html.includes("--flow-offset:-192"));
});
