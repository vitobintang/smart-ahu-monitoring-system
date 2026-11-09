import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";

import { validateReferenceTelemetry } from "../src/lib/telemetry-reference";

const referenceMessage = {
  messageId: "message-001",
  ahuId: "GTM-DAIKIN-001",
  timestamp: "2026-11-01T12:00:00.000Z",
  parameters: { roomTemp: 24.5, humidity: null },
};

test("maps the supported reference-shaped subset to the local format", () => {
  deepStrictEqual(validateReferenceTelemetry(referenceMessage), {
    ok: true,
    value: {
      messageId: "message-001",
      ahuId: "GTM-DAIKIN-001",
      measuredAt: "2026-11-01T12:00:00.000Z",
      readings: { roomTemp: 24.5, humidity: null },
    },
  });
});

test("does not silently discard additional reference fields", () => {
  for (const extra of [
    { runState: "RUN" },
    { faultCode: null },
    { quality: { current: "measured" } },
    { controlMode: "AUTO" },
    { setpoint: 22 },
  ]) {
    equal(
      validateReferenceTelemetry({ ...referenceMessage, ...extra }).ok,
      false,
    );
  }
});

test("requires a message ID and an explicit AHU ID", () => {
  const { messageId: _messageId, ...withoutMessageId } = referenceMessage;
  const { ahuId: _ahuId, ...withoutAhuId } = referenceMessage;

  equal(validateReferenceTelemetry(withoutMessageId).ok, false);
  equal(validateReferenceTelemetry(withoutAhuId).ok, false);
});

test("requires the local UTC timestamp format", () => {
  equal(
    validateReferenceTelemetry({
      ...referenceMessage,
      timestamp: "2026-11-01T12:00:00Z",
    }).ok,
    false,
  );
});

test("rejects invalid or unknown sensor readings", () => {
  equal(
    validateReferenceTelemetry({
      ...referenceMessage,
      parameters: { roomTemp: "24" },
    }).ok,
    false,
  );
  equal(
    validateReferenceTelemetry({
      ...referenceMessage,
      parameters: { unknownSensor: 1 },
    }).ok,
    false,
  );
  equal(
    validateReferenceTelemetry({ ...referenceMessage, parameters: {} }).ok,
    false,
  );
});

test("rejects mixed field formats instead of ignoring them", () => {
  equal(
    validateReferenceTelemetry({
      ...referenceMessage,
      measuredAt: referenceMessage.timestamp,
    }).ok,
    false,
  );
});

test("rejects non-object input", () => {
  equal(validateReferenceTelemetry(null).ok, false);
  equal(validateReferenceTelemetry([]).ok, false);
});