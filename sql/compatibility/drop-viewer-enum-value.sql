-- Optional hardening for real PostgreSQL instances (e.g. Supabase):
-- drop the dormant 'Viewer' enum label left behind by
-- drizzle/0006_remove_viewer_role.sql.
--
-- Do NOT run this on in-memory PGlite databases (the local test suite) —
-- PGlite does not implement ALTER TYPE ... DROP VALUE.
-- Safe to re-run: exits silently when the label is already gone or still in use.
DO $$
BEGIN
  ALTER TYPE "ahu_private"."role" DROP VALUE 'Viewer';
EXCEPTION
  WHEN undefined_object THEN NULL;                 -- enum type or value already gone
  WHEN dependent_objects_still_exist THEN NULL;    -- some row still uses 'Viewer'
  WHEN feature_not_supported THEN NULL;            -- engine without DROP VALUE support
END
$$;
