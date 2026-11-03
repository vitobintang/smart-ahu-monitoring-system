import { test } from "node:test";
import { strict as assert } from "node:assert";
import { PGlite } from "@electric-sql/pglite";
import { createRateTransaction, type RatePool } from "../src/db/login-rate-transaction";
import { checkGatewayLoginAttempt, type LoginGatewayGuardOptions } from "../src/lib/login-gateway-guard";

const origin = "https://ahu.example.invalid";
// Fixed values are deliberately test-only; production secrets must be random.
const proof = "ab".repeat(32);
const rateSecret = new Uint8Array(32).fill(7);
function headers(values: Record<string, string> = {}) {
  return new Headers({ origin, "x-ahu-gateway-proof": proof, "x-ahu-client-ip": "192.0.2.1", ...values });
}

test("invalid configuration, origin and gateway input fail without accessing rate storage", async () => {
  let transactions = 0;
  const transaction: LoginGatewayGuardOptions["transaction"] = async () => { transactions++; throw new Error("must not run"); };
  const base: LoginGatewayGuardOptions = { headers: headers(), publicOrigin: origin, gatewayProof: proof, rateKeySecret: rateSecret, transaction };
  for (const change of [
    { publicOrigin: "http://ahu.example.invalid" },
    { publicOrigin: "https://ahu.example.invalid/path" },
    { gatewayProof: "short" },
    { rateKeySecret: new Uint8Array(31) },
    { headers: headers({ origin: "https://evil.example.invalid" }) },
    { headers: headers({ "x-ahu-gateway-proof": "cd".repeat(32) }) },
    { headers: headers({ "x-ahu-gateway-proof": `${proof}, ${proof}` }) },
    { headers: headers({ "x-ahu-client-ip": "192.0.2.1, 192.0.2.2" }) },
    { headers: headers({ "x-ahu-client-ip": "[::1]" }) },
  ]) {
    const result = await checkGatewayLoginAttempt({ ...base, ...change });
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes(proof), false);
    assert.equal(JSON.stringify(result).includes("192.0.2"), false);
  }
  const missing = new Headers({ origin, "x-ahu-gateway-proof": proof });
  assert.deepEqual(await checkGatewayLoginAttempt({ ...base, headers: missing }), { ok: false, status: 503 });
  assert.equal(transactions, 0);
});

test("missing origin or invalid gateway proof returns generic forbidden", async () => {
  let transactions = 0;
  const transaction: LoginGatewayGuardOptions["transaction"] = async () => { transactions++; throw new Error("no"); };
  const base: LoginGatewayGuardOptions = { headers: new Headers(), publicOrigin: origin, gatewayProof: proof, rateKeySecret: rateSecret, transaction };
  assert.deepEqual(await checkGatewayLoginAttempt(base), { ok: false, status: 403 });
  assert.deepEqual(await checkGatewayLoginAttempt({ ...base, headers: headers({ "x-ahu-gateway-proof": "cd".repeat(32) }) }), { ok: false, status: 403 });
  assert.equal(transactions, 0);
});

test("storage failure fails closed and does not expose details", async () => {
  const transaction: LoginGatewayGuardOptions["transaction"] = async () => { throw new Error("private storage error"); };
  const result = await checkGatewayLoginAttempt({ headers: headers(), publicOrigin: origin, gatewayProof: proof, rateKeySecret: rateSecret, transaction });
  assert.deepEqual(result, { ok: false, status: 503 });
});

test("guard and limiter compose in a temporary local database", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA ahu_private; CREATE TABLE ahu_private.login_rate_windows (bucket_key text PRIMARY KEY, attempt_times_ms jsonb NOT NULL, last_checked_ms bigint NOT NULL);`);
    // One local engine: this does not validate concurrent real PostgreSQL clients.
    const pool: RatePool = { async connect() { return { async query(text, values) { const result = await db.query(text, values ?? []); return { rows: result.rows }; }, release() {} }; } };
    const base = { headers: headers(), publicOrigin: origin, gatewayProof: proof, rateKeySecret: rateSecret, transaction: createRateTransaction(pool) };
    for (let i = 0; i < 10; i++) assert.deepEqual(await checkGatewayLoginAttempt(base), { ok: true });
    const blocked = await checkGatewayLoginAttempt({ ...base, headers: headers({ "x-ahu-client-ip": "::ffff:192.0.2.1" }) });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) { assert.equal(blocked.status, 429); assert.ok((blocked.retryAfterSeconds ?? 0) > 0); }
    const different = await checkGatewayLoginAttempt({ ...base, headers: headers({ "x-ahu-client-ip": "192.0.2.2" }) });
    assert.deepEqual(different, { ok: true });
    const stored = await db.query<{ bucket_key: string }>("SELECT bucket_key FROM ahu_private.login_rate_windows");
    assert.equal(stored.rows.length, 2);
    assert.ok(stored.rows.every(row => /^[a-f0-9]{64}$/.test(row.bucket_key)));
  } finally { await db.close(); }
});