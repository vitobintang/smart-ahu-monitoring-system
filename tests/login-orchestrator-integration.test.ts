import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createRateTransaction, type RatePool } from "../src/db/login-rate-transaction";
import { isBrowserAuthorized } from "../src/lib/device-verification";
import { hashDeviceToken } from "../src/lib/device-tokens";
import { checkGatewayLoginAttempt } from "../src/lib/login-gateway-guard";
import { evaluatePasswordLogin, type LoginDependencies } from "../src/lib/login-orchestrator";

// Test-only values. The gateway and Auth service are not real in this test.
const origin = "https://ahu.example.invalid";
const proof = "ab".repeat(32);
const browser = "cd".repeat(32);
function request(): Request {
  return new Request(origin + "/login", { method: "POST", headers: {
    origin, "content-type": "application/json", "x-ahu-gateway-proof": proof, "x-ahu-client-ip": "192.0.2.1",
  }, body: JSON.stringify({ email: "user@example.invalid", password: "test-password" }) });
}

test("guard, rolling limiter, role and browser verification compose locally", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA ahu_private;
      CREATE TABLE ahu_private.login_rate_windows (bucket_key text PRIMARY KEY, attempt_times_ms jsonb NOT NULL, last_checked_ms bigint NOT NULL);
      CREATE TABLE ahu_private.users (id text PRIMARY KEY, role text NOT NULL);
      CREATE TABLE ahu_private.access_devices (id text PRIMARY KEY, user_id text, device_hash text, claimed_at timestamptz, revoked_at timestamptz, expires_at timestamptz);
      INSERT INTO ahu_private.users VALUES ('user-1', 'Viewer'), ('user-2', 'Viewer');`);
    await db.query("INSERT INTO ahu_private.access_devices VALUES ('browser-1', 'user-1', $1, now(), NULL, now() + interval '1 hour')", [hashDeviceToken(browser, "browser")]);
    const pool: RatePool = { async connect() { return { async query(text, values) {
      const result = await db.query(text, values ?? []); return { rows: result.rows };
    }, release() {} }; } };
    const transaction = createRateTransaction(pool);
    let staged = 0;
    let discarded = 0;
    let userId = "user-1";
    function deps(req: Request): LoginDependencies<string> {
      return {
        checkGateway: () => checkGatewayLoginAttempt({ headers: req.headers, publicOrigin: origin, gatewayProof: proof, rateKeySecret: new Uint8Array(32).fill(7), transaction }),
        async stagePassword() { staged++; return { verifiedUserId: userId, takeSession: () => "test-session", async discard() { discarded++; } }; },
        async getProfile(id) { const result = await db.query<{ id: string; role: string }>("SELECT id, role FROM ahu_private.users WHERE id=$1", [id]); return result.rows[0] ?? null; },
        isBrowserAuthorized: (id, token) => isBrowserAuthorized((text, values) => db.query<{id: string}>(text, values), id, token),
      };
    }
    let req = request();
    const allowed = await evaluatePasswordLogin(req, browser, deps(req));
    assert.equal(allowed.ok, true);
    if (allowed.ok) assert.equal(allowed.takeSession(), "test-session");
    userId = "user-2";
    req = request();
    assert.deepEqual(await evaluatePasswordLogin(req, browser, deps(req)), { ok: false, status: 401 });
    assert.equal(discarded, 1);
    userId = "user-1";
    await db.exec("UPDATE ahu_private.access_devices SET revoked_at = now() WHERE id='browser-1'");
    req = request();
    assert.deepEqual(await evaluatePasswordLogin(req, browser, deps(req)), { ok: false, status: 401 });
    assert.equal(discarded, 2);
    for (let i = 0; i < 7; i++) { req = request(); await evaluatePasswordLogin(req, browser, deps(req)); }
    assert.equal(staged, 10);
    req = request();
    const blocked = await evaluatePasswordLogin(req, browser, deps(req));
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.status, 429);
    assert.equal(staged, 10);
  } finally { await db.close(); }
});