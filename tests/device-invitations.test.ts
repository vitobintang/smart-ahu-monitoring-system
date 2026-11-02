import { test } from "node:test";
import { equal, notEqual, ok, rejects } from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

import { issueBrowserInvitation } from "../src/lib/device-invitations";
import {
  claimBrowserInvitation,
  type ClaimQuery,
} from "../src/lib/device-claims";
import { hashDeviceToken } from "../src/lib/device-tokens";

test("only an Admin role can issue a user-bound invitation", async () => {
  const db = new PGlite();

  try {
    const files = (await readdir("drizzle"))
      .filter((name) => /^\d+_.*\.sql$/.test(name))
      .sort();

    for (const file of files) {
      await db.exec(await readFile(join("drizzle", file), "utf8"));
    }

    await db.exec(`
      INSERT INTO ahu_private.users (id, email, role)
      VALUES
        ('admin', 'admin@example.invalid', 'Admin'),
        ('engineering', 'engineering@example.invalid', 'Engineering'),
        ('viewer', 'viewer@example.invalid', 'Viewer'),
        ('target', 'target@example.invalid', 'Operator');
    `);

    const query: ClaimQuery = (text, values) =>
      db.query<{ id: string }>(text, values);

    equal(await issueBrowserInvitation(query, "viewer", "target", "Laptop"), null);
    equal(await issueBrowserInvitation(query, "engineering", "target", "Laptop"), null);
    equal(await issueBrowserInvitation(query, "target", "target", "Laptop"), null);
    equal(await issueBrowserInvitation(query, "missing", "target", "Laptop"), null);
    equal(await issueBrowserInvitation(query, "admin", "missing", "Laptop"), null);
    equal(await issueBrowserInvitation(query, "admin", "target", "   "), null);
    equal(await issueBrowserInvitation(query, "admin", "target", "X".repeat(121)), null);
    equal(await issueBrowserInvitation(query, "admin", "target", "Bad\nName"), null);

    const before = await db.query("SELECT id FROM ahu_private.access_devices");
    equal(before.rows.length, 0);

    const issued = await issueBrowserInvitation(
      query,
      "admin",
      "target",
      "  Laptop  ",
    );

    ok(issued);

    const saved = await db.query<{
      user_id: string;
      label: string;
      invitation_hash: string;
      valid_window: boolean;
    }>(
      `
        SELECT
          user_id,
          label,
          invitation_hash,
          (
            invitation_expires_at > now() + interval '23 hours'
            AND invitation_expires_at < now() + interval '25 hours'
          ) AS valid_window
        FROM ahu_private.access_devices
        WHERE id = $1
      `,
      [issued.deviceId],
    );

    equal(saved.rows[0].user_id, "target");
    equal(saved.rows[0].label, "Laptop");
    equal(saved.rows[0].valid_window, true);

    equal(
      saved.rows[0].invitation_hash,
      hashDeviceToken(issued.invitationToken, "invitation"),
    );
    notEqual(saved.rows[0].invitation_hash, issued.invitationToken);

    equal(
      await claimBrowserInvitation(query, "viewer", issued.invitationToken),
      null,
    );
    ok(await claimBrowserInvitation(query, "target", issued.invitationToken));
  } finally {
    await db.close();
  }
});

test("database errors are not treated as successful issuance", async () => {
  const query: ClaimQuery = async () => {
    throw new Error("database unavailable");
  };

  await rejects(
    issueBrowserInvitation(query, "admin", "target", "Laptop"),
    /database unavailable/,
  );
});