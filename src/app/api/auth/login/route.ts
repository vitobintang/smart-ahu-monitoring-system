import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getClientIp, safePublicUser, sameOrigin, setCsrfCookie, writeAudit } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { claimDeviceByToken, clearDeviceCookie } from "@/lib/device-access";
import {
  canonicalizeClientIp,
  deriveLoginIpRateKey,
  releaseLoginAttempt,
  reserveLoginAttempt,
} from "@/lib/login-rate-limiter";
import { isAdminRole, parseLoginPayload } from "@/lib/role-auth";

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
      userEmail: parsed.mode === "admin" ? parsed.email : null,
      action: "LOGIN_RATE_LIMITED",
      entity: "auth",
      ipAddress: ip,
      details: {
        method: parsed.mode === "admin" ? "password" : "token",
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

  if (parsed.mode === "token") {
    const user = await claimDeviceByToken(parsed.token, ip);
    if (!user) {
      await writeAudit({
        action: "LOGIN_FAILED",
        entity: "auth",
        ipAddress: ip,
        details: { method: "token" },
      });
      return Response.json(
        {
          error:
            "Invalid, expired, or already-used access token. Ask your administrator for a new token.",
        },
        { status: 401 },
      );
    }

    try {
      const supabase = await createSupabaseServerClient();
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      /* no active Supabase Auth session */
    }

    await releaseLoginAttempt(rateKey);
    const csrfToken = await setCsrfCookie();
    await writeAudit({
      userId: user.id,
      userEmail: user.email,
      action: "LOGIN_SUCCESS",
      entity: "auth",
      ipAddress: ip,
      details: { role: user.role, method: "token" },
    });
    return Response.json({ ok: true, user: safePublicUser(user), csrfToken });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.email,
    password: parsed.password,
  });
  if (error || !data.user) {
    await writeAudit({
      userEmail: parsed.email,
      action: "LOGIN_FAILED",
      entity: "auth",
      ipAddress: ip,
      details: { method: "password" },
    });
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const [user] = await db.select().from(users).where(eq(users.id, data.user.id)).limit(1);
  if (!user) {
    await supabase.auth.signOut({ scope: "local" });
    await writeAudit({
      userEmail: parsed.email,
      action: "LOGIN_FAILED",
      entity: "auth",
      ipAddress: ip,
      details: { method: "password", reason: "unassigned_role" },
    });
    return Response.json(
      { error: "Account has no assigned role. Contact an administrator." },
      { status: 403 },
    );
  }

  if (!isAdminRole(user.role)) {
    await supabase.auth.signOut({ scope: "local" });
    await writeAudit({
      userId: user.id,
      userEmail: user.email,
      action: "LOGIN_FAILED",
      entity: "auth",
      ipAddress: ip,
      details: { role: user.role, method: "password", reason: "non_admin_password_login_blocked" },
    });
    return Response.json(
      {
        error:
          "Email and password sign-in is only for Administrators. Please sign in using an access token from an administrator.",
      },
      { status: 403 },
    );
  }

  await clearDeviceCookie();
  await releaseLoginAttempt(rateKey);
  const csrfToken = await setCsrfCookie();
  await writeAudit({
    userId: user.id,
    userEmail: user.email,
    action: "LOGIN_SUCCESS",
    entity: "auth",
    ipAddress: ip,
    details: { role: user.role, method: "password" },
  });
  return Response.json({ ok: true, user: safePublicUser(user), csrfToken });
}
