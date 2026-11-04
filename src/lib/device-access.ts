import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { accessDevices, auditLogs, users, type UserRow } from "@/db/schema";
import { randomHex, randomId } from "@/lib/ids";

export const DEVICE_COOKIE = "ahu_device";
const DEVICE_DAYS = 90;

export async function secretHash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Bearer proof is bound to a user, not guaranteed to be uncopyable hardware. */
export async function authorizedDevice(userId: string): Promise<boolean> {
  const secret = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) return false;
  const [row] = await db
    .select({ id: accessDevices.id })
    .from(accessDevices)
    .where(
      and(
        eq(accessDevices.userId, userId),
        eq(accessDevices.deviceHash, await secretHash(secret)),
        isNull(accessDevices.revokedAt),
        gt(accessDevices.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Resolve the non-Admin user authenticated by the current browser token cookie. */
export async function getAuthorizedDeviceUser(): Promise<UserRow | null> {
  const secret = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) return null;
  const [row] = await db
    .select({ user: users })
    .from(accessDevices)
    .innerJoin(users, eq(accessDevices.userId, users.id))
    .where(
      and(
        eq(accessDevices.deviceHash, await secretHash(secret)),
        isNull(accessDevices.revokedAt),
        gt(accessDevices.expiresAt, new Date()),
        ne(users.role, "Admin"),
      ),
    )
    .limit(1);
  return row?.user ?? null;
}

/** Atomically consume an invitation so two browsers cannot both claim it. */
export async function claimDevice(userId: string, invitation: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(invitation)) return false;
  const secret = randomHex(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEVICE_DAYS * 86400_000);
  const invitationHash = await secretHash(invitation);
  const deviceHash = await secretHash(secret);
  const rows = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(accessDevices)
      .set({ deviceHash, claimedAt: now, expiresAt })
      .where(
        and(
          eq(accessDevices.userId, userId),
          eq(accessDevices.invitationHash, invitationHash),
          isNull(accessDevices.revokedAt),
          isNull(accessDevices.claimedAt),
          gt(accessDevices.invitationExpiresAt, now),
        ),
      )
      .returning({ id: accessDevices.id });
    if (claimed.length) {
      await tx.insert(auditLogs).values({
        id: randomId(),
        userId,
        action: "ACCESS_DEVICE_CLAIMED",
        entity: `access-device:${claimed[0].id}`,
        details: { expiresAt: expiresAt.toISOString() },
      });
    }
    return claimed;
  });
  if (!rows.length) return false;
  (await cookies()).set(DEVICE_COOKIE, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return true;
}

/**
 * Atomically claim a one-time access token for a non-Admin role (Engineering,
 * Operator, or Viewer) without requiring email or password.
 */
export async function claimDeviceByToken(
  invitation: string,
  ipAddress?: string | null,
): Promise<UserRow | null> {
  if (!/^[a-f0-9]{64}$/.test(invitation)) return null;
  const secret = randomHex(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEVICE_DAYS * 86400_000);
  const invitationHash = await secretHash(invitation);
  const deviceHash = await secretHash(secret);

  const claimedUser = await db.transaction(async (tx) => {
    const [target] = await tx
      .select({
        deviceId: accessDevices.id,
        user: users,
      })
      .from(accessDevices)
      .innerJoin(users, eq(accessDevices.userId, users.id))
      .where(
        and(
          eq(accessDevices.invitationHash, invitationHash),
          ne(users.role, "Admin"),
          isNull(accessDevices.revokedAt),
          isNull(accessDevices.claimedAt),
          gt(accessDevices.invitationExpiresAt, now),
        ),
      )
      .limit(1);
    if (!target) return null;

    const claimed = await tx
      .update(accessDevices)
      .set({ deviceHash, claimedAt: now, expiresAt })
      .where(
        and(
          eq(accessDevices.id, target.deviceId),
          isNull(accessDevices.revokedAt),
          isNull(accessDevices.claimedAt),
          gt(accessDevices.invitationExpiresAt, now),
        ),
      )
      .returning({ id: accessDevices.id });
    if (!claimed.length) return null;

    await tx.insert(auditLogs).values({
      id: randomId(),
      userId: target.user.id,
      userEmail: target.user.email,
      action: "ACCESS_DEVICE_CLAIMED",
      entity: `access-device:${claimed[0].id}`,
      ipAddress: ipAddress ?? null,
      details: { role: target.user.role, expiresAt: expiresAt.toISOString() },
    });
    return target.user;
  });

  if (!claimedUser) return null;
  (await cookies()).set(DEVICE_COOKIE, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return claimedUser;
}

/** Revoke the active browser authorization on logout and clear the cookie. */
export async function revokeCurrentDeviceCookie(): Promise<void> {
  const store = await cookies();
  const secret = store.get(DEVICE_COOKIE)?.value;
  if (secret && /^[a-f0-9]{64}$/.test(secret)) {
    const deviceHash = await secretHash(secret);
    await db
      .update(accessDevices)
      .set({ revokedAt: new Date() })
      .where(and(eq(accessDevices.deviceHash, deviceHash), isNull(accessDevices.revokedAt)));
  }
  store.delete(DEVICE_COOKIE);
}

export async function clearDeviceCookie(): Promise<void> {
  (await cookies()).delete(DEVICE_COOKIE);
}
