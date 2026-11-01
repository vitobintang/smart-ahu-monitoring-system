CREATE TABLE "ahu_private"."access_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"invitation_hash" text NOT NULL,
	"invitation_expires_at" timestamp with time zone NOT NULL,
	"device_hash" text,
	"claimed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_devices_claim_state_check" CHECK (
        (
          "ahu_private"."access_devices"."device_hash" IS NULL
          AND "ahu_private"."access_devices"."claimed_at" IS NULL
          AND "ahu_private"."access_devices"."expires_at" IS NULL
        )
        OR
        (
          "ahu_private"."access_devices"."device_hash" IS NOT NULL
          AND "ahu_private"."access_devices"."claimed_at" IS NOT NULL
          AND "ahu_private"."access_devices"."expires_at" IS NOT NULL
          AND "ahu_private"."access_devices"."expires_at" > "ahu_private"."access_devices"."claimed_at"
        )
      )
);
--> statement-breakpoint
ALTER TABLE "ahu_private"."access_devices" ADD CONSTRAINT "access_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "ahu_private"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_devices_invitation_hash_uidx" ON "ahu_private"."access_devices" USING btree ("invitation_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "access_devices_device_hash_uidx" ON "ahu_private"."access_devices" USING btree ("device_hash");--> statement-breakpoint
CREATE INDEX "access_devices_user_idx" ON "ahu_private"."access_devices" USING btree ("user_id");