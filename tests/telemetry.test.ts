import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";

import { AHU_IDS } from "../src/lib/ahu";
import { validateTelemetry } from "../src/lib/telemetry";

const validMessage = {
  messageId: "message-001",
  ahuId: "GTM-DAIKIN-001",
  measuredAt: "2026-11-01T12:00:00.000Z",
  readings: {
    roomTemp: 24.5,
    humidity: null,
  },
};

test("accepts a valid telemetry message", () => {
  deepStrictEqual(validateTelemetry(validMessage), {
    ok: true,
    value: validMessage,
  });
});

test("accepts each defined AHU identifier", () => {
  for (const ahuId of AHU_IDS) {
    equal(validateTelemetry({ ...validMessage, ahuId }).ok, true);
  }
});

test("rejects an unknown AHU identifier", () => {
  equal(validateTelemetry({ ...validMessage, ahuId: "AHU-99" }).ok, false);
});

test("rejects invalid message identifiers", () => {
  equal(validateTelemetry({ ...validMessage, messageId: "" }).ok, false);
  equal(validateTelemetry({ ...validMessage, messageId: "a".repeat(65) }).ok, false);
  equal(validateTelemetry({ ...validMessage, messageId: "has spaces" }).ok, false);
});

test("rejects invalid timestamp formats and dates", () => {
  equal(validateTelemetry({ ...validMessage, measuredAt: "yesterday" }).ok, false);
  equal(
    validateTelemetry({
      ...validMessage,
      measuredAt: "2026-02-30T12:00:00.000Z",
    }).ok,
    false,
  );
});

test("rejects unknown sensor parameters", () => {
  equal(
    validateTelemetry({ ...validMessage, readings: { unknownSensor: 10 } }).ok,
    false,
  );
});

test("rejects readings that are not finite numbers or null", () => {
  equal(validateTelemetry({ ...validMessage, readings: { roomTemp: "24" } }).ok, false);
  equal(validateTelemetry({ ...validMessage, readings: { roomTemp: NaN } }).ok, false);
  equal(validateTelemetry({ ...validMessage, readings: { roomTemp: Infinity } }).ok, false);
});

test("rejects empty or invalid readings", () => {
  equal(validateTelemetry({ ...validMessage, readings: {} }).ok, false);
  equal(validateTelemetry({ ...validMessage, readings: null }).ok, false);
  equal(validateTelemetry({ ...validMessage, readings: [] }).ok, false);
});

test("rejects invalid messages and unexpected fields", () => {
  equal(validateTelemetry(null).ok, false);
  equal(validateTelemetry([]).ok, false);
  equal(validateTelemetry({}).ok, false);
  equal(validateTelemetry({ ...validMessage, extra: true }).ok, false);
});