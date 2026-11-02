import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";

import { summarizeReadings } from "../src/lib/report-summary";

test("summarizes finite readings", () => {
  deepStrictEqual(summarizeReadings([10, 20, 30]), {
    count: 3,
    min: 10,
    max: 30,
    average: 20,
  });
});

test("includes zeros and negative readings", () => {
  deepStrictEqual(summarizeReadings([-10, 0, 10]), {
    count: 3,
    min: -10,
    max: 10,
    average: 0,
  });
});

test("skips missing, non-numeric and non-finite values", () => {
  deepStrictEqual(
    summarizeReadings([null, undefined, "20", NaN, Infinity, -Infinity, 10, 30]),
    { count: 2, min: 10, max: 30, average: 20 },
  );
});

test("returns null when no valid readings exist", () => {
  equal(summarizeReadings([null, NaN, "10"]), null);
});

test("summarizes one reading", () => {
  deepStrictEqual(summarizeReadings([7]), {
    count: 1,
    min: 7,
    max: 7,
    average: 7,
  });
});

test("returns null for an empty list", () => {
  equal(summarizeReadings([]), null);
});

test("returns null for non-array input", () => {
  equal(summarizeReadings(null), null);
  equal(summarizeReadings({}), null);
});

test("avoids overflow for large opposite values", () => {
  deepStrictEqual(summarizeReadings([Number.MAX_VALUE, -Number.MAX_VALUE]), {
    count: 2,
    min: -Number.MAX_VALUE,
    max: Number.MAX_VALUE,
    average: 0,
  });
});

test("keeps small equal values", () => {
  equal(
    summarizeReadings([Number.MIN_VALUE, Number.MIN_VALUE])?.average,
    Number.MIN_VALUE,
  );
});

test("does not change the input array", () => {
  const values = [30, 10, 20];

  summarizeReadings(values);

  deepStrictEqual(values, [30, 10, 20]);
});