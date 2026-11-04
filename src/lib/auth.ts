import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { randomHex, randomId, safeEqual } from "@/lib/ids";
import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
import type { Role, UserRow } from "@/db/schema";
import { type Activity, can } from "@/lib/domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthorizedDeviceUser, revokeCurrentDeviceCookie } from "@/lib/device-access";
import { resolveRoleSession } from "@/lib/role-auth";

export const CSRF_COOKIE = "ahu_csrf";

export interface SessionContext {
  user: UserRow;
}

/**
 * Resolve session by role authentication policy:
 * - Admin: verified Supabase Auth email/password session (no device token required).
 * - Engineering, Operator, Viewer: verified Admin-issued browser token cookie (no email/password).
 * Never trust client-editable user metadata for authorization.
 */
export async function getSession(): Promise<SessionContext | null> {
  const user = await resolveRoleSession<UserRow>({
    getSupabaseUserId: async () => {
      const supabase = await createSupabaseServerClient();
      const {
        data: { user: authUser },
        error,
      } = await supabase.auth.getUser();
      return error || !authUser ? null : authUser.id;
    },
    getUserById: async (id) => {
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return row ?? null;
    },
    getAuthorizedTokenUser: () => getAuthorizedDeviceUser(),
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
/* Rate limiting                                                      */
/* ------------------------------------------------------------------ */

type Bucket = { hits: number[] };
const globalForRl = globalThis as typeof globalThis & { __rl?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = (globalForRl.__rl ??= new Map<string, Bucket>());

export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
): { allowed: boolean; remaining: number; retryAfterSec: number } {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= max) {
    const oldest = bucket.hits[0] ?? now;
    buckets.set(key, bucket);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.ceil((windowMs - (now - oldest)) / 1000),
    };
  }
  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { allowed: true, remaining: max - bucket.hits.length, retryAfterSec: 0 };
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

export function hasRole(role: Role | string, activity: Activity): boolean {
  return can(role, activity);
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
    fullName: u.fullName,
    role: u.role,
    createdAt: u.createdAt,
  };
}
