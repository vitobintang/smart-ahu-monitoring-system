import { createDeviceToken, hashDeviceToken } from "./device-tokens";

export type ClaimQuery = (
  text: string,
  values: string[],
) => Promise<{ rows: { id: string }[] }>;

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

