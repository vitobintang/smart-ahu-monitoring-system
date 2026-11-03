import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildStagedCookieResponse } from "../src/lib/staged-cookie-response";
const url = "https://abcdefghijklmnopqrst.supabase.co";
const base = "sb-abcdefghijklmnopqrst-auth-token";
const options = { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 34560000 };
const cookie = (name = base, value = "base64-test_session") => ({ name, value, options: { ...options } });
const session = (cookies: unknown[] = [cookie()]) => ({ cookies });

test("login issues only secure host-only auth cookies and no secret response body", async () => {
  const response = buildStagedCookieResponse(url, null, session(), "login"); assert.ok(response);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const cookies = response.headers.getSetCookie(); assert.equal(cookies.length, 1);
  assert.match(cookies[0], /^sb-abcdefghijklmnopqrst-auth-token=base64-test_session;/);
  assert.match(cookies[0], /HttpOnly; Secure; SameSite=Lax/); assert.doesNotMatch(cookies[0], /Domain=/);
  assert.equal(cookies[0].includes("ahu_device"), false);
});
test("enrollment adds separate secure browser cookie without putting secrets in JSON", async () => {
  const token = "ab".repeat(32); const response = buildStagedCookieResponse(url, null, session(), "enrollment", token); assert.ok(response);
  assert.equal(JSON.stringify(await response.json()).includes(token), false);
  const cookies = response.headers.getSetCookie(); assert.equal(cookies.length, 2);
  assert.ok(cookies.some(c => c.startsWith(`ahu_device=${token};`) && c.includes("HttpOnly; Secure; SameSite=Lax") && c.includes("Max-Age=7776000")));
});
test("clears obsolete root auth chunks without deleting newly staged names or unrelated cookies", () => {
  const old = `${base}.0=old; ${base}.1=old; unrelated=x`;
  const response = buildStagedCookieResponse(url, old, session([cookie(base + ".0")]), "login"); assert.ok(response);
  const cookies = response.headers.getSetCookie(); assert.equal(cookies.length, 2);
  assert.ok(cookies.some(c => c.startsWith(`${base}.1=;`) && c.includes("Max-Age=0")));
  assert.ok(cookies.some(c => c.startsWith(`${base}.0=base64-test_session;`) && !c.includes("Max-Age=0")));
  assert.ok(cookies.every(c => !c.includes("unrelated")));
});
test("rejects malformed, duplicate, gapped, mixed and unsafe cookies", () => {
  const bad = [session([]), session([cookie("wrong")]), session([cookie(base + ".1")]), session([cookie(), cookie(base + ".0")]),
    session([cookie(), cookie()]), session([cookie(base, "bad;header")]), session([{ ...cookie(), options: { ...options, httpOnly: false } }]),
    session([{ ...cookie(), options: { ...options, domain: "example.invalid" } }]), session([{ ...cookie(), options: { ...options, maxAge: 0 } }]),
    session([{ ...cookie(), options: { ...options, secure: false } }])];
  for (const value of bad) assert.equal(buildStagedCookieResponse(url, null, value, "login"), null);
  assert.equal(buildStagedCookieResponse(url, `${base}=a; ${base}=b`, session(), "login"), null);
  assert.equal(buildStagedCookieResponse(url, `${base}.99=x`, session(), "login"), null);
  assert.equal(buildStagedCookieResponse(url, "x".repeat(8193), session(), "login"), null);
});
test("rejects unsafe project URLs and browser token misuse", () => {
  for (const bad of ["http://abcdefghijklmnopqrst.supabase.co", url + "/path", "https://evil.example.invalid", "https://user@abcdefghijklmnopqrst.supabase.co", url + "?x=1"]) assert.equal(buildStagedCookieResponse(bad, null, session(), "login"), null);
  assert.equal(buildStagedCookieResponse(url, null, session(), "enrollment", "bad"), null);
  assert.equal(buildStagedCookieResponse(url, null, session(), "login", "ab".repeat(32)), null);
});


test("rejects duplicate device cookies rather than guessing their scope", () => {
  assert.equal(buildStagedCookieResponse(url, "ahu_device=a; ahu_device=b", session(), "login"), null);
});

test("accepts real SSR SDK cookie output from a fake Auth service", async () => {
  const { createServerClient } = await import("@supabase/ssr");
  const user = { id: "u1", aud: "authenticated", role: "authenticated" };
  const access = ["eyJhbGciOiJub25lIn0", Buffer.from(JSON.stringify({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"), ""].join(".");
  const written: { name: string; value: string; options: Record<string, unknown> }[] = [];
  const fakeFetch: typeof fetch = async () => Response.json({ access_token: access, refresh_token: "test-refresh", expires_in: 3600, token_type: "bearer", user });
  const client = createServerClient(url, "sb_publishable_test", { global: { fetch: fakeFetch },
    cookieOptions: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
    cookies: { getAll: () => [], setAll(items) { written.push(...items); } } });
  const result = await client.auth.signInWithPassword({ email: "user@example.invalid", password: "test" });
  assert.equal(result.error, null);
  const response = buildStagedCookieResponse(url, null, { cookies: written }, "login");
  assert.ok(response); assert.ok(response.headers.getSetCookie().length > 0);
  assert.equal(JSON.stringify(await response.json()).includes("test-refresh"), false);
});
