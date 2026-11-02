import { test } from "node:test";
import { deepStrictEqual, equal, notStrictEqual } from "node:assert/strict";

import { AHU_IDS } from "../src/lib/ahu";
import { createSimulationSample } from "../src/lib/simulation";

const input = {
  ahuId: "AHU-01",
  messageId: "simulation-001",
  measuredAt: "2026-11-01T12:00:00.000Z",
};

test("creates an explicitly labelled synthetic sample", () => {
  deepStrictEqual(createSimulationSample(input), {
    ok: true,
    sample: {
      source: "SIMULATION",
      message: {
        ahuId: "AHU-01",
        messageId: "simulation-001",
        measuredAt: "2026-11-01T12:00:00.000Z",
        readings: { roomTemp: 22, humidity: 50 },
      },
    },
  });
});

test("can create a sample for each planned AHU", () => {
  for (const ahuId of AHU_IDS) {
    equal(createSimulationSample({ ...input, ahuId }).ok, true);
  }
});

test("rejects an unknown AHU", () => {
  equal(createSimulationSample({ ...input, ahuId: "AHU-99" }).ok, false);
});

test("rejects an invalid message ID", () => {
  equal(createSimulationSample({ ...input, messageId: "" }).ok, false);
});

test("rejects an invalid measurement time", () => {
  equal(createSimulationSample({ ...input, measuredAt: "yesterday" }).ok, false);
});

test("each sample has its own readings object", () => {
  const first = createSimulationSample(input);
  const second = createSimulationSample(input);

  if (!first.ok || !second.ok) {
    throw new Error("Expected valid simulated samples.");
  }

  notStrictEqual(first.sample.message.readings, second.sample.message.readings);
});