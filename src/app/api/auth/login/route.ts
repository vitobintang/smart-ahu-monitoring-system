import { sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getClientIp, invalidateSessionCache, safePublicUser, sameOrigin, setCsrfCookie, writeAudit } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { clearDeviceCookie } from "@/lib/device-access";
import {
  canonicalizeClientIp,
  deriveLoginIpRateKey,
  releaseLoginAttempt,
  reserveLoginAttempt,
} from "@/lib/login-rate-limiter";
import { resolveOrLinkAppUserForAuthUser } from "@/lib/oauth-account";
import { parseLoginPayload } from "@/lib/role-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await sameOrigin())) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const rawIp = await getClientIp();
  const ip = canonicalizeClientIp(rawIp);

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseLoginPayload(rawBody);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  // NFR-02: Unified per-IP rate limit (max 10 attempts per 15 minutes per IP)
  const rateKey = await deriveLoginIpRateKey(ip);
  const reservation = await reserveLoginAttempt(rateKey);
  if (!reservation.allowed) {
    await writeAudit({
      userEmail: parsed.identifierType === "email" ? parsed.identifier : null,
      action: "LOGIN_RATE_LIMITED",
      entity: "auth",
      ipAddress: ip,
      details: {
        identifierType: parsed.identifierType,
        identifier: parsed.identifier,
        retryAfterSec: reservation.retryAfterSec,
      },
    });
    return Response.json(
      { error: "Too many login attempts from this IP. Please wait before trying again." },
      {
        status: 429,
        headers: { "Retry-After": String(reservation.retryAfterSec) },
      },
    );
  }

  // Resolve username -> email when signing in with a username substitute
  let loginEmail = parsed.identifier;
  if (parsed.identifierType === "username") {
    const [matched] = await db
      .select({ email: users.email })
      .from(users)
      .where(sql`lower(${users.username}) = ${parsed.identifier}`)
      .limit(1);
    if (!matched) {
      await writeAudit({
        action: "LOGIN_FAILED",
        entity: "auth",
        ipAddress: ip,
        details: { identifierType: "username", identifier: parsed.identifier },
      });
      return Response.json({ error: "Invalid email/username or password" }, { status: 401 });
    }
    loginEmail = matched.email;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: loginEmail,
    password: parsed.password,
  });
  if (error || !data.user) {
    await writeAudit({
      userEmail: loginEmail,
      action: "LOGIN_FAILED",
      entity: "auth",
      ipAddress: ip,
      details: { identifierType: parsed.identifierType },
    });
    return Response.json({ error: "Invalid email/username or password" }, { status: 401 });
  }

  const user = await resolveOrLinkAppUserForAuthUser({
    id: data.user.id,
    email: data.user.email ?? loginEmail,
    emailConfirmed: Boolean(data.user.email_confirmed_at),
    fullName:
      (typeof data.user.user_metadata?.full_name === "string" && data.user.user_metadata.full_name) || null,
  });
  if (!user) {
    await supabase.auth.signOut({ scope: "local" });
    await writeAudit({
      userEmail: loginEmail,
      action: "LOGIN_FAILED",
      entity: "auth",
      ipAddress: ip,
      details: { identifierType: parsed.identifierType, reason: "unassigned_role" },
    });
    return Response.json(
      { error: "Account has no assigned role. Contact an administrator." },
      { status: 403 },
    );
  }

  invalidateSessionCache();
  await clearDeviceCookie();
  await releaseLoginAttempt(rateKey);
  const csrfToken = await setCsrfCookie();
  await writeAudit({
    userId: user.id,
    userEmail: user.email,
    action: "LOGIN_SUCCESS",
    entity: "auth",
    ipAddress: ip,
    details: {
      role: user.role,
      username: user.username ?? null,
      identifierType: parsed.identifierType,
      provider: "password",
    },
  });
  return Response.json({ ok: true, user: safePublicUser(user), csrfToken });
}
