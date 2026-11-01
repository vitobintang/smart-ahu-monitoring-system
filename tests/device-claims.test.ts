import { test } from "node:test";
import { equal, notEqual, ok } from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

import { createDeviceToken, hashDeviceToken } from "../src/lib/device-tokens";
import {
  claimBrowserInvitation,
  type ClaimQuery,
} from "../src/lib/device-claims";

test("invitations are claimed once by the intended user", async () => {
  const db = new PGlite();

  try {
    const files = (await readdir("drizzle"))
      .filter((name) => /^\d+_.*\.sql$/.test(name))
      .sort();

    for (const file of files) {
      await db.exec(await readFile(join("drizzle", file), "utf8"));
    }

    await db.exec(`
      INSERT INTO ahu_private.users (id, email)
      VALUES
        ('u1', 'one@example.invalid'),
        ('u2', 'two@example.invalid');
    `);

    const invitation = createDeviceToken();
    const expired = createDeviceToken();
    const revoked = createDeviceToken();
    const race = createDeviceToken();

    await db.query(
      `
        INSERT INTO ahu_private.access_devices
          (id, user_id, label, invitation_hash, invitation_expires_at, revoked_at)
        VALUES
          ('d1', 'u1', 'Laptop', $1, now() + interval '1 hour', NULL),
          ('d2', 'u1', 'Expired', $2, now() - interval '1 hour', NULL),
          ('d3', 'u1', 'Revoked', $3, now() + interval '1 hour', now()),
          ('d4', 'u1', 'Race test', $4, now() + interval '1 hour', NULL)
      `,
      [invitation, expired, revoked, race].map((token) =>
        hashDeviceToken(token, "invitation"),
      ),
    );

    const query: ClaimQuery = (text, values) =>
      db.query<{ id: string }>(text, values);

    equal(await claimBrowserInvitation(query, "u2", invitation), null);
    equal(await claimBrowserInvitation(query, "u1", expired), null);
    equal(await claimBrowserInvitation(query, "u1", revoked), null);
    equal(await claimBrowserInvitation(query, "u1", "bad"), null);

    const claimed = await claimBrowserInvitation(query, "u1", invitation);

    ok(claimed);
    equal(claimed.deviceId, "d1");

    const saved = await db.query<{ device_hash: string }>(
      "SELECT device_hash FROM ahu_private.access_devices WHERE id = 'd1'",
    );

    equal(
      saved.rows[0].device_hash,
      hashDeviceToken(claimed.deviceToken, "browser"),
    );
    notEqual(saved.rows[0].device_hash, claimed.deviceToken);

    equal(await claimBrowserInvitation(query, "u1", invitation), null);

    const attempts = await Promise.all([
      claimBrowserInvitation(query, "u1", race),
      claimBrowserInvitation(query, "u1", race),
    ]);

    equal(attempts.filter(Boolean).length, 1);
  } finally {
    await db.close();
  }
});