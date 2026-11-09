import assert from "node:assert/strict";
import test from "node:test";

import {
  isAdminRole,
  isValidUserRole,
  normalizeUsername,
  parseLoginPayload,
  suggestUsernameFromEmail,
} from "../src/lib/role-auth";

test("role helpers recognize all three valid user roles and distinguish Admin", () => {
  assert.equal(isAdminRole("Admin"), true);
  assert.equal(isAdminRole("Engineering"), false);
  assert.equal(isAdminRole("Operator"), false);

  assert.equal(isValidUserRole("Admin"), true);
  assert.equal(isValidUserRole("Engineering"), true);
  assert.equal(isValidUserRole("Operator"), true);
  assert.equal(isValidUserRole("Viewer"), false);
  assert.equal(isValidUserRole("Superuser"), false);
  assert.equal(isValidUserRole(null), false);
});

test("normalizeUsername and suggestUsernameFromEmail enforce clean 3-32 char handles", () => {
  assert.deepEqual(normalizeUsername("  Vizo.Bintang_01  "), {
    ok: true,
    username: "vizo.bintang_01",
  });
  assert.equal(normalizeUsername("ab").ok, false);
  assert.equal(normalizeUsername(".badstart").ok, false);
  assert.equal(normalizeUsername("has@at").ok, false);
  assert.equal(suggestUsernameFromEmail("VizoBintang@gmail.com"), "vizobintang");
  assert.equal(suggestUsernameFromEmail("ab@ahu.local"), "abuser");
});

test("parseLoginPayload accepts email or username + password for all roles and rejects user tokens", () => {
  assert.deepEqual(
    parseLoginPayload({ identifier: "  VizoBintang@Gmail.com ", password: "secret-password" }),
    {
      ok: true,
      identifierType: "email",
      identifier: "vizobintang@gmail.com",
      password: "secret-password",
    },
  );

  assert.deepEqual(
    parseLoginPayload({ identifier: "  Vizo.Bintang ", password: "secret-password" }),
    {
      ok: true,
      identifierType: "username",
      identifier: "vizo.bintang",
      password: "secret-password",
    },
  );

  assert.deepEqual(
    parseLoginPayload({ email: "eng@ahu.local", password: "secret-password" }),
    {
      ok: true,
      identifierType: "email",
      identifier: "eng@ahu.local",
      password: "secret-password",
    },
  );

  assert.deepEqual(
    parseLoginPayload({ username: "shift_operator", password: "secret-password" }),
    {
      ok: true,
      identifierType: "username",
      identifier: "shift_operator",
      password: "secret-password",
    },
  );

  const rejectedToken = parseLoginPayload({ mode: "token", token: "a".repeat(64) });
  assert.equal(rejectedToken.ok, false);
  if (!rejectedToken.ok) {
    assert.match(rejectedToken.error, /AHU monitoring modules/i);
  }

  assert.equal(parseLoginPayload({ identifier: "", password: "secret" }).ok, false);
  assert.equal(parseLoginPayload({ identifier: "vizobintang", password: "" }).ok, false);
  assert.equal(parseLoginPayload({ identifier: "not@valid", password: "secret" }).ok, false);
  assert.equal(parseLoginPayload(null).ok, false);
});
