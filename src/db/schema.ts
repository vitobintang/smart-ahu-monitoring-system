import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Keep application tables out of Supabase's exposed public Data API schema.
export const ahuSchema = pgSchema("ahu_private");
const pgTable = ahuSchema.table;
const pgEnum = ahuSchema.enum.bind(ahuSchema);

/* ------------------------------------------------------------------ */
/* Enums                                                              */
/* ------------------------------------------------------------------ */

export const roleEnum = pgEnum("role", ["Admin", "Engineering", "Operator"]);
export const ahuStatusEnum = pgEnum("ahu_status", ["RUN", "STOP", "FAULT", "OFFLINE"]);
export const dataSourceEnum = pgEnum("data_source", ["PHYSICAL", "SIMULATION"]);
export const commandStatusEnum = pgEnum("command_status", [
  "REQUESTED",
  "ACCEPTED",
  "SUCCEEDED",
  "FAILED",
  "EXPIRED",
]);
export const alarmPriorityEnum = pgEnum("alarm_priority", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const controlModeEnum = pgEnum("control_mode", ["AUTO", "MANUAL"]);
export const runStateEnum = pgEnum("run_state", ["RUN", "STOP"]);

/* ------------------------------------------------------------------ */
/* User / browser access / audit                                      */
/* ------------------------------------------------------------------ */

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    username: text("username"),
    fullName: text("full_name"),
    role: roleEnum("role").notNull().default("Operator"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_uidx").on(table.email),
    uniqueIndex("users_username_uidx")
      .on(sql`lower(${table.username})`)
      .where(sql`username IS NOT NULL`),
  ],
);

/** Shared login throttling across server instances. */
export const loginAttempts = pgTable("login_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
});

/** One-time enrollment codes and revocable browser authorizations. */
export const accessDevices = pgTable(
  "access_devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    invitationHash: text("invitation_hash").notNull(),
    invitationExpiresAt: timestamp("invitation_expires_at", { withTimezone: true }).notNull(),
    deviceHash: text("device_hash"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("access_devices_invitation_hash_uidx").on(table.invitationHash),
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

/** Append-only audit log (FR-29). */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    userEmail: text("user_email"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    details: jsonb("details").notNull().default({}),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt), index("audit_action_idx").on(t.action)],
);

/* ------------------------------------------------------------------ */
/* AHU / device / telemetry                                           */
/* ------------------------------------------------------------------ */

export const ahus = pgTable("ahus", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  commTimeoutSec: integer("comm_timeout_sec").notNull().default(30),
  hasHeater: boolean("has_heater").notNull().default(false),
  installedSensors: text("installed_sensors").array().notNull().default([]),
  currentStatus: ahuStatusEnum("current_status").notNull().default("OFFLINE"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  controlMode: controlModeEnum("control_mode").notNull().default("AUTO"),
  desiredRunState: runStateEnum("desired_run_state").notNull().default("STOP"),
  setpoint: real("setpoint").notNull().default(22),
  faultCode: text("fault_code"),
  physicalControlEnabled: boolean("physical_control_enabled").notNull().default(false),
  mapX: real("map_x"),
  mapZ: real("map_z"),
  mapRotation: real("map_rotation").notNull().default(0),
  mapZone: text("map_zone"),
});

export const devices = pgTable(
  "devices",
  {
    id: text("id").primaryKey(),
    ahuId: text("ahu_id")
      .notNull()
      .references(() => ahus.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    token: text("token").notNull(),
    sourceType: dataSourceEnum("source_type").notNull().default("SIMULATION"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("devices_token_uidx").on(t.token), index("devices_ahu_idx").on(t.ahuId)],
);

export const telemetry = pgTable(
  "telemetry",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ahuId: text("ahu_id")
      .notNull()
      .references(() => ahus.id, { onDelete: "cascade" }),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    source: dataSourceEnum("source").notNull(),
    messageId: text("message_id"),
    roomTemp: real("room_temp"),
    supplyTemp: real("supply_temp"),
    returnTemp: real("return_temp"),
    humidity: real("humidity"),
    filterDiffPressure: real("filter_diff_pressure"),
    fanSpeed: real("fan_speed"),
    coilTemp: real("coil_temp"),
    damperPosition: real("damper_position"),
    current: real("current"),
    isCurrentFallback: boolean("is_current_fallback").notNull().default(false),
    voltage: real("voltage"),
    isVoltageFallback: boolean("is_voltage_fallback").notNull().default(false),
    runHours: real("run_hours"),
    heaterOutput: real("heater_output"),
    runState: runStateEnum("run_state"),
    faultCode: text("fault_code"),
    rawPayload: jsonb("raw_payload"),
  },
  (t) => [
    index("telemetry_ahu_ts_idx").on(t.ahuId, t.timestamp),
    uniqueIndex("telemetry_ahu_message_uidx").on(t.ahuId, t.messageId),
  ],
);

export const sensorThresholds = pgTable(
  "sensor_thresholds",
  {
    id: text("id").primaryKey(),
    ahuId: text("ahu_id")
      .notNull()
      .references(() => ahus.id, { onDelete: "cascade" }),
    parameter: text("parameter").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    lowLimit: real("low_limit"),
    highLimit: real("high_limit"),
    delaySec: integer("delay_sec").notNull().default(0),
    priority: alarmPriorityEnum("priority").notNull().default("MEDIUM"),
    validMin: real("valid_min"),
    validMax: real("valid_max"),
    unit: text("unit"),
    label: text("label"),
    trendEnabled: boolean("trend_enabled").notNull().default(false),
  },
  (t) => [
    uniqueIndex("threshold_ahu_param_uidx").on(t.ahuId, t.parameter),
    index("threshold_ahu_idx").on(t.ahuId),
  ],
);

/** Durable alarm activation timers survive app restarts. */
export const alarmBreachTimers = pgTable("alarm_breach_timers", {
  id: text("id").primaryKey(),
  firstAt: timestamp("first_at", { withTimezone: true }).notNull(),
});

/* ------------------------------------------------------------------ */
/* Control commands (FR-25 / FR-26 / FR-27)                           */
/* ------------------------------------------------------------------ */

export const ahuCommands = pgTable(
  "ahu_commands",
  {
    id: text("id").primaryKey(),
    ahuId: text("ahu_id")
      .notNull()
      .references(() => ahus.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userEmail: text("user_email"),
    commandType: text("command_type").notNull(),
    payload: jsonb("payload"),
    status: commandStatusEnum("status").notNull().default("REQUESTED"),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [
    index("commands_ahu_idx").on(t.ahuId),
    index("commands_status_idx").on(t.status),
    uniqueIndex("commands_one_active_per_ahu_uidx")
      .on(t.ahuId)
      .where(sql.raw("status in ('REQUESTED', 'ACCEPTED')")),
  ],
);

/* ------------------------------------------------------------------ */
/* Alarms & trend proximity estimation                                */
/* ------------------------------------------------------------------ */

export const alarms = pgTable(
  "alarms",
  {
    id: text("id").primaryKey(),
    ahuId: text("ahu_id")
      .notNull()
      .references(() => ahus.id, { onDelete: "cascade" }),
    parameter: text("parameter").notNull(),
    priority: alarmPriorityEnum("priority").notNull(),
    message: text("message").notNull(),
    breachDirection: text("breach_direction"),
    observedValue: real("observed_value"),
    thresholdValue: real("threshold_value"),
    isActive: boolean("is_active").notNull().default(true),
    acknowledged: boolean("acknowledged").notNull().default(false),
    acknowledgedBy: text("acknowledged_by"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("alarms_active_idx").on(t.isActive),
    index("alarms_ahu_idx").on(t.ahuId),
    index("alarms_triggered_idx").on(t.triggeredAt),
  ],
);

export const trendAlerts = pgTable(
  "trend_alerts",
  {
    id: text("id").primaryKey(),
    ahuId: text("ahu_id")
      .notNull()
      .references(() => ahus.id, { onDelete: "cascade" }),
    parameter: text("parameter").notNull(),
    estimatedMin: integer("estimated_min").notNull(),
    direction: text("direction").notNull(),
    isReliable: boolean("is_reliable").notNull().default(false),
    unreliabilityReason: text("unreliability_reason"),
    sampleCount: integer("sample_count").notNull().default(0),
    variance: real("variance"),
    slopePerMin: real("slope_per_min"),
    currentValue: real("current_value"),
    projectedValue: real("projected_value"),
    thresholdValue: real("threshold_value"),
    minutesToBreach: real("minutes_to_breach"),
    acknowledged: boolean("acknowledged").notNull().default(false),
    acknowledgedBy: text("acknowledged_by"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("trend_ahu_idx").on(t.ahuId), index("trend_created_idx").on(t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Sync state & legacy compatibility outbox                           */
/* ------------------------------------------------------------------ */

export const syncOutbox = pgTable(
  "sync_outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    channel: text("channel").notNull(),
    ahuId: text("ahu_id"),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("outbox_status_idx").on(t.status), index("outbox_created_idx").on(t.createdAt)],
);

export const syncState = pgTable("sync_state", {
  id: integer("id").primaryKey().default(1),
  mode: text("mode").notNull().default("LOCAL"),
  pollingIntervalSec: integer("polling_interval_sec").notNull().default(5),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastError: text("last_error"),
  queuedItems: integer("queued_items").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const facilityFloorplan = pgTable("facility_floorplan", {
  id: integer("id").primaryKey().default(1),
  vertices: jsonb("vertices").$type<Array<{ x: number; z: number }>>().notNull(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Shared row & enum types                                            */
/* ------------------------------------------------------------------ */

export type Role = (typeof roleEnum.enumValues)[number];
export type AhuStatus = (typeof ahuStatusEnum.enumValues)[number];
export type DataSource = (typeof dataSourceEnum.enumValues)[number];
export type CommandStatus = (typeof commandStatusEnum.enumValues)[number];
export type AlarmPriority = (typeof alarmPriorityEnum.enumValues)[number];
export type ControlMode = (typeof controlModeEnum.enumValues)[number];
export type RunState = (typeof runStateEnum.enumValues)[number];

export type UserRow = typeof users.$inferSelect;
export type AhuRow = typeof ahus.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type TelemetryRow = typeof telemetry.$inferSelect;
export type AlarmRow = typeof alarms.$inferSelect;
export type CommandRow = typeof ahuCommands.$inferSelect;
export type TrendAlertRow = typeof trendAlerts.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
export type ThresholdRow = typeof sensorThresholds.$inferSelect;