import type { ClaimQuery } from "./device-claims";
import { hashDeviceToken } from "./device-tokens";

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