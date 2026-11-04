import { USER_ROLES, type UserRole } from "./ahu";
import type { ClaimQuery } from "./device-claims";
import { hashDeviceToken } from "./device-tokens";

export type RoleVerificationQuery = (
  text: string,
  values: string[],
) => Promise<{ rows: { id: string; role: string }[] }>;

export async function isBrowserAuthorized(
  query: ClaimQuery,
  userId: string,
  deviceToken: string,
): Promise<boolean> {
  if (typeof userId !== "string" || !userId.trim() || userId.length > 128) {
    return false;
  }

  let deviceHash: string;

  try {
    deviceHash = hashDeviceToken(deviceToken, "browser");
  } catch {
    return false;
  }

  const result = await query(
    `
      SELECT id
      FROM ahu_private.access_devices
      WHERE user_id = $1
        AND device_hash = $2
        AND claimed_at IS NOT NULL
        AND revoked_at IS NULL
        AND expires_at > now()
      LIMIT 1
    `,
    [userId, deviceHash],
  );

  return result.rows.length === 1;
}

export async function getAuthorizedTokenBrowser(
  query: RoleVerificationQuery,
  deviceToken: string | undefined,
): Promise<{ id: string; role: Exclude<UserRole, "Admin"> } | null> {
  if (!deviceToken) {
    return null;
  }

  let deviceHash: string;

  try {
    deviceHash = hashDeviceToken(deviceToken, "browser");
  } catch {
    return null;
  }

  const result = await query(
    `
      SELECT u.id, u.role
      FROM ahu_private.access_devices AS d
      INNER JOIN ahu_private.users AS u ON u.id = d.user_id
      WHERE d.device_hash = $1
        AND d.claimed_at IS NOT NULL
        AND d.revoked_at IS NULL
        AND d.expires_at > now()
        AND u.role <> 'Admin'
      LIMIT 1
    `,
    [deviceHash],
  );

  if (result.rows.length !== 1) {
    return null;
  }

  const row = result.rows[0];
  if (row.role === "Admin" || !USER_ROLES.some((r) => r === row.role)) {
    return null;
  }

  return {
    id: row.id,
    role: row.role as Exclude<UserRole, "Admin">,
  };
}
