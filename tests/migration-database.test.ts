import { test } from "node:test";
import { equal, rejects } from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

test("all migrations bootstrap a fresh database with the Operator default", async () => {
  const files = (await readdir("drizzle")).filter((name) =>
    /^\d{4}_.*\.sql$/.test(name),
  );

  const db = new PGlite();

  try {
    for (const file of files) {
      const sql = await readFile(join("drizzle", file), "utf8");
      await db.exec(sql);
    }

    await db.query(
      "INSERT INTO ahu_private.users (id, email) VALUES ($1, $2)",
      ["user-1", "one@example.invalid"],
    );

    const result = await db.query<{ role: string }>(
      "SELECT role FROM ahu_private.users WHERE id = $1",
      ["user-1"],
    );

    equal(result.rows[0]?.role, "Operator");

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