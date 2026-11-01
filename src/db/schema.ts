import { sql } from "drizzle-orm";

import {
  check,
  index,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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

export const accessDevices = appSchema.table(
  "access_devices",
  {
    id: text("id").primaryKey(),

    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    label: text("label").notNull(),

    invitationHash: text("invitation_hash").notNull(),

    invitationExpiresAt: timestamp("invitation_expires_at", {
      withTimezone: true,
    }).notNull(),

    deviceHash: text("device_hash"),

    claimedAt: timestamp("claimed_at", { withTimezone: true }),

    expiresAt: timestamp("expires_at", { withTimezone: true }),

    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("access_devices_invitation_hash_uidx").on(
      table.invitationHash,
    ),
    uniqueIndex("access_devices_device_hash_uidx").on(table.deviceHash),
    index("access_devices_user_idx").on(table.userId),

    check(
      "access_devices_claim_state_check",
      sql`
        (
          ${table.deviceHash} IS NULL
          AND ${table.claimedAt} IS NULL
          AND ${table.expiresAt} IS NULL
        )
        OR
        (
          ${table.deviceHash} IS NOT NULL
          AND ${table.claimedAt} IS NOT NULL
          AND ${table.expiresAt} IS NOT NULL
          AND ${table.expiresAt} > ${table.claimedAt}
        )
      `,
    ),
  ],
);