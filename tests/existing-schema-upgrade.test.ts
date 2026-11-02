import { test } from "node:test";
import { equal, ok, rejects } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";

import {
  claimBrowserInvitation,
  type ClaimQuery,
} from "../src/lib/device-claims";
import { isBrowserAuthorized } from "../src/lib/device-verification";

function existingFormatHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// This is a small local model of the relevant existing tables,
// not a connection to the real Supabase project.
async function createExistingDatabase() {
  const db = new PGlite();

  try {
    await db.exec(`
      CREATE SCHEMA ahu_private;

      CREATE TABLE ahu_private.users (
        id text PRIMARY KEY,
        email text NOT NULL
      );

      CREATE TABLE ahu_private.access_devices (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES ahu_private.users(id) ON DELETE CASCADE,
        label text NOT NULL,
        invitation_hash text NOT NULL,
        invitation_expires_at timestamptz NOT NULL,
        device_hash text,
        claimed_at timestamptz,
        expires_at timestamptz,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX access_devices_invitation_hash_uidx
      ON ahu_private.access_devices(invitation_hash);

      CREATE INDEX access_devices_user_idx
      ON ahu_private.access_devices(user_id);

      INSERT INTO ahu_private.users (id, email)
      VALUES ('u1', 'one@example.invalid');
    `);

    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function readDraftUpdate(): Promise<string> {
  return readFile(
    "sql/compatibility/access-device-constraints.sql",
    "utf8",
  );
}

test("the update preserves valid existing browser access locally", async () => {
  const db = await createExistingDatabase();

  try {
    const browser = "b".repeat(64);
    const invitation = "a".repeat(64);

    await db.query(
      `
        INSERT INTO ahu_private.access_devices
          (
            id, user_id, label, invitation_hash, invitation_expires_at,
            device_hash, claimed_at, expires_at
          )
        VALUES
          (
            'd1', 'u1', 'Laptop', $1, now() - interval '1 day',
            $2, now() - interval '1 hour', now() + interval '1 day'
          ),
          (
            'd2', 'u1', 'Tablet', $3, now() + interval '1 day',
            NULL, NULL, NULL
          )
      `,
      [
        existingFormatHash("c".repeat(64)),
        existingFormatHash(browser),
        existingFormatHash(invitation),
      ],
    );

    const query: ClaimQuery = (text, values) =>
      db.query<{ id: string }>(text, values);

    equal(await isBrowserAuthorized(query, "u1", browser), true);

    await db.exec(await readDraftUpdate());

    equal(await isBrowserAuthorized(query, "u1", browser), true);
    ok(await claimBrowserInvitation(query, "u1", invitation));
  } finally {
    await db.close();
  }
});

test("duplicate browser hashes reject the update without deleting records", async () => {
  const db = await createExistingDatabase();

  try {
    await db.exec(`
      INSERT INTO ahu_private.access_devices
        (
          id, user_id, label, invitation_hash, invitation_expires_at,
          device_hash, claimed_at, expires_at
        )
      VALUES
        (
          'd1', 'u1', 'A', 'invite1', now() + interval '1 day',
          'same-hash', now(), now() + interval '1 day'
        ),
        (
          'd2', 'u1', 'B', 'invite2', now() + interval '1 day',
          'same-hash', now(), now() + interval '1 day'
        );
    `);

    await rejects(db.exec(await readDraftUpdate()), /unique|duplicate/i);
    await db.exec("ROLLBACK");

    const remaining = await db.query(
      "SELECT id FROM ahu_private.access_devices",
    );
    equal(remaining.rows.length, 2);
  } finally {
    await db.close();
  }
});

test("invalid claim states roll back the whole update", async () => {
  const db = await createExistingDatabase();

  try {
    await db.exec(`
      INSERT INTO ahu_private.access_devices
        (id, user_id, label, invitation_hash, invitation_expires_at, device_hash)
      VALUES
        ('d1', 'u1', 'A', 'invite1', now() + interval '1 day', 'hash1');
    `);

    await rejects(db.exec(await readDraftUpdate()), /check constraint/i);
    await db.exec("ROLLBACK");

    const remaining = await db.query(
      "SELECT id FROM ahu_private.access_devices",
    );
    equal(remaining.rows.length, 1);

    const result = await db.query<{ index_exists: boolean }>(
      `
        SELECT to_regclass(
          'ahu_private.access_devices_device_hash_uidx'
        ) IS NOT NULL AS index_exists
      `,
    );

    equal(result.rows[0].index_exists, false);
  } finally {
    await db.close();
  }
});