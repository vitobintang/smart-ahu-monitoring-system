import { test } from "node:test";
import assert from "node:assert/strict";
import { can, classifyQuality, computeAhuStatus, commandFeedbackMatches } from "../src/lib/domain";
import { randomHex, safeEqual } from "../src/lib/ids";

test("role permissions reject unknown-role control and only admins manage users", () => {
  assert.equal(can("Superuser", "control"), false);
  assert.equal(can("Engineering", "manageUsers"), false);
  assert.equal(can("Admin", "manageUsers"), true);
});

test("credential randomness and comparison", () => {
  const a = randomHex(32), b = randomHex(32);
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.notEqual(a, b);
  assert.equal(safeEqual(a, a), true);
  assert.equal(safeEqual(a, b), false);
});

test("missing heartbeat is offline even when run state was present", () => {
  const result = computeAhuStatus({ lastSeenAt: null, commTimeoutSec: 30, faultCode: null, hasCriticalAlarm: false, fanSpeed: 70, runState: "RUN" });
  assert.equal(result.status, "OFFLINE");
});

test("quality marks flagged current fallback", () => {
  assert.equal(classifyQuality({ param: "current", installed: ["current"], value: 1, fallbackFlag: true, stale: false, source: "PHYSICAL" }), "ESTIMATED_FALLBACK");
});

test("missing or contradictory running feedback does not produce a false stop", () => {
  const common = { lastSeenAt: new Date(), commTimeoutSec: 30, faultCode: null, hasCriticalAlarm: false };
  assert.equal(computeAhuStatus({ ...common, fanSpeed: null, runState: null }).status, "OFFLINE");
  assert.equal(computeAhuStatus({ ...common, fanSpeed: null, runState: "RUN" }).status, "RUN");
  assert.equal(computeAhuStatus({ ...common, fanSpeed: 1, runState: "STOP" }).status, "OFFLINE");
});

test("STOP is never confirmed by missing or contradictory feedback", () => {
  const echo = { setpoint: null, controlMode: null };
  assert.equal(commandFeedbackMatches("STOP", { runState: null, fanSpeed: null }, echo), false);
  assert.equal(commandFeedbackMatches("STOP", { runState: "RUN", fanSpeed: 0 }, echo), false);
  assert.equal(commandFeedbackMatches("STOP", { runState: "STOP", fanSpeed: 10 }, echo), false);
  assert.equal(commandFeedbackMatches("STOP", { runState: "STOP", fanSpeed: 0 }, echo), true);
});