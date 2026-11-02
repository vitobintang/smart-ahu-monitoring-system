import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";

import {
  classifyThreshold,
  type ThresholdInput,
} from "../src/lib/threshold-observation";

const sample = { value: 20, lower: 10, upper: 30, fresh: true };

test("values inside and exactly at limits are normal", () => {
  for (const value of [10, 20, 30]) {
    deepStrictEqual(classifyThreshold({ ...sample, value }), {
      ok: true,
      observation: "NORMAL",
    });
  }
});

test("values below the lower limit are low", () => {
  deepStrictEqual(classifyThreshold({ ...sample, value: 9 }), {
    ok: true,
    observation: "LOW",
  });
});

test("values above the upper limit are high", () => {
  deepStrictEqual(classifyThreshold({ ...sample, value: 31 }), {
    ok: true,
    observation: "HIGH",
  });
});

test("supports either one-sided limit", () => {
  deepStrictEqual(classifyThreshold({ ...sample, lower: null, value: 31 }), {
    ok: true,
    observation: "HIGH",
  });
  deepStrictEqual(classifyThreshold({ ...sample, upper: null, value: 9 }), {
    ok: true,
    observation: "LOW",
  });
});

test("unavailable measurements are unknown", () => {
  deepStrictEqual(classifyThreshold({ ...sample, value: null }), {
    ok: true,
    observation: "UNKNOWN",
  });
});

test("stale observations are unknown, even outside limits", () => {
  deepStrictEqual(classifyThreshold({ ...sample, value: 31, fresh: false }), {
    ok: true,
    observation: "UNKNOWN",
  });
});

test("non-finite measurements are unknown", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    deepStrictEqual(classifyThreshold({ ...sample, value }), {
      ok: true,
      observation: "UNKNOWN",
    });
  }
});

test("invalid or missing limits are rejected", () => {
  const invalid = [
    { lower: null, upper: null },
    { lower: 30, upper: 10 },
    { lower: 10, upper: 10 },
    { lower: NaN, upper: 30 },
    { lower: 10, upper: Infinity },
  ];

  for (const limits of invalid) {
    equal(classifyThreshold({ ...sample, ...limits }).ok, false);
  }
});

test("malformed observations are rejected", () => {
  equal(
    classifyThreshold({ ...sample, fresh: "true" } as unknown as ThresholdInput).ok,
    false,
  );
  equal(
    classifyThreshold({ ...sample, value: "20" } as unknown as ThresholdInput).ok,
    false,
  );
  equal(classifyThreshold(null as unknown as ThresholdInput).ok, false);
});