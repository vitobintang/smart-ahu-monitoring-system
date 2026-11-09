import { test } from "node:test";
import { equal, doesNotThrow, rejects } from "node:assert/strict";

import { stageFirebasePassword, getIdentityToolkitUrl } from "../src/lib/firebase/password-auth";

const KEY = "AIza" + "A".repeat(33);
const OK_BODY = {
  localId: "uid-1",
  email: "user@example.invalid",
  idToken: `header.${Buffer.from("{}").toString("base64url")}.signature`,
  registered: true,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("Identity Toolkit URL embeds a validated API key", async () => {
  equal(getIdentityToolkitUrl(KEY), `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`);
  await rejects(async () => getIdentityToolkitUrl("not-a-key"), /Invalid Firebase web API key/);
});

test("successful sign-in stages a verified uid + well-formed id token, and takeSession is single-use", async () => {
  let capturedBody: unknown;
  const staged = await stageFirebasePassword(
    { email: "user@example.invalid", password: "secret" },
    {
      apiKey: KEY,
      fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
        equal(String(url), `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`);
        capturedBody = JSON.parse(String(init?.body));
        return jsonResponse(200, OK_BODY);
      }) as unknown as typeof fetch,
    },
  );
  equal((capturedBody as { email: string }).email, "user@example.invalid");
  equal((capturedBody as { password: string }).password, "secret");
  equal(staged?.verifiedUserId, "uid-1");

  const session = staged!.takeSession();
  equal(session.uid, "uid-1");
  equal(session.email, "user@example.invalid");
  equal(session.idToken.split(".").length, 3);
  await rejects(async () => staged!.takeSession(), /Staged session unavailable/);
  await staged!.discard();
});

test("wrong credentials map to null (401), rate limiting and network errors map to unavailable (503)", async () => {
  for (const code of ["EMAIL_NOT_FOUND", "INVALID_PASSWORD", "INVALID_LOGIN_CREDENTIALS", "USER_DISABLED"]) {
    const staged = await stageFirebasePassword(
      { email: "user@example.invalid", password: "bad" },
      { apiKey: KEY, fetch: (async () => jsonResponse(400, { error: { message: code } })) as unknown as typeof fetch },
    );
    equal(staged, null, code);
  }

  await rejects(
    stageFirebasePassword(
      { email: "user@example.invalid", password: "x" },
      { apiKey: KEY, fetch: (async () => jsonResponse(400, { error: { message: "TOO_MANY_ATTEMPTS_TRY_LATER" } })) as unknown as typeof fetch },
    ),
    /rate limited/,
  );

  await rejects(
    stageFirebasePassword(
      { email: "user@example.invalid", password: "x" },
      { apiKey: KEY, fetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch },
    ),
    /Authentication unavailable/,
  );

  await rejects(
    stageFirebasePassword(
      { email: "user@example.invalid", password: "x" },
      { apiKey: KEY, fetch: (async () => jsonResponse(500, {})) as unknown as typeof fetch },
    ),
    /Authentication unavailable/,
  );
});

test("malformed success payloads fail closed and discard clears the staged identity", async () => {
  await rejects(
    stageFirebasePassword(
      { email: "user@example.invalid", password: "x" },
      { apiKey: KEY, fetch: (async () => jsonResponse(200, { localId: "uid-1", email: "e@e.invalid", idToken: "not-a-jwt" })) as unknown as typeof fetch },
    ),
    /Authentication unavailable/,
  );

  const staged = await stageFirebasePassword(
    { email: "user@example.invalid", password: "secret" },
    { apiKey: KEY, fetch: (async () => jsonResponse(200, OK_BODY)) as unknown as typeof fetch },
  );
  doesNotThrow(() => void staged!.verifiedUserId);
  await staged!.discard();
  await rejects(async () => staged!.takeSession(), /Staged session unavailable/);

  equal(await stageFirebasePassword({ email: "", password: "x" }, { apiKey: KEY, fetch: (async () => jsonResponse(200, OK_BODY)) as unknown as typeof fetch }), null);
});
