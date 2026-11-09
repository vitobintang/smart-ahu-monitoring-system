-- =============================================================================
-- Supabase teardown — Smart AHU Monitoring System (Phase 5c)
-- =============================================================================
-- The application no longer reads or writes any of these tables at runtime:
-- since Phase 5b slice 3, every request path is Firebase RTDB-native.
-- Run this in the Supabase SQL editor ONLY if you want to keep the project
-- alive after the migration. If you do not need the historical backup below,
-- the simpler option is to just pause or delete the whole Supabase project
-- from the Supabase dashboard — that removes everything at once.
--
-- Recommended order:
--   1. (Optional) export a final backup:
--        pg_dump "$DATABASE_URL" > supabase-final-backup.sql
--   2. Run this script.
--   3. Remove DATABASE_URL from the app's .env.local (nothing uses it once
--        the LOCAL fallback is retired; the app never contacts Supabase).
-- =============================================================================

-- Drop every application table (the ahu_private schema holds them all —
-- they were deliberately kept out of the public Data API schema).
drop table if exists ahu_private.audit_logs cascade;
drop table if exists ahu_private.trend_alerts cascade;
drop table if exists ahu_private.alarms cascade;
drop table if exists ahu_private.ahu_commands cascade;
drop table if exists ahu_private.alarm_breach_timers cascade;
drop table if exists ahu_private.telemetry cascade;
drop table if exists ahu_private.sensor_thresholds cascade;
drop table if exists ahu_private.devices cascade;
drop table if exists ahu_private.facility_floorplan cascade;
drop table if exists ahu_private.sync_outbox cascade;
drop table if exists ahu_private.sync_state cascade;
drop table if exists ahu_private.access_devices cascade;
drop table if exists ahu_private.login_attempts cascade;
drop table if exists ahu_private.ahus cascade;
drop table if exists ahu_private.users cascade;

-- Remove the schema itself.
drop schema if exists ahu_private cascade;

-- Done. Verify with:
--   select table_schema, table_name from information_schema.tables
--   where table_schema = 'ahu_private';   -- expect zero rows
