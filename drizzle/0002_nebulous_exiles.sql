CREATE TYPE "ahu_private"."ahu_status" AS ENUM('RUN', 'STOP', 'FAULT', 'OFFLINE');--> statement-breakpoint
CREATE TYPE "ahu_private"."alarm_priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "ahu_private"."command_status" AS ENUM('REQUESTED', 'ACCEPTED', 'SUCCEEDED', 'FAILED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "ahu_private"."control_mode" AS ENUM('AUTO', 'MANUAL');--> statement-breakpoint
CREATE TYPE "ahu_private"."data_source" AS ENUM('PHYSICAL', 'SIMULATION');--> statement-breakpoint
CREATE TYPE "ahu_private"."run_state" AS ENUM('RUN', 'STOP');--> statement-breakpoint
CREATE TABLE "ahu_private"."ahu_commands" (
	"id" text PRIMARY KEY NOT NULL,
	"ahu_id" text NOT NULL,
	"user_id" text NOT NULL,
	"user_email" text,
	"command_type" text NOT NULL,
	"payload" jsonb,
	"status" "ahu_private"."command_status" DEFAULT 'REQUESTED' NOT NULL,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ahu_private"."ahus" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"location" text NOT NULL,
	"comm_timeout_sec" integer DEFAULT 30 NOT NULL,
	"has_heater" boolean DEFAULT false NOT NULL,
	"installed_sensors" text[] DEFAULT '{}' NOT NULL,
	"current_status" "ahu_private"."ahu_status" DEFAULT 'OFFLINE' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"control_mode" "ahu_private"."control_mode" DEFAULT 'AUTO' NOT NULL,
	"desired_run_state" "ahu_private"."run_state" DEFAULT 'STOP' NOT NULL,
	"setpoint" real DEFAULT 22 NOT NULL,
	"fault_code" text,
	"physical_control_enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ahu_private"."alarm_breach_timers" (
	"id" text PRIMARY KEY NOT NULL,
	"first_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ahu_private"."alarms" (
	"id" text PRIMARY KEY NOT NULL,
	"ahu_id" text NOT NULL,
	"parameter" text NOT NULL,
	"priority" "ahu_private"."alarm_priority" NOT NULL,
	"message" text NOT NULL,
	"breach_direction" text,
	"observed_value" real,
	"threshold_value" real,
	"is_active" boolean DEFAULT true NOT NULL,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledged_by" text,
	"acknowledged_at" timestamp with time zone,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ahu_private"."audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"user_email" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ahu_private"."devices" (
	"id" text PRIMARY KEY NOT NULL,
	"ahu_id" text NOT NULL,
	"label" text NOT NULL,
	"token" text NOT NULL,
	"source_type" "ahu_private"."data_source" DEFAULT 'SIMULATION' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ahu_private"."login_attempts" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ahu_private"."sensor_thresholds" (
	"id" text PRIMARY KEY NOT NULL,
	"ahu_id" text NOT NULL,
	"parameter" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"low_limit" real,
	"high_limit" real,
	"delay_sec" integer DEFAULT 0 NOT NULL,
	"priority" "ahu_private"."alarm_priority" DEFAULT 'MEDIUM' NOT NULL,
	"valid_min" real,
	"valid_max" real,
	"unit" text,
	"label" text,
	"trend_enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ahu_private"."sync_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"ahu_id" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ahu_private"."sync_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"mode" text DEFAULT 'LOCAL' NOT NULL,
	"polling_interval_sec" integer DEFAULT 5 NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"queued_items" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ahu_private"."telemetry" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ahu_id" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"source" "ahu_private"."data_source" NOT NULL,
	"message_id" text,
	"room_temp" real,
	"supply_temp" real,
	"return_temp" real,
	"humidity" real,
	"filter_diff_pressure" real,
	"fan_speed" real,
	"coil_temp" real,
	"damper_position" real,
	"current" real,
	"is_current_fallback" boolean DEFAULT false NOT NULL,
	"voltage" real,
	"is_voltage_fallback" boolean DEFAULT false NOT NULL,
	"run_hours" real,
	"heater_output" real,
	"run_state" "ahu_private"."run_state",
	"fault_code" text,
	"raw_payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "ahu_private"."trend_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"ahu_id" text NOT NULL,
	"parameter" text NOT NULL,
	"estimated_min" integer NOT NULL,
	"direction" text NOT NULL,
	"is_reliable" boolean DEFAULT false NOT NULL,
	"unreliability_reason" text,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"variance" real,
	"slope_per_min" real,
	"current_value" real,
	"projected_value" real,
	"threshold_value" real,
	"minutes_to_breach" real,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledged_by" text,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ahu_private"."ahu_commands" ADD CONSTRAINT "ahu_commands_ahu_id_ahus_id_fk" FOREIGN KEY ("ahu_id") REFERENCES "ahu_private"."ahus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ahu_private"."ahu_commands" ADD CONSTRAINT "ahu_commands_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "ahu_private"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ahu_private"."alarms" ADD CONSTRAINT "alarms_ahu_id_ahus_id_fk" FOREIGN KEY ("ahu_id") REFERENCES "ahu_private"."ahus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ahu_private"."devices" ADD CONSTRAINT "devices_ahu_id_ahus_id_fk" FOREIGN KEY ("ahu_id") REFERENCES "ahu_private"."ahus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ahu_private"."sensor_thresholds" ADD CONSTRAINT "sensor_thresholds_ahu_id_ahus_id_fk" FOREIGN KEY ("ahu_id") REFERENCES "ahu_private"."ahus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ahu_private"."telemetry" ADD CONSTRAINT "telemetry_ahu_id_ahus_id_fk" FOREIGN KEY ("ahu_id") REFERENCES "ahu_private"."ahus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ahu_private"."trend_alerts" ADD CONSTRAINT "trend_alerts_ahu_id_ahus_id_fk" FOREIGN KEY ("ahu_id") REFERENCES "ahu_private"."ahus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commands_ahu_idx" ON "ahu_private"."ahu_commands" USING btree ("ahu_id");--> statement-breakpoint
CREATE INDEX "commands_status_idx" ON "ahu_private"."ahu_commands" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "commands_one_active_per_ahu_uidx" ON "ahu_private"."ahu_commands" USING btree ("ahu_id") WHERE status in ('REQUESTED', 'ACCEPTED');--> statement-breakpoint
CREATE INDEX "alarms_active_idx" ON "ahu_private"."alarms" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "alarms_ahu_idx" ON "ahu_private"."alarms" USING btree ("ahu_id");--> statement-breakpoint
CREATE INDEX "alarms_triggered_idx" ON "ahu_private"."alarms" USING btree ("triggered_at");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "ahu_private"."audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "ahu_private"."audit_logs" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_token_uidx" ON "ahu_private"."devices" USING btree ("token");--> statement-breakpoint
CREATE INDEX "devices_ahu_idx" ON "ahu_private"."devices" USING btree ("ahu_id");--> statement-breakpoint
CREATE UNIQUE INDEX "threshold_ahu_param_uidx" ON "ahu_private"."sensor_thresholds" USING btree ("ahu_id","parameter");--> statement-breakpoint
CREATE INDEX "threshold_ahu_idx" ON "ahu_private"."sensor_thresholds" USING btree ("ahu_id");--> statement-breakpoint
CREATE INDEX "outbox_status_idx" ON "ahu_private"."sync_outbox" USING btree ("status");--> statement-breakpoint
CREATE INDEX "outbox_created_idx" ON "ahu_private"."sync_outbox" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "telemetry_ahu_ts_idx" ON "ahu_private"."telemetry" USING btree ("ahu_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "telemetry_ahu_message_uidx" ON "ahu_private"."telemetry" USING btree ("ahu_id","message_id");--> statement-breakpoint
CREATE INDEX "trend_ahu_idx" ON "ahu_private"."trend_alerts" USING btree ("ahu_id");--> statement-breakpoint
CREATE INDEX "trend_created_idx" ON "ahu_private"."trend_alerts" USING btree ("created_at");