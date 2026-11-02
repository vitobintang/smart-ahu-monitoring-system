import type { ClaimQuery } from "./device-claims";

function validId(value: string): boolean {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 128
  );
}

export async function revokeBrowserAuthorization(
  query: ClaimQuery,
  issuerId: string,
  deviceId: string,
): Promise<boolean> {
  if (!validId(issuerId) || !validId(deviceId)) {
    return false;
  }

  const result = await query(
    `
      WITH authorized_admin AS (
        SELECT id
        FROM ahu_private.users
        WHERE id = $2 AND role = 'Admin'
        FOR SHARE
      )
      UPDATE ahu_private.access_devices AS device
      SET revoked_at = now()
      FROM authorized_admin
      WHERE device.id = $1
        AND device.revoked_at IS NULL
      RETURNING device.id
    `,
    [deviceId, issuerId],
  );

  return result.rows.length === 1;
}