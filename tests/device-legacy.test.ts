import { test } from "node:test";
import { equal, match, ok } from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

import {
  claimBrowserInvitation,
  type ClaimQuery,
} from "../src/lib/device-claims";
import { issueBrowserInvitation } from "../src/lib/device-invitations";
import { isBrowserAuthorized } from "../src/lib/device-verification";

// Calculate the existing app's hash independently for this test.
function existingFormatHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

test("existing-format browser keys and invitations work locally", async () => {
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
        ('u1', 'one@example.invalid', 'Viewer'),
        ('u2', 'two@example.invalid', 'Viewer');
    `);

    // These are example values used only in the temporary test database.
    const oldBrowser = "b".repeat(64);
    const oldInvitation = "a".repeat(64);
    const usedInvitation = "c".repeat(64);

    await db.query(
      `
        INSERT INTO ahu_private.access_devices
          (
            id, user_id, label, invitation_hash, invitation_expires_at,
            device_hash, claimed_at, expires_at
          )
        VALUES
          (
            'old-browser', 'u1', 'Laptop', $1,
            now() - interval '1 day', $2,
            now() - interval '1 hour', now() + interval '1 day'
          ),
          (
            'old-invite', 'u1', 'Tablet', $3,
            now() + interval '1 day', NULL, NULL, NULL
          )
      `,
      [
        existingFormatHash(usedInvitation),
        existingFormatHash(oldBrowser),
        existingFormatHash(oldInvitation),
      ],
    );

    const query: ClaimQuery = (text, values) =>
      db.query<{ id: string }>(text, values);

    equal(await isBrowserAuthorized(query, "u1", oldBrowser), true);
    equal(await isBrowserAuthorized(query, "u2", oldBrowser), false);

    const claimed = await claimBrowserInvitation(query, "u1", oldInvitation);
    ok(claimed);
    match(claimed.deviceToken, /^[a-f0-9]{64}$/);

    const claimRow = await db.query<{ device_hash: string }>(
      "SELECT device_hash FROM ahu_private.access_devices WHERE id = $1",
      [claimed.deviceId],
    );

    equal(claimRow.rows[0].device_hash, existingFormatHash(claimed.deviceToken));

    const issued = await issueBrowserInvitation(query, "admin", "u1", "Phone");
    ok(issued);
    match(issued.invitationToken, /^[a-f0-9]{64}$/);

    const issuedRow = await db.query<{ invitation_hash: string }>(
      "SELECT invitation_hash FROM ahu_private.access_devices WHERE id = $1",
      [issued.deviceId],
    );

    equal(
      issuedRow.rows[0].invitation_hash,
      existingFormatHash(issued.invitationToken),
    );
  } finally {
    await db.close();
  }
});