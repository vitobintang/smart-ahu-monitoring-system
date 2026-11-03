import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  makeLoginRateKey,
  normalizeLoginIp,
} from "../src/lib/login-rate-key";

// Dummy deterministic bytes for tests only.
// Production requires a securely generated random secret.
const secret = new Uint8Array(32).fill(7);

test("normalizes IPv6 and mapped IPv4 without accepting ports or zones", () => {
  assert.equal(
    normalizeLoginIp(
      "2001:0DB8:0000:0000:0000:0000:0000:0001",
    ),
    "2001:db8::1",
  );

  assert.equal(
    normalizeLoginIp("::ffff:c000:201"),
    "192.0.2.1",
  );

  assert.equal(
    normalizeLoginIp("::ffff:192.0.2.1"),
    "192.0.2.1",
  );

  for (const invalid of [
    "",
    " 192.0.2.1",
    "192.0.2.1:123",
    "[::1]",
    "fe80::1%eth0",
    "127.1",
    "192.168.001.1",
    "::1,::2",
  ]) {
    assert.throws(() => normalizeLoginIp(invalid));
  }
});

test("equivalent IP representations produce one deterministic private bucket", () => {
  const key = makeLoginRateKey("192.0.2.1", secret);

  assert.match(key, /^[a-f0-9]{64}$/);

  assert.equal(
    key,
    makeLoginRateKey("::ffff:192.0.2.1", secret),
  );

  assert.equal(
    key,
    makeLoginRateKey("::ffff:c000:201", secret),
  );

  assert.equal(
    makeLoginRateKey("2001:db8::1", secret),
    makeLoginRateKey(
      "2001:0db8:0:0:0:0:0:1",
      secret,
    ),
  );

  assert.notEqual(
    key,
    makeLoginRateKey("192.0.2.2", secret),
  );

  assert.notEqual(
    key,
    makeLoginRateKey(
      "192.0.2.1",
      new Uint8Array(32).fill(8),
    ),
  );

  assert.ok(!key.includes("192.0.2.1"));
});

test("rejects invalid addresses and secrets without echoing their contents", () => {
  assert.throws(
    () => makeLoginRateKey("private-invalid-input", secret),
    { message: "Invalid IP address" },
  );

  assert.throws(
    () =>
      makeLoginRateKey(
        "127.0.0.1",
        new Uint8Array(31),
      ),
    { message: "Invalid rate key secret" },
  );

  assert.throws(
    () =>
      makeLoginRateKey(
        "127.0.0.1",
        new Uint8Array(33),
      ),
    { message: "Invalid rate key secret" },
  );
});