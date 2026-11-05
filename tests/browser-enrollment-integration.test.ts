import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { issueBrowserInvitation } from "../src/lib/device-invitations";
import { isBrowserAuthorized } from "../src/lib/device-verification";
import { revokeBrowserAuthorization } from "../src/lib/device-revocations";
import { evaluateBrowserEnrollment, type EnrollmentDependencies } from "../src/lib/browser-enrollment";
import type { ClaimQuery } from "../src/lib/device-claims";
// Temporary local database and fake gateway/password provider, not live services.
test("Admin-issued invitation is bound to its user, claimed once and revocable locally", async () => {
  const db = new PGlite();
  try {
    const migrations = (await readdir("drizzle")).filter(name => /^\d+_.*\.sql$/.test(name)).sort();
    for (const file of migrations) await db.exec(await readFile(join("drizzle", file), "utf8"));
    await db.exec(`INSERT INTO ahu_private.users (id,email,role) VALUES ('admin','admin@example.invalid','Admin'),('u1','u1@example.invalid','Operator'),('u2','u2@example.invalid','Operator');`);
    const query: ClaimQuery = (text, values) => db.query<{ id: string }>(text, values);
    assert.equal(await issueBrowserInvitation(query, "u2", "u1", "Laptop"), null);
    const invite = await issueBrowserInvitation(query, "admin", "u1", "Laptop"); assert.ok(invite);
    const makeRequest = () => new Request("https://ahu.example.invalid/enroll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "user@example.invalid", password: "test", invitationToken: invite.invitationToken }) });
    let userId = "u2"; let discards = 0;
    const deps: EnrollmentDependencies<string> = {
      checkGateway: async () => ({ ok: true }),
      stagePassword: async () => ({ verifiedUserId: userId, takeSession: () => "test-session", async discard() { discards++; } }),
      getProfile: async (id) => { const result = await db.query<{ id: string; role: string }>("SELECT id, role FROM ahu_private.users WHERE id = $1", [id]); return result.rows[0] ?? null; },
      claimQuery: query,
    };
    assert.deepEqual(await evaluateBrowserEnrollment(makeRequest(), deps), { ok: false, status: 401 }); assert.equal(discards, 1);
    userId = "u1"; const allowed = await evaluateBrowserEnrollment(makeRequest(), deps); assert.ok(allowed.ok);
    const credentials = allowed.takeCredentials(); assert.equal(credentials.session, "test-session");
    assert.equal(await isBrowserAuthorized(query, "u1", credentials.deviceToken), true);
    assert.equal(await isBrowserAuthorized(query, "u2", credentials.deviceToken), false);
    assert.equal(await isBrowserAuthorized(query, "u1", invite.invitationToken), false);
    assert.deepEqual(await evaluateBrowserEnrollment(makeRequest(), deps), { ok: false, status: 401 });
    assert.equal(await revokeBrowserAuthorization(query, "admin", invite.deviceId), true);
    assert.equal(await isBrowserAuthorized(query, "u1", credentials.deviceToken), false);
  } finally { await db.close(); }
});
