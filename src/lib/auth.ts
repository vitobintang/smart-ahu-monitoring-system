import { cookies, headers } from "next/headers";
import { randomHex, randomId, safeEqual } from "@/lib/ids";
import type { UserRole } from "@/lib/ahu";
import { type Activity, can } from "@/lib/domain";
import { getRtdbUserById, type RtdbUser } from "@/lib/rtdb/users";
import { writeRtdbAuditLog } from "@/lib/rtdb/audit";
import type { RtdbAdapter } from "@/lib/rtdb/store";

/** SHA-256 hex digest used for cache keys and rate-limit keys. */
export async function secretHash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Firebase Admin uses Node built-ins (fs/crypto) — imported lazily so Edge
// bundles (proxy/middleware) never pull them in statically.
async function firebaseSession() {
  return import("@/lib/firebase/session");
}

async function ahuRtdb(): Promise<RtdbAdapter> {
  const { getAhuRtdb } = await import("@/lib/firebase/admin");
  return getAhuRtdb();
}

export const CSRF_COOKIE = "ahu_csrf";

/**
 * The authenticated session profile lives in RTDB (Firebase migration, Phase 1b).
 * Structurally compatible with the legacy PG UserRow for all call sites.
 */
export type SessionUser = RtdbUser & { username: string | null };

export interface SessionContext {
  user: SessionUser;
}

const SESSION_CACHE_TTL_MS = 20_000;
const globalForSessionCache = globalThis as typeof globalThis & {
  __ahuSessionCache?: Map<string, { user: SessionUser; expiresAt: number }>;
  __ahuSessionInFlight?: Map<string, Promise<SessionUser | null>>;
};
const sessionCache = (globalForSessionCache.__ahuSessionCache ??= new Map());
const sessionInFlight = (globalForSessionCache.__ahuSessionInFlight ??= new Map());

export function invalidateSessionCache() {
  sessionCache.clear();
  sessionInFlight.clear();
}

async function getProfileForUid(uid: string): Promise<SessionUser | null> {
  const profile = await getRtdbUserById(await ahuRtdb(), uid);
  if (!profile || profile.id !== uid) return null;
  if (!["Admin", "Engineering", "Operator"].includes(profile.role as UserRole)) return null;
  return profile as SessionUser;
}

async function cachedSessionUser(key: string, resolve: () => Promise<SessionUser | null>) {
  const now = Date.now();
  const cached = sessionCache.get(key);
  if (cached && cached.expiresAt > now) return cached.user;

  let pending = sessionInFlight.get(key);
  if (!pending) {
    pending = resolve()
      .catch(() => null)
      .finally(() => sessionInFlight.delete(key));
    sessionInFlight.set(key, pending);
  }
  const user = await pending;
  if (user) {
    if (sessionCache.size > 128) {
      for (const [cacheKey, value] of sessionCache.entries()) {
        if (value.expiresAt <= now) sessionCache.delete(cacheKey);
      }
      if (sessionCache.size > 128) sessionCache.clear();
    }
    sessionCache.set(key, { user, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
  } else {
    sessionCache.delete(key);
  }
  return user;
}

/**
 * Resolve the trusted role profile from either the browser's httpOnly Firebase
 * session cookie or a Firebase ID token issued to the native Capacitor client.
 * The caller never supplies role data; every credential is verified by Firebase
 * Admin and the role is reloaded from RTDB.
 */
export async function getSession(): Promise<SessionContext | null> {
  const requestHeaders = await headers();
  const authorization = requestHeaders.get("authorization");
  if (authorization !== null) {
    const match = /^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(authorization);
    if (!match) return null;
    const token = match[1];
    const cacheKey = `id-token:${await secretHash(token)}`;
    const user = await cachedSessionUser(cacheKey, async () => {
      const { getFirebaseAuth } = await import("@/lib/firebase/admin");
      const decoded = await (await getFirebaseAuth()).verifyIdToken(token, true);
      return getProfileForUid(decoded.uid);
    });
    return user ? { user } : null;
  }

  const { SESSION_COOKIE } = await firebaseSession();
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const cacheKey = `session-cookie:${await secretHash(raw)}`;
  const user = await cachedSessionUser(cacheKey, async () => {
    const { readVerifiedSession } = await firebaseSession();
    const verified = await readVerifiedSession();
    return verified ? getProfileForUid(verified.uid) : null;
  });
  return user ? { user } : null;
}

export async function setCsrfCookie() {
  const token = randomHex(24);
  (await cookies()).set(CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return token;
}

export async function destroySession() {
  invalidateSessionCache();
  const { clearSessionCookie } = await firebaseSession();
  await clearSessionCookie();
  (await cookies()).delete(CSRF_COOKIE);
}

/** Double-submit token plus same-origin validation for cookie-authenticated writes. */
export async function sameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin");
  const rawHost = h.get("x-forwarded-host") ?? h.get("host");
  const host = rawHost?.split(",")[0].trim();
  if (!origin || !host) return false;
  try {
    if (new URL(origin).host !== host) return false;
  } catch {
    return false;
  }
  return true;
}

export async function csrfValid(): Promise<boolean> {
  const requestHeaders = await headers();
  if (requestHeaders.has("authorization")) {
    // Native calls use an explicitly attached Firebase bearer token. Browsers
    // cannot attach this credential cross-site without passing the CORS preflight.
    return Boolean(await getSession());
  }
  if (!(await sameOrigin())) return false;
  const provided = requestHeaders.get("x-csrf-token");
  const token = (await cookies()).get(CSRF_COOKIE)?.value;
  return Boolean(token && provided && safeEqual(token, provided));
}

export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

/* ------------------------------------------------------------------ */
/* Audit log (FR-29) — append only                                    */
/* ------------------------------------------------------------------ */

export async function writeAudit(
  input: {
    userId?: string | null;
    userEmail?: string | null;
    action: string;
    entity: string;
    details?: Record<string, unknown>;
    ipAddress?: string | null;
  },
) {
  // Phase 5c: the audit trail is RTDB-only (auditLogs/{id}).
  const id = randomId();
  await writeRtdbAuditLog(await ahuRtdb(), {
    id,
    userId: input.userId ?? null,
    userEmail: input.userEmail ?? null,
    action: input.action,
    entity: input.entity,
    details: input.details ?? {},
    ipAddress: input.ipAddress ?? null,
    createdAt: Date.now(),
  });
}

/* ------------------------------------------------------------------ */
/* Authorization guards (FR-02 / NFR-03)                              */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Server-side guard used by every protected API route.
 * `mutating` requests additionally require a valid CSRF token.
 */
export async function requireAuth(activity: Activity, opts?: { mutating?: boolean }) {
  const ctx = await getSession();
  if (!ctx) throw new ApiError(401, "Authentication required");
  if (!can(ctx.user.role, activity))
    throw new ApiError(403, `Role ${ctx.user.role} is not permitted to ${activity}`);
  if (opts?.mutating) {
    if (!(await csrfValid())) throw new ApiError(403, "Invalid or missing CSRF token");
  }
  return ctx;
}

export function jsonError(err: unknown) {
  if (err instanceof ApiError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  return Response.json({ error: message }, { status: 500 });
}

export function safePublicUser(u: {
  id: string;
  email: string;
  username?: string | null;
  fullName: string | null;
  role: UserRole;
  createdAt: number | Date;
}) {
  return {
    id: u.id,
    email: u.email,
    username: u.username ?? null,
    fullName: u.fullName,
    role: u.role,
    createdAt: u.createdAt,
  };
}
