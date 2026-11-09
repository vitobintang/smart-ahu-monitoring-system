import type { RtdbAdapter } from "./store";

/**
 * Login rate limiting (Phase 5b) — previously the PostgreSQL `login_attempts`
 * table (NFR-02: max attempts per client-IP hash per 15-minute window).
 *
 * Tree layout:
 *   loginAttempts/{rateKey} → { key, count, windowStart (epoch-ms) }
 *
 * `rateKey` is a SHA-256 hash of the canonical client IP, so the key is
 * RTDB-safe (hex only). Semantics match the PostgreSQL upsert exactly:
 * - reserve: create/patch the bucket; if the stored window has expired the
 *   counter restarts at 1 with a fresh windowStart, else it increments.
 * - release: decrement exactly one reservation (the successful login's);
 *   the bucket is deleted when it reaches zero.
 *
 * Both operations are RTDB transactions, so concurrent logons from the same
 * IP serialize server-side just like the SQL upsert did.
 */

export const LOGIN_ATTEMPTS_NODE = "loginAttempts";

export interface RtdbLoginBucket {
  key: string;
  count: number;
  windowStart: number;
}

export interface LoginReservation {
  allowed: boolean;
  count: number;
  remaining: number;
  retryAfterSec: number;
}

export async function reserveRtdbLoginAttempt(
  rtdb: RtdbAdapter,
  rateKey: string,
  opts?: { now?: number; max?: number; windowMs?: number },
): Promise<LoginReservation> {
  const now = opts?.now ?? Date.now();
  const max = opts?.max ?? 10;
  const windowMs = opts?.windowMs ?? 15 * 60_000;

  const { committed, value } = await rtdb.transaction<RtdbLoginBucket>(`${LOGIN_ATTEMPTS_NODE}/${rateKey}`, (current) => {
    if (!current) return { key: rateKey, count: 1, windowStart: now };
    if (current.windowStart <= now - windowMs) return { key: rateKey, count: 1, windowStart: now };
    return { key: rateKey, count: current.count + 1, windowStart: current.windowStart };
  });
  if (!committed || !value) throw new Error(`login-rate reserve failed for ${rateKey.slice(0, 8)}…`);

  const allowed = value.count <= max;
  const expiresAtMs = value.windowStart + windowMs;
  return {
    allowed,
    count: value.count,
    remaining: Math.max(0, max - value.count),
    retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((expiresAtMs - now) / 1000)),
  };
}

export async function releaseRtdbLoginAttempt(rtdb: RtdbAdapter, rateKey: string): Promise<void> {
  await rtdb.transaction<RtdbLoginBucket>(`${LOGIN_ATTEMPTS_NODE}/${rateKey}`, (current) => {
    if (!current) return undefined; // nothing reserved — abort, write nothing
    const next = Math.max(current.count - 1, 0);
    return next <= 0 ? null : { ...current, count: next }; // delete empty bucket
  });
}
