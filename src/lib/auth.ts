import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { randomHex, randomId, safeEqual } from "@/lib/ids";
import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
import type { UserRow } from "@/db/schema";
import { type Activity, can } from "@/lib/domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { revokeCurrentDeviceCookie, secretHash } from "@/lib/device-access";
import { resolveOrLinkAppUserForAuthUser } from "@/lib/oauth-account";
import { resolveRoleSession } from "@/lib/role-auth";

export const CSRF_COOKIE = "ahu_csrf";

export interface SessionContext {
  user: UserRow;
}

const SESSION_CACHE_TTL_MS = 20_000;
const globalForSessionCache = globalThis as typeof globalThis & {
  __ahuSessionCache?: Map<string, { user: UserRow; expiresAt: number }>;
  __ahuSessionInFlight?: Map<string, Promise<UserRow | null>>;
};
const sessionCache = (globalForSessionCache.__ahuSessionCache ??= new Map());
const sessionInFlight = (globalForSessionCache.__ahuSessionInFlight ??= new Map());

export function invalidateSessionCache() {
  sessionCache.clear();
  sessionInFlight.clear();
}

/**
 * Resolve session by role authentication policy:
 * All roles (Admin, Engineering, Operator) authenticate via verified
 * Supabase Auth credentials (email or username + password).
 * Never trust client-editable user metadata for authorization.
 */
export async function getSession(): Promise<SessionContext | null> {
  const store = await cookies();
  const allCookies = store.getAll();
  const sbCookies = allCookies.filter((c) => c.name.startsWith("sb-"));
  if (sbCookies.length === 0) return null;

  const rawKey = sbCookies.map((c) => `${c.name}=${c.value}`).join(";");
  const cacheKey = await secretHash(rawKey);
  const now = Date.now();
  const cached = sessionCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return { user: cached.user };
  }

  let pending = sessionInFlight.get(cacheKey);
  if (!pending) {
    let verifiedAuthUser: {
      id: string;
      email?: string | null;
      emailConfirmed?: boolean;
      fullName?: string | null;
    } | null = null;
    pending = resolveRoleSession<UserRow>({
      getSupabaseUserId: async () => {
        const supabase = await createSupabaseServerClient();
        const {
          data: { user: authUser },
          error,
        } = await supabase.auth.getUser();
        if (error || !authUser) return null;
        verifiedAuthUser = {
          id: authUser.id,
          email: authUser.email ?? null,
          emailConfirmed: Boolean(authUser.email_confirmed_at || authUser.app_metadata?.provider === "google"),
          fullName:
            (typeof authUser.user_metadata?.full_name === "string" && authUser.user_metadata.full_name) ||
            (typeof authUser.user_metadata?.name === "string" && authUser.user_metadata.name) ||
            null,
        };
        return authUser.id;
      },
      getUserById: async (id) => {
        if (verifiedAuthUser && verifiedAuthUser.id === id) {
          return resolveOrLinkAppUserForAuthUser(verifiedAuthUser);
        }
        const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
        return row ?? null;
      },
    }).finally(() => {
      sessionInFlight.delete(cacheKey);
    });
    sessionInFlight.set(cacheKey, pending);
  }

  const user = await pending;
  if (user) {
    if (sessionCache.size > 128) {
      for (const [k, v] of sessionCache.entries()) {
        if (v.expiresAt <= now) sessionCache.delete(k);
      }
      if (sessionCache.size > 128) sessionCache.clear();
    }
    sessionCache.set(cacheKey, { user, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
  } else {
    sessionCache.delete(cacheKey);
  }
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
  await revokeCurrentDeviceCookie();
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch {
    /* token-only sessions may not have an active Supabase Auth session */
  }
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
  if (!(await sameOrigin())) return false;
  const provided = (await headers()).get("x-csrf-token");
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
  client: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0] = db,
) {
  await client.insert(auditLogs).values({
    id: randomId(),
    userId: input.userId ?? null,
    userEmail: input.userEmail ?? null,
    action: input.action,
    entity: input.entity,
    details: input.details ?? {},
    ipAddress: input.ipAddress ?? null,
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

export function safePublicUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    username: u.username ?? null,
    fullName: u.fullName,
    role: u.role,
    createdAt: u.createdAt,
  };
}
