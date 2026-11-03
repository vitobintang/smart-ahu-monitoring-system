import { strict as assert } from "node:assert";
import { test } from "node:test";
import { evaluateBrowserEnrollment, validateEnrollmentInput, type EnrollmentDependencies } from "../src/lib/browser-enrollment";
const invitation = "ab".repeat(32);
const input = { email: "user@example.invalid", password: "  password  ", invitationToken: invitation };
function request(body: unknown = input) { return new Request("https://ahu.example.invalid/enroll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
function fixture() {
  const calls: string[] = [];
  const deps: EnrollmentDependencies<string> = {
    async checkGateway() { calls.push("gate"); return { ok: true }; },
    async stagePassword(value) { calls.push("password"); assert.deepEqual(value, { email: input.email, password: input.password }); return { verifiedUserId: "u1", takeSession: () => "sensitive-session", async discard() { calls.push("discard"); } }; },
    async getProfile(id) { calls.push("profile"); return { id, role: "Viewer" }; },
    async claimQuery(_sql, values) { calls.push("claim"); assert.equal(values[0], "u1"); return { rows: [{ id: "d1" }] }; },
  }; return { calls, deps };
}
test("enrollment validates exact fields and preserves password", () => {
  assert.deepEqual(validateEnrollmentInput(input), input);
  for (const value of [null, [], {}, { ...input, extra: "x" }, { ...input, invitationToken: "bad" }, { ...input, invitationToken: "AB".repeat(32) }, { ...input, email: " user@example.invalid" }, { ...input, password: "" }]) assert.equal(validateEnrollmentInput(value), null);
});
test("gateway or malformed input stops before password or database work", async () => {
  const f = fixture(); f.deps.checkGateway = async () => ({ ok: false, status: 429, retryAfterSeconds: 60 });
  assert.deepEqual(await evaluateBrowserEnrollment(request(), f.deps), { ok: false, status: 429, retryAfterSeconds: 60 }); assert.deepEqual(f.calls, []);
  f.deps.checkGateway = async () => { f.calls.push("gate"); return { ok: true }; };
  assert.deepEqual(await evaluateBrowserEnrollment(request({ ...input, extra: true }), f.deps), { ok: false, status: 400 }); assert.deepEqual(f.calls, ["gate"]);
});
test("verified matching profile and claimed invitation release credentials once", async () => {
  const { deps, calls } = fixture(); const result = await evaluateBrowserEnrollment(request(), deps);
  assert.equal(result.ok, true); assert.deepEqual(calls, ["gate", "password", "profile", "claim"]);
  assert.equal(JSON.stringify(result).includes(invitation), false); assert.equal(JSON.stringify(result).includes("sensitive-session"), false);
  if (result.ok) { assert.deepEqual(result.user, { id: "u1", role: "Viewer" }); const secrets = result.takeCredentials();
    assert.equal(secrets.session, "sensitive-session"); assert.match(secrets.deviceToken, /^[a-f0-9]{64}$/); assert.notEqual(secrets.deviceToken, invitation); assert.throws(() => result.takeCredentials()); }
});
test("password, profile, invitation and database failures deny and discard", async () => {
  const a = fixture(); a.deps.stagePassword = async () => null; assert.deepEqual(await evaluateBrowserEnrollment(request(), a.deps), { ok: false, status: 401 });
  const b = fixture(); b.deps.getProfile = async () => ({ id: "u2", role: "Admin" }); assert.deepEqual(await evaluateBrowserEnrollment(request(), b.deps), { ok: false, status: 401 }); assert.equal(b.calls.includes("claim"), false); assert.equal(b.calls.includes("discard"), true);
  const c = fixture(); c.deps.getProfile = async (id) => ({ id, role: "invalid" }); assert.deepEqual(await evaluateBrowserEnrollment(request(), c.deps), { ok: false, status: 401 }); assert.equal(c.calls.includes("discard"), true);
  const d = fixture(); d.deps.claimQuery = async () => ({ rows: [] }); assert.deepEqual(await evaluateBrowserEnrollment(request(), d.deps), { ok: false, status: 401 }); assert.equal(d.calls.includes("discard"), true);
  const e = fixture(); e.deps.claimQuery = async () => { throw new Error("private database error"); }; assert.deepEqual(await evaluateBrowserEnrollment(request(), e.deps), { ok: false, status: 401 }); assert.equal(e.calls.includes("discard"), true);
});
test("provider and malformed preflight failures fail closed", async () => {
  const p = fixture(); p.deps.stagePassword = async () => { throw new Error("private provider error"); }; assert.deepEqual(await evaluateBrowserEnrollment(request(), p.deps), { ok: false, status: 503 });
  const g = fixture(); g.deps.checkGateway = async () => ({ ok: false, status: 429, retryAfterSeconds: 0 }); assert.deepEqual(await evaluateBrowserEnrollment(request(), g.deps), { ok: false, status: 503 });
});
