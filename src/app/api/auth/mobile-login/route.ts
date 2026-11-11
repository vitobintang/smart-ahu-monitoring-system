import { getClientIp, safePublicUser, writeAudit } from "@/lib/auth";
import { getFirebaseClientConfig } from "@/lib/firebase/config";
import { stageFirebasePassword } from "@/lib/firebase/password-auth";
import { getFirebaseAuth, getAhuRtdb } from "@/lib/firebase/admin";
import { getRtdbUserByEmail, getRtdbUserByUsername } from "@/lib/rtdb/users";
import { isAllowedMobileOrigin } from "@/lib/mobile-origins";
import {
  canonicalizeClientIp,
  deriveLoginIpRateKey,
  releaseLoginAttempt,
  reserveLoginAttempt,
} from "@/lib/login-rate-limiter";
import { parseLoginPayload } from "@/lib/role-auth";

export const dynamic = "force-dynamic";

/** Native login exchange: credentials are checked server-side and a short-lived
 * Firebase custom token is returned for Firebase's SDK to exchange/store. */
export async function POST(req: Request) {
  if (!isAllowedMobileOrigin(req.headers.get("origin"))) {
    return Response.json({ error: "Invalid mobile app origin" }, { status: 403 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = parseLoginPayload(rawBody);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const ip = canonicalizeClientIp(await getClientIp());
  const rateKey = await deriveLoginIpRateKey(ip);
  const reservation = await reserveLoginAttempt(rateKey);
  if (!reservation.allowed) {
    await writeAudit({
      userEmail: parsed.identifierType === "email" ? parsed.identifier : null,
      action: "LOGIN_RATE_LIMITED",
      entity: "auth",
      ipAddress: ip,
      details: { identifierType: parsed.identifierType, native: true, retryAfterSec: reservation.retryAfterSec },
    });
    return Response.json(
      { error: "Too many login attempts from this IP. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(reservation.retryAfterSec) } },
    );
  }

  let loginEmail = parsed.identifier;
  if (parsed.identifierType === "username") {
    const matched = await getRtdbUserByUsername(await getAhuRtdb(), parsed.identifier).catch(() => null);
    if (!matched) {
      await writeAudit({
        action: "LOGIN_FAILED",
        entity: "auth",
        ipAddress: ip,
        details: { identifierType: "username", native: true },
      });
      return Response.json({ error: "Invalid email/username or password" }, { status: 401 });
    }
    loginEmail = matched.email;
  }

  let staged: Awaited<ReturnType<typeof stageFirebasePassword>>;
  try {
    staged = await stageFirebasePassword(
      { email: loginEmail, password: parsed.password },
      { apiKey: getFirebaseClientConfig().apiKey },
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
      details: { identifierType: parsed.identifierType, native: true },
    });
    return Response.json({ error: "Invalid email/username or password" }, { status: 401 });
  }

  try {
    const profile = await getRtdbUserByEmail(await getAhuRtdb(), loginEmail).catch(() => null);
    if (!profile || profile.id !== staged.verifiedUserId) {
      await writeAudit({
        userEmail: loginEmail,
        action: "LOGIN_FAILED",
        entity: "auth",
        ipAddress: ip,
        details: { identifierType: parsed.identifierType, reason: "unassigned_role", native: true },
      });
      return Response.json({ error: "Account has no assigned role. Contact an administrator." }, { status: 403 });
    }

    const customToken = await (await getFirebaseAuth()).createCustomToken(profile.id);
    await releaseLoginAttempt(rateKey);
    await writeAudit({
      userId: profile.id,
      userEmail: profile.email,
      action: "LOGIN_SUCCESS",
      entity: "auth",
      ipAddress: ip,
      details: { role: profile.role, identifierType: parsed.identifierType, provider: "password", native: true },
    });
    return Response.json(
      { ok: true, customToken, user: safePublicUser(profile) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Authentication unavailable. Try again shortly." }, { status: 503 });
  } finally {
    await staged.discard();
  }
}
