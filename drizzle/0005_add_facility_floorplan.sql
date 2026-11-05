CREATE TABLE IF NOT EXISTS "ahu_private"."facility_floorplan" (
  "id" integer PRIMARY KEY DEFAULT 1,
  "vertices" jsonb NOT NULL,
  "updated_by" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
