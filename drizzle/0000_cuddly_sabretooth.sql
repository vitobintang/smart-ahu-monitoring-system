CREATE SCHEMA "ahu_private";
--> statement-breakpoint
CREATE TYPE "ahu_private"."role" AS ENUM('Admin', 'Engineering', 'Operator', 'Viewer');--> statement-breakpoint
CREATE TABLE "ahu_private"."users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"role" "ahu_private"."role" DEFAULT 'Viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uidx" ON "ahu_private"."users" USING btree ("email");