import { secretHash } from "@/lib/auth";
import { normalizeLoginIp } from "@/lib/login-rate-key";


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
    now?: Date;
    max?: number;
    windowMs?: number;
  },
): Promise<LoginRateReservation> {
  // Phase 5c: the per-IP bucket lives exclusively in RTDB (transactional
  // increment, identical window semantics to the retired SQL upsert).
  const { requireRtdb } = await import("@/lib/rtdb/live-read");
  const rtdb = await requireRtdb();
  const { reserveRtdbLoginAttempt } = await import("@/lib/rtdb/security");
  return reserveRtdbLoginAttempt(rtdb, rateKey, {
    now: opts?.now?.getTime(),
    max: opts?.max,
    windowMs: opts?.windowMs,
  });
}

/**
 * Releases ONLY the single reservation acquired by a successful login so:
 * 1) Legitimate users/QA switching roles on the same IP never exhaust the bucket.
 * 2) Prior failed attempts in the same 15-minute window are preserved and CANNOT
 *    be cleared by signing in with a low-privilege member token.
 */
export async function releaseLoginAttempt(rateKey: string): Promise<void> {
  // Phase 5c: RTDB-only (see reserveLoginAttempt).
  const { tryGetAhuRtdb } = await import("@/lib/rtdb/live-read");
  const rtdb = await tryGetAhuRtdb();
  if (!rtdb) throw new Error("Firebase RTDB is not configured");
  const { releaseRtdbLoginAttempt } = await import("@/lib/rtdb/security");
  await releaseRtdbLoginAttempt(rtdb, rateKey);
}
