import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { devices, loginAttempts, telemetry } from "../src/db/schema";
import { authoritativeTelemetry } from "../src/lib/source";

test("live query never selects simulation when a physical device is enabled", async () => {
  const pg = new PGlite();
  try {
    for (const file of (await readdir("drizzle")).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()) {
      await pg.exec(await readFile(`drizzle/${file}`, "utf8"));
    }
    await pg.exec(`
      INSERT INTO ahu_private.ahus (id, name, location) VALUES ('a1', 'A1', 'A');
      INSERT INTO ahu_private.devices (id, ahu_id, label, token, source_type, enabled)
      VALUES ('s', 'a1', 'sim', 'sim-token', 'SIMULATION', true),
             ('p', 'a1', 'phys', 'phy-token', 'PHYSICAL', true);
      INSERT INTO ahu_private.telemetry (ahu_id, timestamp, source, message_id)
      VALUES ('a1', now(), 'SIMULATION', 's1'),
             ('a1', now() - interval '10 minutes', 'PHYSICAL', 'p1');
    `);
    const db = drizzle(pg);
    assert.deepEqual(
      (await db.select({ source: telemetry.source }).from(telemetry).where(authoritativeTelemetry())).map((r) => r.source),
      ["PHYSICAL"],
    );
    await db.update(devices).set({ enabled: false }).where(eq(devices.id, "p"));
    assert.deepEqual(
      (await db.select({ source: telemetry.source }).from(telemetry).where(authoritativeTelemetry())).map((r) => r.source),
      ["SIMULATION"],
    );
    const now = new Date();
    const cutoff = new Date(now.getTime() - 60000);
    const incr = () =>
      db
        .insert(loginAttempts)
        .values({ key: "k", count: 1, windowStart: now })
        .onConflictDoUpdate({
          target: loginAttempts.key,
          set: {
            count: sql`case when ${loginAttempts.windowStart} < ${cutoff} then 1 else ${loginAttempts.count} + 1 end`,
            windowStart: sql`case when ${loginAttempts.windowStart} < ${cutoff} then ${now} else ${loginAttempts.windowStart} end`,
          },
        })
        .returning({ count: loginAttempts.count });
    assert.equal((await incr())[0].count, 1);
    assert.equal((await incr())[0].count, 2);
  } finally {
    await pg.close();
  }
});