-- DRAFT: Do not run against a live database without review,
-- a backup, a migration plan, and explicit authorization.

BEGIN;

CREATE UNIQUE INDEX access_devices_device_hash_uidx
ON ahu_private.access_devices USING btree (device_hash);

ALTER TABLE ahu_private.access_devices
ADD CONSTRAINT access_devices_claim_state_check
CHECK (
  (
    device_hash IS NULL
    AND claimed_at IS NULL
    AND expires_at IS NULL
  )
  OR
  (
    device_hash IS NOT NULL
    AND claimed_at IS NOT NULL
    AND expires_at IS NOT NULL
    AND expires_at > claimed_at
  )
);

COMMIT;