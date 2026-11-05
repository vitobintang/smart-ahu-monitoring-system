import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeRolePermission,
  isAdminRole,
  isValidUserRole,
  normalizeUsername,
  parseLoginPayload,
  resolveRoleSession,
  suggestUsernameFromEmail,
} from "../src/lib/role-auth";

test("role helpers recognize all four valid user roles and distinguish Admin", () => {
  assert.equal(isAdminRole("Admin"), true);
  assert.equal(isAdminRole("Engineering"), false);
  assert.equal(isAdminRole("Operator"), false);
  assert.equal(isAdminRole("Viewer"), false);

  assert.equal(isValidUserRole("Admin"), true);
  assert.equal(isValidUserRole("Engineering"), true);
  assert.equal(isValidUserRole("Operator"), true);
  assert.equal(isValidUserRole("Viewer"), true);
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

test("resolveRoleSession authenticates Admin, Engineering, Operator, and Viewer via verified Supabase Auth", async () => {
  for (const role of ["Admin", "Engineering", "Operator", "Viewer"] as const) {
    const resolved = await resolveRoleSession({
      getSupabaseUserId: async () => `uid-${role.toLowerCase()}`,
      getUserById: async (id) => ({ id, role }),
    });
    assert.deepEqual(resolved, { id: `uid-${role.toLowerCase()}`, role });
  }

  const unauthenticated = await resolveRoleSession({
    getSupabaseUserId: async () => null,
    getUserById: async () => ({ id: "uid-admin", role: "Admin" as const }),
  });
  assert.equal(unauthenticated, null);

  const mismatchedId = await resolveRoleSession({
    getSupabaseUserId: async () => "uid-a",
    getUserById: async () => ({ id: "uid-b", role: "Operator" as const }),
  });
  assert.equal(mismatchedId, null);
});

test("authorizeRolePermission enforces RBAC permissions on verified credential sessions", async () => {
  const adminManage = await authorizeRolePermission(
    {
      getSupabaseUserId: async () => "admin-1",
      getUserById: async () => ({ id: "admin-1", role: "Admin" as const }),
    },
    "users:create",
  );
  assert.deepEqual(adminManage, { id: "admin-1", role: "Admin" });

  const engineeringConfig = await authorizeRolePermission(
    {
      getSupabaseUserId: async () => "eng-1",
      getUserById: async () => ({ id: "eng-1", role: "Engineering" as const }),
    },
    "configuration:edit",
  );
  assert.deepEqual(engineeringConfig, { id: "eng-1", role: "Engineering" });

  const operatorControl = await authorizeRolePermission(
    {
      getSupabaseUserId: async () => "op-1",
      getUserById: async () => ({ id: "op-1", role: "Operator" as const }),
    },
    "commands:request",
  );
  assert.deepEqual(operatorControl, { id: "op-1", role: "Operator" });

  const viewerDeniedControl = await authorizeRolePermission(
    {
      getSupabaseUserId: async () => "viewer-1",
      getUserById: async () => ({ id: "viewer-1", role: "Viewer" as const }),
    },
    "commands:request",
  );
  assert.equal(viewerDeniedControl, null);
});
