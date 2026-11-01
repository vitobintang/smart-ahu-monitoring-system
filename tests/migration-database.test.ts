import { test } from "node:test";
import { equal, rejects } from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

test("initial migration works in an in-memory database", async () => {
  const files = (await readdir("drizzle")).filter((name) =>
    /^0000_.*\.sql$/.test(name),
  );

  equal(files.length, 1);

  const sql = await readFile(join("drizzle", files[0]), "utf8");
  const db = new PGlite();

  try {
    await db.exec(sql);

    await db.query(
      "INSERT INTO ahu_private.users (id, email) VALUES ($1, $2)",
      ["user-1", "one@example.invalid"],
    );

    const result = await db.query<{ role: string }>(
      "SELECT role FROM ahu_private.users WHERE id = $1",
      ["user-1"],
    );

    equal(result.rows[0]?.role, "Viewer");

    await rejects(
      db.query(
        "INSERT INTO ahu_private.users (id, email) VALUES ($1, $2)",
        ["user-2", "one@example.invalid"],
      ),
      /unique/i,
    );

    await rejects(
      db.query(
        "INSERT INTO ahu_private.users (id, email, role) VALUES ($1, $2, $3)",
        ["user-3", "three@example.invalid", "Superuser"],
      ),
      /invalid input value for enum/i,
    );
  } finally {
    await db.close();
  }
});