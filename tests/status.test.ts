import { test } from "node:test";
import { equal } from "node:assert/strict";

import { calculateAhuStatus } from "../src/lib/status";

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