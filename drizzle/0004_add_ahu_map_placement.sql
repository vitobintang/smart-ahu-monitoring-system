ALTER TABLE "ahu_private"."ahus" ADD COLUMN IF NOT EXISTS "map_x" real;--> statement-breakpoint
ALTER TABLE "ahu_private"."ahus" ADD COLUMN IF NOT EXISTS "map_z" real;--> statement-breakpoint
ALTER TABLE "ahu_private"."ahus" ADD COLUMN IF NOT EXISTS "map_rotation" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ahu_private"."ahus" ADD COLUMN IF NOT EXISTS "map_zone" text;
