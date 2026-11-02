import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";

import { calculateAhuStatus, getStatusDetails } from "../src/lib/status";

const fresh = {
  lastReceivedAtMs: 1000,
  nowMs: 1500,
  timeoutMs: 1000,
  fault: false,
  running: true,
};

test("a unit with no received telemetry is offline", () => {
  equal(calculateAhuStatus({ ...fresh, lastReceivedAtMs: null }), "OFFLINE");
});

test("fresh feedback distinguishes running and stopped", () => {
  equal(calculateAhuStatus(fresh), "RUN");
  equal(calculateAhuStatus({ ...fresh, running: false }), "STOP");
});

test("a fresh fault takes priority over running feedback", () => {
  equal(calculateAhuStatus({ ...fresh, fault: true }), "FAULT");
  equal(calculateAhuStatus({ ...fresh, fault: true, running: false }), "FAULT");
});

test("the unit is offline at the timeout, even if it last reported a fault", () => {
  equal(
    calculateAhuStatus({ ...fresh, nowMs: 2000, fault: true }),
    "OFFLINE",
  );
});

test("missing feedback is not guessed", () => {
  equal(calculateAhuStatus({ ...fresh, fault: null }), null);
  equal(calculateAhuStatus({ ...fresh, running: null }), null);
  equal(calculateAhuStatus({ ...fresh, fault: true, running: null }), "FAULT");
});

test("invalid times and timeouts produce an unavailable status", () => {
  equal(calculateAhuStatus({ ...fresh, timeoutMs: 0 }), null);
  equal(calculateAhuStatus({ ...fresh, nowMs: NaN }), null);
  equal(calculateAhuStatus({ ...fresh, lastReceivedAtMs: NaN }), null);
  equal(calculateAhuStatus({ ...fresh, lastReceivedAtMs: 2000 }), null);
});

test("a fresh fault flag is attributed to its receipt time", () => {
  deepStrictEqual(getStatusDetails({ ...fresh, fault: true }), {
    status: "FAULT",
    communication: "FRESH",
    lastFaultFlag: "FAULT_REPORTED",
    faultFlagReceivedAtMs: 1000,
  });
});

test("stale communication does not erase the last reported fault flag", () => {
  deepStrictEqual(
    getStatusDetails({ ...fresh, nowMs: 2000, fault: true }),
    {
      status: "OFFLINE",
      communication: "STALE",
      lastFaultFlag: "FAULT_REPORTED",
      faultFlagReceivedAtMs: 1000,
    },
  );
});

test("an old false flag is described as a report, not a current guarantee", () => {
  deepStrictEqual(getStatusDetails({ ...fresh, nowMs: 2000 }), {
    status: "OFFLINE",
    communication: "STALE",
    lastFaultFlag: "NO_FAULT_REPORTED",
    faultFlagReceivedAtMs: 1000,
  });
});

test("without telemetry, no fault flag is attributed", () => {
  deepStrictEqual(
    getStatusDetails({ ...fresh, lastReceivedAtMs: null, fault: true }),
    {
      status: "OFFLINE",
      communication: "NO_TELEMETRY",
      lastFaultFlag: "UNKNOWN",
      faultFlagReceivedAtMs: null,
    },
  );
});

test("missing fault feedback is unknown", () => {
  const details = getStatusDetails({ ...fresh, fault: null });

  equal(details.status, null);
  equal(details.communication, "FRESH");
  equal(details.lastFaultFlag, "UNKNOWN");
  equal(details.faultFlagReceivedAtMs, null);
});

test("invalid or future times do not attribute fault feedback", () => {
  const invalidInputs = [
    { nowMs: NaN },
    { timeoutMs: 0 },
    { lastReceivedAtMs: NaN },
    { lastReceivedAtMs: 2000 },
  ];

  for (const invalid of invalidInputs) {
    deepStrictEqual(getStatusDetails({ ...fresh, ...invalid, fault: true }), {
      status: null,
      communication: "UNKNOWN",
      lastFaultFlag: "UNKNOWN",
      faultFlagReceivedAtMs: null,
    });
  }
});

test("communication becomes stale exactly at the timeout", () => {
  equal(getStatusDetails({ ...fresh, nowMs: 1999 }).communication, "FRESH");
  equal(getStatusDetails({ ...fresh, nowMs: 2000 }).communication, "STALE");
});