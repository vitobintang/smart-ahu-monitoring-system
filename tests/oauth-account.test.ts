import { test } from "node:test";
import { equal } from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import { resolveOrLinkAppUserForAuthUser } from "../src/lib/oauth-account";
import type { db as AppDb } from "../src/db";

async function createTestDb() {
  const files = (await readdir("drizzle"))
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort();
  const pg = new PGlite();
  for (const file of files) {
    await pg.exec(await readFile(join("drizzle", file), "utf8"));
  }
  const orm = drizzle(pg) as unknown as Pick<typeof AppDb, "select" | "update" | "transaction">;
  return { pg, orm };
}

test("Google OAuth and password login share the exact same account by ID or verified email", async () => {
  const { pg, orm } = await createTestDb();
  try {
    await pg.exec(`
      INSERT INTO ahu_private.users (id, email, username, full_name, role)
      VALUES ('auth-uuid-1', 'vizobintang@gmail.com', 'vizobintang', NULL, 'Admin');

      INSERT INTO ahu_private.ahus (id, name, location)
      VALUES ('AHU-01', 'Cleanroom', 'Zone A');

      INSERT INTO ahu_private.ahu_commands (id, ahu_id, user_id, user_email, command_type, expires_at)
      VALUES ('cmd-1', 'AHU-01', 'auth-uuid-1', 'vizobintang@gmail.com', 'RUN', now() + interval '1 minute');
    `);

    // 1. Direct ID match (Supabase automatic identity linking) returns the same account and backfills Google fullName
    const direct = await resolveOrLinkAppUserForAuthUser(
      {
        id: "auth-uuid-1",
        email: "vizobintang@gmail.com",
        emailConfirmed: true,
        fullName: "Vito Bintang",
      },
      orm,
    );
    equal(direct?.id, "auth-uuid-1");
    equal(direct?.username, "vizobintang");
    equal(direct?.role, "Admin");
    equal(direct?.fullName, "Vito Bintang");

    // 2. Verified same-email reconciliation preserves role, username, and FK command history
    const reconciled = await resolveOrLinkAppUserForAuthUser(
      {
        id: "google-linked-uuid-2",
        email: "VizoBintang@gmail.com",
        emailConfirmed: true,
        fullName: "Vito Bintang",
      },
      orm,
    );
    equal(reconciled?.id, "google-linked-uuid-2");
    equal(reconciled?.email, "vizobintang@gmail.com");
    equal(reconciled?.username, "vizobintang");
    equal(reconciled?.role, "Admin");

    const cmdCheck = await pg.query<{ user_id: string }>(
      "SELECT user_id FROM ahu_private.ahu_commands WHERE id = 'cmd-1'",
    );
    equal(cmdCheck.rows[0]?.user_id, "google-linked-uuid-2");

    // 3. Unverified email or unregistered Gmail is rejected
    const unverified = await resolveOrLinkAppUserForAuthUser(
      {
        id: "other-uuid",
        email: "vizobintang@gmail.com",
        emailConfirmed: false,
      },
      orm,
    );
    equal(unverified, null);

    const unknownGmail = await resolveOrLinkAppUserForAuthUser(
      {
        id: "stranger-uuid",
        email: "stranger@gmail.com",
        emailConfirmed: true,
      },
      orm,
    );
    equal(unknownGmail, null);
  } finally {
    await pg.close();
  }
});
