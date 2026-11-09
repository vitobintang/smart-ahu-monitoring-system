import { getClientIp, invalidateSessionCache, safePublicUser, sameOrigin, setCsrfCookie, writeAudit } from "@/lib/auth";
import { getFirebaseClientConfig } from "@/lib/firebase/config";
import { stageFirebasePassword } from "@/lib/firebase/password-auth";
import { publishSessionCookie } from "@/lib/firebase/session";
import { getAhuRtdb } from "@/lib/firebase/admin";

import { getRtdbUserByEmail, getRtdbUserByUsername } from "@/lib/rtdb/users";
import {
  canonicalizeClientIp,
  deriveLoginIpRateKey,
  releaseLoginAttempt,
  reserveLoginAttempt,
} from "@/lib/login-rate-limiter";
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

  // Resolve username -> email when signing in with a username substitute (RTDB mirror)
  let loginEmail = parsed.identifier;
  if (parsed.identifierType === "username") {
    const matched = await getRtdbUserByUsername(await getAhuRtdb(), parsed.identifier).catch(() => null);
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

  const config = getFirebaseClientConfig();
  let staged: Awaited<ReturnType<typeof stageFirebasePassword>>;
  try {
    staged = await stageFirebasePassword(
      { email: loginEmail, password: parsed.password },
      { apiKey: config.apiKey },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("rate limited")) {
      return Response.json(
        { error: "Too many failed sign-in attempts. Please wait and try again." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    return Response.json({ error: "Authentication unavailable. Try again shortly." }, { status: 503 });
  }
  if (!staged) {
    await writeAudit({
      userEmail: loginEmail,
      action: "LOGIN_FAILED",
      entity: "auth",
      ipAddress: ip,
      details: { identifierType: parsed.identifierType },
    });
    return Response.json({ error: "Invalid email/username or password" }, { status: 401 });
  }

  // The RTDB profile is the authorization source: no profile -> no session.
  const profile = await getRtdbUserByEmail(await getAhuRtdb(), loginEmail).catch(() => null);
  if (!profile || profile.id !== staged.verifiedUserId) {
    await staged.discard();
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
  const user = profile;
  try {
    const session = staged.takeSession();
    await publishSessionCookie(session.idToken);
  } catch {
    await staged.discard();
    return Response.json({ error: "Authentication unavailable. Try again shortly." }, { status: 503 });
  }
  await staged.discard();

  invalidateSessionCache();
  const cookieStore = await (await import("next/headers")).cookies();
  cookieStore.delete("ahu_device");
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
