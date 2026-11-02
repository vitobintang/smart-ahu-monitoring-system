import { test } from "node:test";
import { equal, ok, rejects } from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

import { createDeviceToken, hashDeviceToken } from "../src/lib/device-tokens";
import {
  claimBrowserInvitation,
  type ClaimQuery,
} from "../src/lib/device-claims";
import { isBrowserAuthorized } from "../src/lib/device-verification";

test("verification requires a valid browser belonging to the same user", async () => {
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

    const invitations = [
      createDeviceToken(),
      createDeviceToken(),
      createDeviceToken(),
    ];

    await db.query(
      `
        INSERT INTO ahu_private.access_devices
          (id, user_id, label, invitation_hash, invitation_expires_at)
        VALUES
          ('d1', 'u1', 'Laptop', $1, now() + interval '1 hour'),
          ('d2', 'u1', 'Expired', $2, now() + interval '1 hour'),
          ('d3', 'u1', 'Revoked', $3, now() + interval '1 hour')
      `,
      invitations.map((token) => hashDeviceToken(token, "invitation")),
    );

    const query: ClaimQuery = (text, values) =>
      db.query<{ id: string }>(text, values);

    // An invitation itself cannot be used as a browser credential.
    equal(await isBrowserAuthorized(query, "u1", invitations[0]), false);

    const first = await claimBrowserInvitation(query, "u1", invitations[0]);
    const expired = await claimBrowserInvitation(query, "u1", invitations[1]);
    const revoked = await claimBrowserInvitation(query, "u1", invitations[2]);

    ok(first);
    ok(expired);
    ok(revoked);

    equal(await isBrowserAuthorized(query, "u1", first.deviceToken), true);
    equal(await isBrowserAuthorized(query, "u2", first.deviceToken), false);
    equal(await isBrowserAuthorized(query, "u1", createDeviceToken()), false);
    equal(await isBrowserAuthorized(query, "u1", "bad-token"), false);

    await db.exec(`
      UPDATE ahu_private.access_devices
      SET claimed_at = now() - interval '2 days',
          expires_at = now() - interval '1 day'
      WHERE id = 'd2';

      UPDATE ahu_private.access_devices
      SET revoked_at = now()
      WHERE id = 'd3';
    `);

    equal(await isBrowserAuthorized(query, "u1", expired.deviceToken), false);
    equal(await isBrowserAuthorized(query, "u1", revoked.deviceToken), false);
  } finally {
    await db.close();
  }
});

test("database errors are not treated as authorization", async () => {
  const query: ClaimQuery = async () => {
    throw new Error("database unavailable");
  };

  await rejects(
    isBrowserAuthorized(query, "u1", createDeviceToken()),
    /database unavailable/,
  );
});