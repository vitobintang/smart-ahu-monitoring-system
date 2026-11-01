import { test } from "node:test";
import { equal, rejects } from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

test("browser authorization database constraints work locally", async () => {
  const files = (await readdir("drizzle"))
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort();

  equal(files.length >= 2, true);

  const db = new PGlite();

  try {
    for (const file of files) {
      await db.exec(await readFile(join("drizzle", file), "utf8"));
    }

    await db.exec(`
      INSERT INTO ahu_private.users (id, email)
      VALUES ('u1', 'one@example.invalid');

      INSERT INTO ahu_private.access_devices
        (id, user_id, label, invitation_hash, invitation_expires_at)
      VALUES
        ('d1', 'u1', 'Laptop', 'invite1', now() + interval '1 day'),
        ('d2', 'u1', 'Tablet', 'invite2', now() + interval '1 day');
    `);

    // Two invitations cannot use the same invitation hash.
    await rejects(
      db.exec(`
        INSERT INTO ahu_private.access_devices
          (id, user_id, label, invitation_hash, invitation_expires_at)
        VALUES
          ('d3', 'u1', 'Browser', 'invite1', now() + interval '1 day');
      `),
      /unique/i,
    );

    // An authorization must belong to an existing user.
    await rejects(
      db.exec(`
        INSERT INTO ahu_private.access_devices
          (id, user_id, label, invitation_hash, invitation_expires_at)
        VALUES
          ('d4', 'missing', 'Browser', 'invite4', now() + interval '1 day');
      `),
      /foreign key/i,
    );

    // A claimed browser must have a complete claim state.
    await rejects(
      db.exec(`
        UPDATE ahu_private.access_devices
        SET device_hash = 'hash1'
        WHERE id = 'd1';
      `),
      /check constraint/i,
    );

    await db.exec(`
      UPDATE ahu_private.access_devices
      SET device_hash = 'hash1',
          claimed_at = now(),
          expires_at = now() + interval '90 days'
      WHERE id = 'd1';
    `);

    // Two browsers cannot use the same browser credential hash.
    await rejects(
      db.exec(`
        UPDATE ahu_private.access_devices
        SET device_hash = 'hash1',
            claimed_at = now(),
            expires_at = now() + interval '90 days'
        WHERE id = 'd2';
      `),
      /unique/i,
    );

    // Removing the example user removes their example authorizations.
    await db.exec("DELETE FROM ahu_private.users WHERE id = 'u1'");

    const remaining = await db.query(
      "SELECT id FROM ahu_private.access_devices",
    );

    equal(remaining.rows.length, 0);
  } finally {
    await db.close();
  }
});