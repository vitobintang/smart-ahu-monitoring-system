import { USER_ROLES, type UserRole } from "./ahu";
import { createDeviceToken, hashDeviceToken } from "./device-tokens";

export type ClaimQuery = (
  text: string,
  values: string[],
) => Promise<{ rows: { id: string }[] }>;

export type RoleClaimQuery = (
  text: string,
  values: string[],
) => Promise<{ rows: { id: string; user_id: string; role: string }[] }>;

export async function claimBrowserInvitation(
  query: ClaimQuery,
  userId: string,
  invitationToken: string,
): Promise<{ deviceId: string; deviceToken: string } | null> {
  if (typeof userId !== "string" || !userId.trim() || userId.length > 128) {
    return null;
  }

  let invitationHash: string;

  try {
    invitationHash = hashDeviceToken(invitationToken, "invitation");
  } catch {
    return null;
  }

  const deviceToken = createDeviceToken();
  const deviceHash = hashDeviceToken(deviceToken, "browser");

  const result = await query(
    `
      UPDATE ahu_private.access_devices
      SET device_hash = $3,
          claimed_at = now(),
          expires_at = now() + interval '90 days'
      WHERE user_id = $1
        AND invitation_hash = $2
        AND revoked_at IS NULL
        AND claimed_at IS NULL
        AND device_hash IS NULL
        AND expires_at IS NULL
        AND invitation_expires_at > now()
      RETURNING id
    `,
    [userId, invitationHash, deviceHash],
  );

  if (result.rows.length !== 1) {
    return null;
  }

  return {
    deviceId: result.rows[0].id,
    deviceToken,
  };
}

export async function claimTokenOnlyInvitation(
  query: RoleClaimQuery,
  invitationToken: string,
): Promise<{
  deviceId: string;
  deviceToken: string;
  userId: string;
  role: Exclude<UserRole, "Admin">;
} | null> {
  let invitationHash: string;

  try {
    invitationHash = hashDeviceToken(invitationToken, "invitation");
  } catch {
    return null;
  }

  const deviceToken = createDeviceToken();
  const deviceHash = hashDeviceToken(deviceToken, "browser");

  const result = await query(
    `
      UPDATE ahu_private.access_devices AS d
      SET device_hash = $2,
          claimed_at = now(),
          expires_at = now() + interval '90 days'
      FROM ahu_private.users AS u
      WHERE d.user_id = u.id
        AND u.role <> 'Admin'
        AND d.invitation_hash = $1
        AND d.revoked_at IS NULL
        AND d.claimed_at IS NULL
        AND d.device_hash IS NULL
        AND d.expires_at IS NULL
        AND d.invitation_expires_at > now()
      RETURNING d.id, u.id AS user_id, u.role
    `,
    [invitationHash, deviceHash],
  );

  if (result.rows.length !== 1) {
    return null;
  }

  const row = result.rows[0];
  if (
    row.role === "Admin" ||
    !USER_ROLES.some((r) => r === row.role)
  ) {
    return null;
  }

  return {
    deviceId: row.id,
    deviceToken,
    userId: row.user_id,
    role: row.role as Exclude<UserRole, "Admin">,
  };
}
