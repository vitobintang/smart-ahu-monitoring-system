import { strict as assert } from "node:assert";
import { test } from "node:test";
import { evaluatePasswordLogin, type LoginDependencies } from "../src/lib/login-orchestrator";

const token = "ab".repeat(32);
function makeRequest(body: unknown = { email: "user@example.invalid", password: "private" }): Request {
  return new Request("https://ahu.example.invalid/login", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
function fixture() {
  const calls: string[] = [];
  const session = { secret: "test-session-secret" };
  const deps: LoginDependencies<typeof session> = {
    async checkGateway() { calls.push("gate"); return { ok: true }; },
    async stagePassword(input) { calls.push("password"); assert.equal(input.password, "private");
      return { verifiedUserId: "user-1", takeSession() { calls.push("take"); return session; },
        async discard() { calls.push("discard"); } }; },
    async getProfile(id) { calls.push("profile"); return { id, role: "Operator" }; },
    async isBrowserAuthorized(id, browser) { calls.push("browser"); return id === "user-1" && browser === token; },
  };
  return { deps, calls, session };
}

test("releases a staged session only after profile and browser authorization", async () => {
  const { deps, calls, session } = fixture();
  const result = await evaluatePasswordLogin(makeRequest(), token, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["gate", "password", "profile", "browser"]);
  assert.equal(JSON.stringify(result).includes(session.secret), false);
  if (result.ok) {
    assert.deepEqual(result.user, { id: "user-1", role: "Operator" });
    assert.equal(result.takeSession(), session);
    assert.throws(() => result.takeSession());
  }
  assert.deepEqual(calls, ["gate", "password", "profile", "browser", "take"]);
});

test("gateway denial stops before reading credentials or calling the provider", async () => {
  const { deps, calls } = fixture();
  deps.checkGateway = async () => { calls.push("gate"); return { ok: false, status: 429, retryAfterSeconds: 15 }; };
  assert.deepEqual(await evaluatePasswordLogin(makeRequest(), token, deps), { ok: false, status: 429, retryAfterSeconds: 15 });
  assert.deepEqual(calls, ["gate"]);
  deps.checkGateway = async () => { throw new Error("private gateway failure"); };
  assert.deepEqual(await evaluatePasswordLogin(makeRequest(), token, deps), { ok: false, status: 503 });
});

test("malformed input and missing browser token never reach password authentication", async () => {
  const { deps, calls } = fixture();
  assert.deepEqual(await evaluatePasswordLogin(makeRequest({ email: "a", password: "" }), token, deps), { ok: false, status: 400 });
  assert.deepEqual(await evaluatePasswordLogin(makeRequest(), "bad", deps), { ok: false, status: 401 });
  assert.deepEqual(calls, ["gate", "gate"]);
});

test("bad password, wrong browser and invalid roles never release a session", async () => {
  const first = fixture();
  first.deps.stagePassword = async () => { first.calls.push("password"); return null; };
  assert.deepEqual(await evaluatePasswordLogin(makeRequest(), token, first.deps), { ok: false, status: 401 });
  const second = fixture();
  second.deps.isBrowserAuthorized = async () => { second.calls.push("browser"); return false; };
  assert.deepEqual(await evaluatePasswordLogin(makeRequest(), token, second.deps), { ok: false, status: 401 });
  assert.deepEqual(second.calls, ["gate", "password", "profile", "browser", "discard"]);
  const third = fixture();
  third.deps.getProfile = async () => ({ id: "user-1", role: "unknown" });
  assert.deepEqual(await evaluatePasswordLogin(makeRequest(), token, third.deps), { ok: false, status: 401 });
  assert.equal(third.calls.includes("discard"), true);
  assert.equal(third.calls.includes("browser"), false);
});

test("service failures and discard errors fail closed without exposing details", async () => {
  const { deps, calls } = fixture();
  deps.isBrowserAuthorized = async () => { throw new Error("private database error"); };
  assert.deepEqual(await evaluatePasswordLogin(makeRequest(), token, deps), { ok: false, status: 401 });
  assert.equal(calls.includes("discard"), true);
  deps.stagePassword = async () => ({ verifiedUserId: "user-1", takeSession() { throw new Error("must not take"); }, async discard() { throw new Error("private cleanup error"); } });
  assert.deepEqual(await evaluatePasswordLogin(makeRequest(), token, deps), { ok: false, status: 401 });
  deps.stagePassword = async () => { throw new Error("private provider error"); };
  assert.deepEqual(await evaluatePasswordLogin(makeRequest(), token, deps), { ok: false, status: 503 });
});