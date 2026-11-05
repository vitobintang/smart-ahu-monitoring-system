import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { accessDevices } from "@/db/schema";

export const DEVICE_COOKIE = "ahu_device";

export async function secretHash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
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
