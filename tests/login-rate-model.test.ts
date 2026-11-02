import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";

import {
  evaluateLoginAttempt,
  LOGIN_WINDOW_MS,
  type LoginRateBucket,
} from "../src/lib/login-rate-model";

test("allows ten attempts and blocks the eleventh", () => {
  let bucket: LoginRateBucket | null = null;

  for (let i = 0; i < 10; i++) {
    const result = evaluateLoginAttempt(1000, bucket);
    if (result.ok === false) throw new Error("Expected valid bucket");

    equal(result.allowed, true);
    equal(result.bucket.attemptTimesMs.length, i + 1);
    bucket = result.bucket;
  }

  const blocked = evaluateLoginAttempt(2000, bucket);
  if (blocked.ok === false) throw new Error("Expected valid bucket");

  equal(blocked.allowed, false);
  equal(blocked.retryAfterMs, LOGIN_WINDOW_MS - 1000);
});

test("expires attempts individually in a rolling window", () => {
  const bucket = {
    attemptTimesMs: [
      1000, 2000, 3000, 4000, 5000,
      6000, 7000, 8000, 9000, 10000,
    ],
    lastCheckedAtMs: 10000,
  };

  const before = evaluateLoginAttempt(1000 + LOGIN_WINDOW_MS - 1, bucket);
  if (before.ok === false) throw new Error("Expected valid bucket");
  equal(before.allowed, false);
  equal(before.retryAfterMs, 1);

  const boundary = evaluateLoginAttempt(
    1000 + LOGIN_WINDOW_MS,
    before.bucket,
  );
  if (boundary.ok === false) throw new Error("Expected valid bucket");
  equal(boundary.allowed, true);
  equal(boundary.bucket.attemptTimesMs.length, 10);
  equal(boundary.bucket.attemptTimesMs[0], 2000);

  const blocked = evaluateLoginAttempt(
    1000 + LOGIN_WINDOW_MS,
    boundary.bucket,
  );
  if (blocked.ok === false) throw new Error("Expected valid bucket");
  equal(blocked.allowed, false);
  equal(blocked.retryAfterMs, 1000);
});

test("blocked attempts do not extend the window", () => {
  const bucket = {
    attemptTimesMs: Array(10).fill(1000) as number[],
    lastCheckedAtMs: 1000,
  };

  const blocked = evaluateLoginAttempt(3000, bucket);
  if (blocked.ok === false) throw new Error("Expected valid bucket");

  equal(blocked.allowed, false);
  equal(blocked.retryAfterMs, LOGIN_WINDOW_MS - 2000);
  equal(blocked.bucket.attemptTimesMs.length, 10);
});

test("rejects invalid times and backward clocks", () => {
  equal(evaluateLoginAttempt(NaN, null).ok, false);
  equal(evaluateLoginAttempt(-1, null).ok, false);
  equal(evaluateLoginAttempt(1000.5, null).ok, false);
  equal(
    evaluateLoginAttempt(999, {
      attemptTimesMs: [1000],
      lastCheckedAtMs: 1000,
    }).ok,
    false,
  );
});

test("rejects invalid stored state instead of resetting it", () => {
  const invalid = [
    {
      attemptTimesMs: Array(11).fill(1000) as number[],
      lastCheckedAtMs: 1000,
    },
    { attemptTimesMs: [2000, 1000], lastCheckedAtMs: 2000 },
    { attemptTimesMs: [2001], lastCheckedAtMs: 2000 },
    { attemptTimesMs: [NaN], lastCheckedAtMs: 2000 },
  ];

  for (const previous of invalid) {
    equal(evaluateLoginAttempt(2000, previous).ok, false);
  }
});

test("different supplied buckets remain independent", () => {
  const full = {
    attemptTimesMs: Array(10).fill(1000) as number[],
    lastCheckedAtMs: 1000,
  };

  const a = evaluateLoginAttempt(2000, full);
  const b = evaluateLoginAttempt(2000, null);
  if (a.ok === false || b.ok === false) {
    throw new Error("Expected valid buckets");
  }

  equal(a.allowed, false);
  equal(b.allowed, true);
});

test("does not mutate the previous bucket", () => {
  const previous = { attemptTimesMs: [1000], lastCheckedAtMs: 1000 };

  evaluateLoginAttempt(2000, previous);

  deepStrictEqual(previous, {
    attemptTimesMs: [1000],
    lastCheckedAtMs: 1000,
  });
});