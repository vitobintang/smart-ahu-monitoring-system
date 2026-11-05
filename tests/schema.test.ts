import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";

import { getTableConfig } from "drizzle-orm/pg-core";
import { roleEnum, users } from "../src/db/schema";

test("users belong to the application schema", () => {
  const config = getTableConfig(users);

  equal(config.schema, "ahu_private");
  equal(config.name, "users");
});

test("users require an ID, email, and role", () => {
  const columns = getTableConfig(users).columns;

  equal(columns.find((column) => column.name === "id")?.primary, true);
  equal(columns.find((column) => column.name === "email")?.notNull, true);
  equal(columns.find((column) => column.name === "role")?.notNull, true);
});

test("roles and the unique email index are defined", () => {
  deepStrictEqual(roleEnum.enumValues, [
    "Admin",
    "Engineering",
    "Operator",
  ]);

  const indexes = getTableConfig(users).indexes;

  equal(
    indexes.some(
      (index) => index.config.name === "users_email_uidx" && index.config.unique,
    ),
    true,
  );
});