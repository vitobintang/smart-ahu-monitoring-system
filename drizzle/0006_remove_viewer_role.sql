-- Remove the "Viewer" role from the platform.
-- 1) Existing Viewer accounts migrate to Operator (same read access, plus
--    acknowledge/control).
-- 2) The column default moves from Viewer to Operator.
--
-- NOTE: the dormant 'Viewer' enum label is intentionally retained in the
-- database type. The local test suite runs on in-memory PGlite, which does
-- not implement ALTER TYPE ... DROP VALUE. The label is unreachable through
-- the application: every write path validates roles against USER_ROLES
-- (Admin / Engineering / Operator). To harden a real Supabase database,
-- optionally run sql/compatibility/drop-viewer-enum-value.sql afterwards.
UPDATE "ahu_private"."users" SET "role" = 'Operator' WHERE "role" = 'Viewer';--> statement-breakpoint
ALTER TABLE "ahu_private"."users" ALTER COLUMN "role" SET DEFAULT 'Operator';
