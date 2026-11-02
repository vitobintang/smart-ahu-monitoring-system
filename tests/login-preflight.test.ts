import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";

import { checkLoginPreflight } from "../src/lib/login-preflight";
import {
  evaluateLoginAttempt,
  type LoginRateBucket,
} from "../src/lib/login-rate-model";

const origin = "https://ahu.example";
const allowed = async () => ({ allowed: true, retryAfterMs: 0 });

test("allows same-origin requests when the attempt is allowed", async () => {
  deepStrictEqual(await checkLoginPreflight(origin, origin, allowed), {
    ok: true,
  });
});

test("rejects a different origin without consuming an attempt", async () => {
  let calls = 0;

  const result = await checkLoginPreflight(
    "https://other.example",
    origin,
    async () => {
      calls++;
      return { allowed: true, retryAfterMs: 0 };
    },
  );

  deepStrictEqual(result, { ok: false, status: 403 });
  equal(calls, 0);
});

test("rejects a missing origin", async () => {
  deepStrictEqual(await checkLoginPreflight(null, origin, allowed), {
    ok: false,
    status: 403,
  });
});

test("returns a rounded-up retry time when limited", async () => {
  const result = await checkLoginPreflight(origin, origin, async () => ({
    allowed: false,
    retryAfterMs: 1001,
  }));

  deepStrictEqual(result, {
    ok: false,
    status: 429,
    retryAfterSeconds: 2,
  });
});

test("unavailable rate storage fails closed", async () => {
  const result = await checkLoginPreflight(origin, origin, async () => {
    throw new Error("database details");
  });

  deepStrictEqual(result, { ok: false, status: 503 });
});

test("invalid rate decisions fail closed", async () => {
  const invalid = [
    null,
    [],
    { allowed: true, retryAfterMs: 1 },
    { allowed: false, retryAfterMs: 0 },
    { allowed: true, retryAfterMs: NaN },
    { allowed: "yes", retryAfterMs: 0 },
  ];

  for (const decision of invalid) {
    deepStrictEqual(
      await checkLoginPreflight(origin, origin, async () => decision),
      { ok: false, status: 503 },
    );
  }
});

test("does not expose a storage error", async () => {
  const result = await checkLoginPreflight(origin, origin, async () => {
    throw new Error("sensitive details");
  });

  equal(JSON.stringify(result).includes("sensitive"), false);
});

test("works with the local rolling-window model", async () => {
  let bucket: LoginRateBucket | null = null;

  const consume = async () => {
    const result = evaluateLoginAttempt(1000, bucket);

    if (result.ok === false) {
      throw new Error("Invalid bucket");
    }

    bucket = result.bucket;

    return {
      allowed: result.allowed,
      retryAfterMs: result.retryAfterMs,
    };
  };

  for (let i = 0; i < 10; i++) {
    deepStrictEqual(await checkLoginPreflight(origin, origin, consume), {
      ok: true,
    });
  }

  deepStrictEqual(await checkLoginPreflight(origin, origin, consume), {
    ok: false,
    status: 429,
    retryAfterSeconds: 900,
  });
});