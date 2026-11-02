import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";

import { parseMonitoringResponse } from "../src/lib/monitoring-client";

const unit = { id: "AHU-01", name: "Unit 1", location: "Example" };

test("accepts known units and keeps only the expected fields", () => {
  deepStrictEqual(
    parseMonitoringResponse({ units: [{ ...unit, extra: "ignored" }] }),
    [unit],
  );
});

test("accepts an empty list", () => {
  deepStrictEqual(parseMonitoringResponse({ units: [] }), []);
});

test("rejects malformed response shapes", () => {
  for (const input of [null, [], {}, { units: null }, { units: "invalid" }]) {
    equal(parseMonitoringResponse(input), null);
  }
});

test("rejects unknown AHU identifiers", () => {
  equal(parseMonitoringResponse({ units: [{ ...unit, id: "AHU-99" }] }), null);
});

test("rejects duplicate AHU identifiers", () => {
  equal(parseMonitoringResponse({ units: [unit, unit] }), null);
});

test("rejects more than seven units", () => {
  equal(parseMonitoringResponse({ units: Array(8).fill(unit) }), null);
});

test("rejects non-string metadata", () => {
  equal(parseMonitoringResponse({ units: [{ ...unit, name: null }] }), null);
  equal(parseMonitoringResponse({ units: [{ ...unit, location: 5 }] }), null);
});