import { getClientIp, invalidateSessionCache, sameOrigin, setCsrfCookie, writeAudit } from "@/lib/auth";

import { createRelinkCustomToken, verifyGoogleIdToken } from "@/lib/firebase/provision";
import { publishSessionCookie } from "@/lib/firebase/session";
import { getAhuRtdb } from "@/lib/firebase/admin";
import { getRtdbUserByEmail } from "@/lib/rtdb/users";

export const dynamic = "force-dynamic";

interface GoogleBody {
  idToken?: string;
  relinkTokenIdToken?: string;
}

/**
 * Firebase Google Sign-In (popup flow).
 * 1. POST { idToken } from the browser popup → verify → the RTDB account with
 *    that email must exist (Admin-registered).
 * 2. Same uid → session cookie published. Different uid (Google created a fresh
 *    Auth user for an already-registered email) → the duplicate is removed and a
 *    one-time relink custom token is returned so the client can re-authenticate
 *    AS the original account, then calls POST { relinkTokenIdToken }.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return Response.json({ error: "Invalid request origin" }, { status: 403 });

  let body: GoogleBody;
  try {
    body = (await req.json()) as GoogleBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const idToken = body.relinkTokenIdToken ?? body.idToken;
  if (!idToken) return Response.json({ error: "idToken is required" }, { status: 400 });

  const verified = await verifyGoogleIdToken(idToken);
  if (!verified || !verified.email) {
    return Response.json({ error: "Invalid or expired Google credential" }, { status: 401 });
  }

  const profile = await getRtdbUserByEmail(await getAhuRtdb(), verified.email).catch(() => null);
  if (!profile) {
    return Response.json(
      { error: "This Google account is not registered yet. Ask an Administrator to add your email in Admin → Users first.", code: "email_not_registered" },
      { status: 401 },
    );
  }

  const ip = await getClientIp();

  if (profile.id !== verified.uid) {
    // The popup created a duplicate Firebase Auth user — remove it and relink
    // the browser to the original account via a one-time custom token.
    try {
      const { deleteFirebaseAuthUser } = await import("@/lib/firebase/provision");
      await deleteFirebaseAuthUser(verified.uid);
      const relinkToken = await createRelinkCustomToken(profile.id);
      return Response.json({ ok: true, relinkToken, uid: profile.id });
    } catch {
      await writeAudit({
        userId: profile.id,
        userEmail: profile.email,
        action: "LOGIN_FAILED",
        entity: "auth",
        ipAddress: ip,
        details: { provider: "google", reason: "relink_failed" },
      });
      return Response.json({ error: "Google Sign-In could not be linked. Use your password." }, { status: 500 });
    }
  }

  try {
    await publishSessionCookie(idToken);
  } catch {
    return Response.json({ error: "Authentication unavailable. Try again shortly." }, { status: 503 });
  }

  invalidateSessionCache();
  {
    const cookieStore = await (await import("next/headers")).cookies();
    cookieStore.delete("ahu_device");
  }
  const csrfToken = await setCsrfCookie();
  await writeAudit({
    userId: profile.id,
    userEmail: profile.email,
    action: "LOGIN_SUCCESS",
    entity: "auth",
    ipAddress: ip,
    details: { role: profile.role, username: profile.username, provider: "google" },
  });
  return Response.json({ ok: true, user: { id: profile.id, email: profile.email, username: profile.username, fullName: profile.fullName, role: profile.role, createdAt: profile.createdAt }, csrfToken });
}
