import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";

import { parseHistoricalObservations } from "../src/lib/historical-observations-client";

const row = {
  ahuId: "AHU-01",
  configuredSource: "PHYSICAL",
  observedSource: "PHYSICAL",
  measuredAt: "2026-01-01T10:00:00.000Z",
  timestampStatus: "past_or_present",
  roomTemp: { configured: true, value: 20 },
  humidity: { configured: true, value: 45 },
};

test("accepts historical readings and retains the reported source and time", () => {
  deepStrictEqual(
    parseHistoricalObservations({ observations: [row] }),
    [row],
  );
});

test("accepts no source and no observation", () => {
  const empty = {
    ...row,
    configuredSource: null,
    observedSource: null,
    measuredAt: null,
    timestampStatus: "unknown",
    roomTemp: { configured: false, value: null },
    humidity: { configured: true, value: null },
  };

  deepStrictEqual(
    parseHistoricalObservations({ observations: [empty] }),
    [empty],
  );
});

test("accepts an empty list", () => {
  deepStrictEqual(parseHistoricalObservations({ observations: [] }), []);
});

test("rejects unknown or duplicate unit IDs", () => {
  equal(
    parseHistoricalObservations({
      observations: [{ ...row, ahuId: "OTHER" }],
    }),
    null,
  );

  equal(
    parseHistoricalObservations({ observations: [row, row] }),
    null,
  );
});

test("rejects mismatched sources and missing observation values", () => {
  equal(
    parseHistoricalObservations({
      observations: [{ ...row, observedSource: "SIMULATION" }],
    }),
    null,
  );

  equal(
    parseHistoricalObservations({
      observations: [
        {
          ...row,
          observedSource: null,
          measuredAt: null,
          timestampStatus: "unknown",
        },
      ],
    }),
    null,
  );
});

test("rejects values attached to a future timestamp", () => {
  equal(
    parseHistoricalObservations({
      observations: [{ ...row, timestampStatus: "future" }],
    }),
    null,
  );
});

test("accepts future timestamps only when readings are withheld", () => {
  const future = {
    ...row,
    timestampStatus: "future",
    roomTemp: { configured: true, value: null },
    humidity: { configured: true, value: null },
  };

  deepStrictEqual(
    parseHistoricalObservations({ observations: [future] }),
    [future],
  );
});

test("rejects unconfigured and non-finite readings", () => {
  equal(
    parseHistoricalObservations({
      observations: [
        { ...row, roomTemp: { configured: false, value: 20 } },
      ],
    }),
    null,
  );

  equal(
    parseHistoricalObservations({
      observations: [
        { ...row, humidity: { configured: true, value: Infinity } },
      ],
    }),
    null,
  );
});

test("rejects invalid response shapes and timestamps", () => {
  equal(parseHistoricalObservations({}), null);

  equal(
    parseHistoricalObservations({
      observations: [{ ...row, measuredAt: "invalid" }],
    }),
    null,
  );

  equal(
    parseHistoricalObservations({
      observations: [{ ...row, timestampStatus: "unknown" }],
    }),
    null,
  );
});