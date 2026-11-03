import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

async function migratedDb() {
  const files = (await readdir("drizzle"))
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
  assert.equal(files.length >= 3, true);
  const pg = new PGlite();
  for (const file of files) {
    await pg.exec(await readFile(`drizzle/${file}`, "utf8"));
  }
  return pg;
}

test("migrations enforce one active command per AHU and telemetry idempotency", async () => {
  const pg = await migratedDb();
  try {
    await pg.exec(`
      INSERT INTO ahu_private.users (id, email, role)
      VALUES ('u1', 'operator@example.invalid', 'Operator');

      INSERT INTO ahu_private.ahus (id, name, location)
      VALUES ('AHU-01', 'AHU-01 Cleanroom Supply', 'Building A');
    `);

    await pg.exec(`
      INSERT INTO ahu_private.ahu_commands (id, ahu_id, user_id, command_type, expires_at)
      VALUES ('c1', 'AHU-01', 'u1', 'STOP', now() + interval '1 minute');
    `);

    await assert.rejects(
      pg.exec(`
        INSERT INTO ahu_private.ahu_commands (id, ahu_id, user_id, command_type, expires_at)
        VALUES ('c2', 'AHU-01', 'u1', 'START', now() + interval '1 minute');
      `),
      /unique/i,
    );

    await pg.exec(`
      UPDATE ahu_private.ahu_commands SET status = 'EXPIRED' WHERE id = 'c1';
      INSERT INTO ahu_private.ahu_commands (id, ahu_id, user_id, command_type, expires_at)
      VALUES ('c2', 'AHU-01', 'u1', 'START', now() + interval '1 minute');
    `);

    await pg.exec(`
      INSERT INTO ahu_private.telemetry (ahu_id, timestamp, source, message_id, room_temp)
      VALUES ('AHU-01', now(), 'SIMULATION', 'msg-001', 22.4);
    `);

    await assert.rejects(
      pg.exec(`
        INSERT INTO ahu_private.telemetry (ahu_id, timestamp, source, message_id, room_temp)
        VALUES ('AHU-01', now(), 'SIMULATION', 'msg-001', 22.6);
      `),
      /unique/i,
    );
  } finally {
    await pg.close();
  }
});