import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { accessDevices, auditLogs } from "@/db/schema";
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