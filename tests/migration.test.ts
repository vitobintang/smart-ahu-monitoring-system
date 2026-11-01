import { test } from "node:test";
import { equal, match } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function initialMigration(): string {
  const files = readdirSync("drizzle").filter((name) =>
    /^0000_.*\.sql$/.test(name),
  );

  equal(files.length, 1);

  return readFileSync(join("drizzle", files[0]), "utf8");
}

test("initial migration declares the application schema and users table", () => {
  const sql = initialMigration();

  match(sql, /CREATE SCHEMA "ahu_private"/);
  match(sql, /CREATE TYPE "ahu_private"\."role"/);
  match(sql, /CREATE TABLE "ahu_private"\."users"/);
});

test("initial migration declares a unique user email index", () => {
  match(initialMigration(), /CREATE UNIQUE INDEX "users_email_uidx"/);
});