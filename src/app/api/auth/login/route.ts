import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { loginAttempts, users } from "@/db/schema";
import { LOGIN_RATE_LIMIT } from "@/lib/domain";
import { getClientIp, safePublicUser, sameOrigin, setCsrfCookie, writeAudit } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { claimDeviceByToken, clearDeviceCookie, secretHash } from "@/lib/device-access";
import { isAdminRole, parseLoginPayload } from "@/lib/role-auth";

export const dynamic = "force-dynamic";

async function allowLoginAttempt(rateKey: string): Promise<boolean> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - LOGIN_RATE_LIMIT.windowMs);
  const [attempt] = await db
    .insert(loginAttempts)
    .values({ key: rateKey, count: 1, windowStart: now })
    .onConflictDoUpdate({
      target: loginAttempts.key,
      set: {
        count: sql`case when ${loginAttempts.windowStart} < ${cutoff} then 1 else ${loginAttempts.count} + 1 end`,
        windowStart: sql`case when ${loginAttempts.windowStart} < ${cutoff} then ${now} else ${loginAttempts.windowStart} end`,
      },
    })
    .returning({ count: loginAttempts.count });
  return attempt.count <= LOGIN_RATE_LIMIT.max;
}

export async function POST(req: Request) {
  if (!(await sameOrigin())) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const ip = await getClientIp();
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

  if (parsed.mode === "token") {
    const rateKey = await secretHash(`token-ip:${ip ?? "unknown"}`);
    if (!(await allowLoginAttempt(rateKey))) {
      return Response.json(
        { error: "Too many login attempts. Please wait before trying again." },
        { status: 429 },
      );
    }

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

    await db.delete(loginAttempts).where(eq(loginAttempts.key, rateKey));
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

  const rateKey = await secretHash(parsed.email);
  if (!(await allowLoginAttempt(rateKey))) {
    return Response.json(
      { error: "Too many login attempts. Please wait before trying again." },
      { status: 429 },
    );
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
  await db.delete(loginAttempts).where(eq(loginAttempts.key, rateKey));
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
