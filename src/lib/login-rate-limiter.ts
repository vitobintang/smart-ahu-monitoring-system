import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { loginAttempts } from "@/db/schema";
import { LOGIN_RATE_LIMIT } from "@/lib/domain";
import { secretHash } from "@/lib/device-access";
import { normalizeLoginIp } from "@/lib/login-rate-key";

type RateDbClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Canonicalizes a forwarded/real client IP string into a stable per-IP identifier:
 * - Strips optional `:port` on IPv4 (`203.0.113.5:51234` -> `203.0.113.5`) and
 *   bracketed IPv6 (`[2001:db8::1]:443` -> `2001:db8::1`).
 * - Strips optional IPv6 zone identifiers (`fe80::1%eth0` -> `fe80::1`).
 * - Collapses IPv4-mapped IPv6 (`::ffff:203.0.113.5`) onto `203.0.113.5`.
 * - Falls back safely to `"unknown"` when headers are absent in local/test runs.
 */
export function canonicalizeClientIp(rawIp: string | null | undefined): string {
  if (!rawIp) return "unknown";
  let candidate = rawIp.split(",")[0]?.trim() ?? "";
  if (!candidate || candidate.toLowerCase() === "unknown") return "unknown";

  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(candidate);
  if (bracketed) {
    candidate = bracketed[1];
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }

  const zoneIdx = candidate.indexOf("%");
  if (zoneIdx >= 0) {
    candidate = candidate.slice(0, zoneIdx);
  }

  try {
    return normalizeLoginIp(candidate);
  } catch {
    return "unknown";
  }
}

export async function deriveLoginIpRateKey(rawIp: string | null | undefined): Promise<string> {
  const canonicalIp = canonicalizeClientIp(rawIp);
  return secretHash(`login-ip:${canonicalIp}`);
}

export interface LoginRateReservation {
  allowed: boolean;
  count: number;
  remaining: number;
  retryAfterSec: number;
}

/**
 * NFR-02: Atomically reserves 1 login attempt in the per-IP 15-minute window
 * (max 10 attempts / 15 min / IP across both password and token login modes).
 */
export async function reserveLoginAttempt(
  rateKey: string,
  opts?: {
    client?: RateDbClient;
    now?: Date;
    max?: number;
    windowMs?: number;
  },
): Promise<LoginRateReservation> {
  const client = opts?.client ?? db;
  const now = opts?.now ?? new Date();
  const max = opts?.max ?? LOGIN_RATE_LIMIT.max;
  const windowMs = opts?.windowMs ?? LOGIN_RATE_LIMIT.windowMs;
  const cutoff = new Date(now.getTime() - windowMs);

  const [attempt] = await client
    .insert(loginAttempts)
    .values({ key: rateKey, count: 1, windowStart: now })
    .onConflictDoUpdate({
      target: loginAttempts.key,
      set: {
        count: sql`case when ${loginAttempts.windowStart} <= ${cutoff} then 1 else ${loginAttempts.count} + 1 end`,
        windowStart: sql`case when ${loginAttempts.windowStart} <= ${cutoff} then ${now} else ${loginAttempts.windowStart} end`,
      },
    })
    .returning({
      count: loginAttempts.count,
      windowStart: loginAttempts.windowStart,
    });

  const count = attempt?.count ?? 1;
  const windowStart = attempt?.windowStart ?? now;
  const allowed = count <= max;
  const expiresAtMs = windowStart.getTime() + windowMs;
  const retryAfterSec = allowed ? 0 : Math.max(1, Math.ceil((expiresAtMs - now.getTime()) / 1000));

  return {
    allowed,
    count,
    remaining: Math.max(0, max - count),
    retryAfterSec,
  };
}

/**
 * Releases ONLY the single reservation acquired by a successful login so:
 * 1) Legitimate users/QA switching roles on the same IP never exhaust the bucket.
 * 2) Prior failed attempts in the same 15-minute window are preserved and CANNOT
 *    be cleared by signing in with a low-privilege member token.
 */
export async function releaseLoginAttempt(
  rateKey: string,
  opts?: { client?: RateDbClient },
): Promise<void> {
  const client = opts?.client ?? db;
  const [updated] = await client
    .update(loginAttempts)
    .set({ count: sql`greatest(${loginAttempts.count} - 1, 0)` })
    .where(eq(loginAttempts.key, rateKey))
    .returning({ count: loginAttempts.count });
  if (updated && updated.count <= 0) {
    await client.delete(loginAttempts).where(eq(loginAttempts.key, rateKey));
  }
}
