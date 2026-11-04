import { test } from "node:test";
import { deepStrictEqual, equal, match, ok } from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

import {
  claimTokenOnlyInvitation,
  type ClaimQuery,
  type RoleClaimQuery,
} from "../src/lib/device-claims";
import { issueBrowserInvitation } from "../src/lib/device-invitations";
import { revokeBrowserAuthorization } from "../src/lib/device-revocations";
import { createDeviceToken, hashDeviceToken } from "../src/lib/device-tokens";
import {
  getAuthorizedTokenBrowser,
  type RoleVerificationQuery,
} from "../src/lib/device-verification";
import {
  authorizeRolePermission,
  buildTokenAccountEmail,
  isSyntheticTokenEmail,
  parseLoginPayload,
  resolveRoleSession,
} from "../src/lib/role-auth";

test("parseLoginPayload separates Admin email/password login from non-Admin token-only login", () => {
  deepStrictEqual(
    parseLoginPayload({ mode: "admin", email: "  Admin@Example.com ", password: "SecretPassword!" }),
    { ok: true, mode: "admin", email: "admin@example.com", password: "SecretPassword!" },
  );

  deepStrictEqual(
    parseLoginPayload({ email: "admin@example.com", password: "SecretPassword!" }),
    { ok: true, mode: "admin", email: "admin@example.com", password: "SecretPassword!" },
  );

  const sampleToken = "a".repeat(64);
  deepStrictEqual(
    parseLoginPayload({ mode: "token", token: `  ${sampleToken}  ` }),
    { ok: true, mode: "token", token: sampleToken },
  );

  deepStrictEqual(
    parseLoginPayload({ token: sampleToken }),
    { ok: true, mode: "token", token: sampleToken },
  );

  deepStrictEqual(
    parseLoginPayload({ deviceToken: sampleToken }),
    { ok: true, mode: "token", token: sampleToken },
  );

  equal(parseLoginPayload({ mode: "token", token: "   " }).ok, false);
  equal(parseLoginPayload({ mode: "admin", email: "admin@example.com" }).ok, false);
  equal(parseLoginPayload({}).ok, false);
});

test("buildTokenAccountEmail produces unique internal placeholders for passwordless members", () => {
  const generated = buildTokenAccountEmail("Shift A Operator!", "550e8400-e29b-41d4-a716-446655440000");
  equal(generated, "shift-a-operator-550e8400@token.local");
  equal(isSyntheticTokenEmail(generated), true);
  equal(isSyntheticTokenEmail("vizobintang@gmail.com"), false);
});

test("resolveRoleSession allows Admin via email/password without a token and non-Admin via token without email/password", async () => {
  // 1. Admin authenticated via Supabase Auth only (no browser token) -> allowed
  const adminSession = await resolveRoleSession({
    getSupabaseUserId: async () => "admin-1",
    getUserById: async (id) => (id === "admin-1" ? { id: "admin-1", role: "Admin" as const } : null),
    getAuthorizedTokenUser: async () => null,
  });
  deepStrictEqual(adminSession, { id: "admin-1", role: "Admin" });

  // 2. Non-Admin with a Supabase Auth session but no token -> denied (email/password is Admin-only)
  const operatorViaPassword = await resolveRoleSession({
    getSupabaseUserId: async () => "op-1",
    getUserById: async (id) => (id === "op-1" ? { id: "op-1", role: "Operator" as const } : null),
    getAuthorizedTokenUser: async () => null,
  });
  equal(operatorViaPassword, null);

  // 3. Non-Admin with valid claimed browser token and NO Supabase Auth session -> allowed
  const operatorViaToken = await resolveRoleSession({
    getSupabaseUserId: async () => {
      throw new Error("no supabase session");
    },
    getUserById: async () => null,
    getAuthorizedTokenUser: async () => ({ id: "op-1", role: "Operator" as const }),
  });
  deepStrictEqual(operatorViaToken, { id: "op-1", role: "Operator" });

  // 4. Admin cannot authenticate via browser token cookie without Supabase Auth
  const adminViaToken = await resolveRoleSession({
    getSupabaseUserId: async () => null,
    getUserById: async () => null,
    getAuthorizedTokenUser: async () => ({ id: "admin-1", role: "Admin" as const }),
  });
  equal(adminViaToken, null);

  // 5. Role permissions enforced accurately
  deepStrictEqual(
    await authorizeRolePermission(
      {
        getSupabaseUserId: async () => null,
        getUserById: async () => null,
        getAuthorizedTokenUser: async () => ({ id: "viewer-1", role: "Viewer" as const }),
      },
      "monitoring:read",
    ),
    { id: "viewer-1", role: "Viewer" },
  );

  equal(
    await authorizeRolePermission(
      {
        getSupabaseUserId: async () => null,
        getUserById: async () => null,
        getAuthorizedTokenUser: async () => ({ id: "viewer-1", role: "Viewer" as const }),
      },
      "commands:request",
    ),
    null,
  );
});

test("non-Admin token-only lifecycle works end-to-end in PostgreSQL and blocks Admin token use", async () => {
  const db = new PGlite();

  try {
    const files = (await readdir("drizzle"))
      .filter((name) => /^\d+_.*\.sql$/.test(name))
      .sort();

    for (const file of files) {
      await db.exec(await readFile(join("drizzle", file), "utf8"));
    }

    await db.exec(`
      INSERT INTO ahu_private.users (id, email, full_name, role)
      VALUES
        ('admin-1', 'admin@example.invalid', 'System Admin', 'Admin'),
        ('eng-1', 'eng-1@token.local', 'Lead Engineer', 'Engineering'),
        ('op-1', 'op-1@token.local', 'Shift Operator', 'Operator'),
        ('view-1', 'view-1@token.local', 'Plant Viewer', 'Viewer');
    `);

    const claimQuery: ClaimQuery = (text, values) =>
      db.query<{ id: string }>(text, values);
    const roleClaimQuery: RoleClaimQuery = (text, values) =>
      db.query<{ id: string; user_id: string; role: string }>(text, values);
    const verifyQuery: RoleVerificationQuery = (text, values) =>
      db.query<{ id: string; role: string }>(text, values);

    // Admin does not use tokens; issuing a token to an Admin is rejected.
    equal(await issueBrowserInvitation(claimQuery, "admin-1", "admin-1", "Admin laptop"), null);

    // Admin issues a one-time token for Operator (no email/password needed by Operator).
    const issued = await issueBrowserInvitation(claimQuery, "admin-1", "op-1", "Control room PC");
    ok(issued);

    // Operator claims the token using ONLY the token string.
    const claimed = await claimTokenOnlyInvitation(roleClaimQuery, issued.invitationToken);
    ok(claimed);
    equal(claimed.userId, "op-1");
    equal(claimed.role, "Operator");
    match(claimed.deviceToken, /^[a-f0-9]{64}$/);

    // One-time token cannot be claimed a second time.
    equal(await claimTokenOnlyInvitation(roleClaimQuery, issued.invitationToken), null);

    // Claimed browser cookie authorizes the Operator without email/password.
    deepStrictEqual(await getAuthorizedTokenBrowser(verifyQuery, claimed.deviceToken), {
      id: "op-1",
      role: "Operator",
    });

    // Raw invitation token is never accepted as a browser session cookie.
    equal(await getAuthorizedTokenBrowser(verifyQuery, issued.invitationToken), null);

    // Revoking (e.g., on logout or Admin revocation) immediately terminates browser access.
    equal(await revokeBrowserAuthorization(claimQuery, "admin-1", claimed.deviceId), true);
    equal(await getAuthorizedTokenBrowser(verifyQuery, claimed.deviceToken), null);

    // Even a legacy Admin row in access_devices cannot be claimed or used as a session.
    const legacyInvite = createDeviceToken();
    const legacyBrowser = createDeviceToken();
    await db.query(
      `
        INSERT INTO ahu_private.access_devices
          (id, user_id, label, invitation_hash, invitation_expires_at)
        VALUES
          ('legacy-admin-invite', 'admin-1', 'Old Admin Invite', $1, now() + interval '1 day')
      `,
      [hashDeviceToken(legacyInvite, "invitation")],
    );
    await db.query(
      `
        INSERT INTO ahu_private.access_devices
          (id, user_id, label, invitation_hash, invitation_expires_at, device_hash, claimed_at, expires_at)
        VALUES
          ('legacy-admin-browser', 'admin-1', 'Old Admin Browser', $1, now() + interval '1 day', $2, now() - interval '1 minute', now() + interval '30 days')
      `,
      [
        hashDeviceToken(createDeviceToken(), "invitation"),
        hashDeviceToken(legacyBrowser, "browser"),
      ],
    );

    equal(await claimTokenOnlyInvitation(roleClaimQuery, legacyInvite), null);
    equal(await getAuthorizedTokenBrowser(verifyQuery, legacyBrowser), null);
  } finally {
    await db.close();
  }
});
