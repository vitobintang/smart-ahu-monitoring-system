import { pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { USER_ROLES } from "../lib/ahu";

export const appSchema = pgSchema("ahu_private");

export const roleEnum = appSchema.enum("role", USER_ROLES);

export const users = appSchema.table(
  "users",
  {
    // This ID will correspond to the user's Supabase Auth ID.
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    fullName: text("full_name"),
    role: roleEnum("role").notNull().default("Viewer"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("users_email_uidx").on(table.email)],
);