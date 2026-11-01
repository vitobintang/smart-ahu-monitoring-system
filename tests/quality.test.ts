import { test } from "node:test";
import { equal } from "node:assert/strict";

import { classifyReadingQuality } from "../src/lib/quality";

const physicalReading = {
  installed: true,
  stale: false,
  value: 24,
  isFallback: false,
  source: "PHYSICAL" as const,
};

test("an uninstalled sensor is labelled uninstalled", () => {
  equal(
    classifyReadingQuality({ ...physicalReading, installed: false }),
    "UNINSTALLED",
  );
});

test("a stale reading is labelled stale", () => {
  equal(classifyReadingQuality({ ...physicalReading, stale: true }), "STALE");
});

test("missing or invalid values are unavailable", () => {
  equal(
    classifyReadingQuality({ ...physicalReading, value: null }),
    "NULL_UNAVAILABLE",
  );
  equal(
    classifyReadingQuality({ ...physicalReading, value: NaN }),
    "NULL_UNAVAILABLE",
  );
  equal(
    classifyReadingQuality({ ...physicalReading, value: Infinity }),
    "NULL_UNAVAILABLE",
  );
});

test("a fallback value is labelled estimated", () => {
  equal(
    classifyReadingQuality({ ...physicalReading, isFallback: true }),
    "ESTIMATED_FALLBACK",
  );
});

test("a simulated reading is labelled simulated", () => {
  equal(
    classifyReadingQuality({ ...physicalReading, source: "SIMULATION" }),
    "SIMULATED",
  );
});

test("a valid physical reading is labelled OK", () => {
  equal(classifyReadingQuality(physicalReading), "OK");
});

test("an unknown source is not labelled as physical", () => {
  equal(
    classifyReadingQuality({ ...physicalReading, source: null }),
    "SOURCE_UNKNOWN",
  );
});