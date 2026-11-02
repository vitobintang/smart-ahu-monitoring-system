import { randomUUID } from "node:crypto";

import type { ClaimQuery } from "./device-claims";
import { createDeviceToken, hashDeviceToken } from "./device-tokens";

function validId(value: string): boolean {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 128
  );
}

export async function issueBrowserInvitation(
  query: ClaimQuery,
  issuerId: string,
  targetUserId: string,
  label: string,
): Promise<{ deviceId: string; invitationToken: string } | null> {
  if (
    !validId(issuerId) ||
    !validId(targetUserId) ||
    typeof label !== "string" ||
    /[\x00-\x1f\x7f]/.test(label)
  ) {
    return null;
  }

  const cleanLabel = label.trim();

  if (!cleanLabel || cleanLabel.length > 120) {
    return null;
  }

  const deviceId = randomUUID();
  const invitationToken = createDeviceToken();
  const invitationHash = hashDeviceToken(invitationToken, "invitation");

  const result = await query(
    `
      WITH authorized_admin AS (
        SELECT id
        FROM ahu_private.users
        WHERE id = $5 AND role = 'Admin'
        FOR SHARE
      )
      INSERT INTO ahu_private.access_devices
        (id, user_id, label, invitation_hash, invitation_expires_at)
      SELECT
        $1, target.id, $3, $4, now() + interval '24 hours'
      FROM ahu_private.users AS target
      CROSS JOIN authorized_admin
      WHERE target.id = $2
      RETURNING id
    `,
    [deviceId, targetUserId, cleanLabel, invitationHash, issuerId],
  );

  if (result.rows.length !== 1) {
    return null;
  }

  return {
    deviceId: result.rows[0].id,
    invitationToken,
  };
}