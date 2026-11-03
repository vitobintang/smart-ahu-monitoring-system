import { strict as assert } from "node:assert";
import { test } from "node:test";
import { stageSupabasePassword } from "../src/lib/staged-supabase-login";
import { evaluatePasswordLogin, type LoginDependencies } from "../src/lib/login-orchestrator";

const user = { id: "user-1", aud: "authenticated", role: "authenticated" };
const access = ["eyJhbGciOiJub25lIn0", Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"), ""].join(".");
const config = { url: "https://example.supabase.co", publishableKey: "sb_publishable_test" };
const input = { email: "user@example.invalid", password: "test-password" };
function fakeFetch(options: { badCredentials?: boolean; wrongUser?: boolean; failLogout?: boolean } = {}) {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (target, init) => {
    const url = String(target);
    if (url.includes("/token?")) {
      calls.push("password");
      if (options.badCredentials) return Response.json({ error: "invalid_grant", error_description: "private error" }, { status: 400 });
      return Response.json({ access_token: access, refresh_token: "test-refresh", expires_in: 3600, token_type: "bearer", user });
    }
    if (url.endsWith("/user")) { calls.push("verify"); return Response.json(options.wrongUser ? { ...user, id: "different" } : user); }
    if (url.includes("/logout")) { calls.push("logout"); return new Response(null, { status: options.failLogout ? 500 : 204 }); }
    throw new Error("Unexpected request " + init?.method);
  };
  return { fetcher, calls };
}

test("stages secure cookies only after Auth verifies the same user", async () => {
  const fake = fakeFetch();
  const candidate = await stageSupabasePassword(input, { ...config, fetch: fake.fetcher });
  assert.ok(candidate);
  assert.deepEqual(fake.calls, ["password", "verify"]);
  assert.equal(JSON.stringify(candidate).includes("test-refresh"), false);
  const session = candidate.takeSession();
  assert.ok(session.cookies.length);
  assert.ok(session.cookies.every(({ options }) => options.httpOnly && options.secure && options.path === "/" && options.sameSite === "lax" && !options.domain));
  assert.throws(() => candidate.takeSession());
});

test("wrong password returns no candidate and unverified identity triggers cleanup", async () => {
  const wrong = fakeFetch({ badCredentials: true });
  assert.equal(await stageSupabasePassword(input, { ...config, fetch: wrong.fetcher }), null);
  const mismatch = fakeFetch({ wrongUser: true });
  await assert.rejects(stageSupabasePassword(input, { ...config, fetch: mismatch.fetcher }), /Authentication unavailable/);
  assert.deepEqual(mismatch.calls, ["password", "verify", "logout"]);
});

test("discard revokes the staged session once and prevents taking it", async () => {
  const fake = fakeFetch();
  const candidate = await stageSupabasePassword(input, { ...config, fetch: fake.fetcher });
  assert.ok(candidate);
  await candidate.discard();
  await candidate.discard();
  assert.deepEqual(fake.calls, ["password", "verify", "logout"]);
  assert.throws(() => candidate.takeSession());
});

test("a denied browser triggers staged session discard", async () => {
  const fake = fakeFetch();
  const req = new Request("https://ahu.example.invalid/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const deps: LoginDependencies<unknown> = {
    checkGateway: async () => ({ ok: true }),
    stagePassword: (credentials) => stageSupabasePassword(credentials, { ...config, fetch: fake.fetcher }),
    getProfile: async (id) => ({ id, role: "Viewer" }),
    isBrowserAuthorized: async () => false,
  };
  assert.deepEqual(await evaluatePasswordLogin(req, "ab".repeat(32), deps), { ok: false, status: 401 });
  assert.deepEqual(fake.calls, ["password", "verify", "logout"]);
});

test("rejects privileged or malformed keys before a network request", async () => {
  const fake = fakeFetch();
  const service = ["abc", Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url"), "signature"].join(".");
  for (const publishableKey of ["sb_secret_test", service, "bad"]) {
    await assert.rejects(stageSupabasePassword(input, { ...config, publishableKey, fetch: fake.fetcher }));
  }
  assert.deepEqual(fake.calls, []);
});


test("failed remote logout does not make the staged session available", async () => {
  const fake = fakeFetch({ failLogout: true });
  const candidate = await stageSupabasePassword(input, { ...config, fetch: fake.fetcher });
  assert.ok(candidate);
  await assert.rejects(candidate.discard(), /Session cleanup failed/);
  assert.throws(() => candidate.takeSession());
});

test("the coordinator with the SDK adapter releases staged cookies only for an authorized browser", async () => {
  const fake = fakeFetch();
  const req = new Request("https://ahu.example.invalid/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const deps: LoginDependencies<unknown> = {
    checkGateway: async () => ({ ok: true }),
    stagePassword: (credentials) => stageSupabasePassword(credentials, { ...config, fetch: fake.fetcher }),
    getProfile: async (id) => ({ id, role: "Viewer" }),
    isBrowserAuthorized: async (id) => id === user.id,
  };
  const decision = await evaluatePasswordLogin(req, "ab".repeat(32), deps);
  assert.equal(decision.ok, true);
  assert.equal(JSON.stringify(decision).includes("test-refresh"), false);
  if (decision.ok) assert.ok((decision.takeSession() as { cookies: unknown[] }).cookies.length);
  assert.deepEqual(fake.calls, ["password", "verify"]);
});

test("accepts a legacy anon-shaped key, and rejects unsafe project URLs", async () => {
  const anonKey = ["abc", Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url"), "signature"].join(".");
  const fake = fakeFetch();
  const candidate = await stageSupabasePassword(input, { ...config, publishableKey: anonKey, fetch: fake.fetcher });
  assert.ok(candidate);
  await candidate.discard();
  const callsBefore = fake.calls.length;
  for (const url of ["http://example.supabase.co", "https://example.supabase.co/path", "https://example.supabase.co/?q=1"]) {
    await assert.rejects(stageSupabasePassword(input, { ...config, url, fetch: fake.fetcher }));
  }
  assert.equal(fake.calls.length, callsBefore);
});
