import { test } from "node:test";
import { equal, throws } from "node:assert/strict";

import { getDatabaseUrl } from "../src/db/config";

const exampleUrl =
  "postgresql://user:example-secret@db.example.invalid:5432/postgres?sslmode=require";

test("accepts a PostgreSQL URL with a supported SSL mode", () => {
  equal(getDatabaseUrl(exampleUrl), exampleUrl);

  const second =
    "postgres://user@db.example.invalid/postgres?sslmode=verify-full";
  equal(getDatabaseUrl(second), second);
});

test("rejects missing configuration", () => {
  throws(() => getDatabaseUrl(undefined), /required/);
  throws(() => getDatabaseUrl("   "), /required/);
});

test("rejects invalid URL structure", () => {
  throws(() => getDatabaseUrl("not-a-url"), /valid PostgreSQL/);
  throws(
    () => getDatabaseUrl("https://example.invalid/db?sslmode=require"),
    /PostgreSQL/,
  );
  throws(
    () => getDatabaseUrl("postgresql://db.example.invalid/postgres?sslmode=require"),
    /user/,
  );
  throws(
    () => getDatabaseUrl("postgresql://user@db.example.invalid/?sslmode=require"),
    /database/,
  );
});

test("rejects missing, weak, or ambiguous SSL modes", () => {
  throws(
    () => getDatabaseUrl("postgresql://user@db.example.invalid/postgres"),
    /sslmode/,
  );
  throws(
    () =>
      getDatabaseUrl(
        "postgresql://user@db.example.invalid/postgres?sslmode=disable",
      ),
    /sslmode/,
  );
  throws(
    () =>
      getDatabaseUrl(
        "postgresql://user@db.example.invalid/postgres?sslmode=require&sslmode=disable",
      ),
    /sslmode/,
  );
  throws(
    () =>
      getDatabaseUrl(
        "postgresql://user@db.example.invalid/postgres?sslmode=require&ssl=false",
      ),
    /sslmode/,
  );
});

test("errors do not contain the database password", () => {
  const password = "not-a-real-secret";

  try {
    getDatabaseUrl(
      `postgresql://user:${password}@db.example.invalid/postgres?sslmode=disable`,
    );
    throw new Error("expected rejection");
  } catch (error) {
    equal(error instanceof Error, true);
    equal((error as Error).message.includes(password), false);
    equal((error as Error).message.includes("sslmode"), true);
  }
});