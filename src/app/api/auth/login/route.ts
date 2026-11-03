import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { loginAttempts, users } from "@/db/schema";
import { LOGIN_RATE_LIMIT } from "@/lib/domain";
import { getClientIp, safePublicUser, sameOrigin, setCsrfCookie, writeAudit } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { authorizedDevice, claimDevice, secretHash } from "@/lib/device-access";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await sameOrigin())) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const ip = await getClientIp();
  let body: { email?: string; password?: string; deviceToken?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || !body.password)
    return Response.json({ error: "Email and password are required" }, { status: 400 });

  const rateKey = await secretHash(email);
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
  if (attempt.count > LOGIN_RATE_LIMIT.max) {
    return Response.json(
      { error: "Too many login attempts. Please wait before trying again." },
      { status: 429 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: body.password });
  if (error || !data.user) {
    await writeAudit({ userEmail: email, action: "LOGIN_FAILED", entity: "auth", ipAddress: ip });
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

  const alreadyAuthorized = await authorizedDevice(user.id);
  const claimed =
    !alreadyAuthorized && body.deviceToken
      ? await claimDevice(user.id, body.deviceToken.trim())
      : false;
  if (!alreadyAuthorized && !claimed) {
    await supabase.auth.signOut({ scope: "local" });
    await writeAudit({
      userId: user.id,
      userEmail: user.email,
      action: "DEVICE_ACCESS_DENIED",
      entity: "auth",
      ipAddress: ip,
    });
    return Response.json(
      {
        error:
          "This browser is not authorized. Enter a valid one-time device token from an administrator.",
      },
      { status: 403 },
    );
  }

  await db.delete(loginAttempts).where(eq(loginAttempts.key, rateKey));
  const csrfToken = await setCsrfCookie();
  await writeAudit({
    userId: user.id,
    userEmail: user.email,
    action: "LOGIN_SUCCESS",
    entity: "auth",
    ipAddress: ip,
    details: { role: user.role },
  });
  return Response.json({ ok: true, user: safePublicUser(user), csrfToken });
}