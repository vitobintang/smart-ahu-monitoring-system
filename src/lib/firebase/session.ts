import { cookies } from "next/headers";
import type { Auth } from "firebase-admin/auth";

async function auth(): Promise<Auth> {
  const { getFirebaseAuth } = await import("./admin");
  return getFirebaseAuth();
}

export type SessionCookieOperationStage =
  | "admin_auth_initialization"
  | "admin_create_session_cookie"
  | "next_cookie_write";

/** Carries stage-only metadata while keeping the original failure out of logs/responses. */
export class SessionCookieOperationError extends Error {
  constructor(
    readonly stage: SessionCookieOperationStage,
    readonly originalError: unknown,
  ) {
    super("Firebase session-cookie operation failed");
    this.name = "SessionCookieOperationError";
  }
}

/**
 * Firebase session-cookie session management.
 *
 * Flow: the browser authenticates once (Email/Password REST sign-in →
 * ID token), the server exchanges the ID token for a short-lived session cookie
 * via the Admin SDK, and every later request is verified from that httpOnly
 * cookie — no token ever touches localStorage.
 */

export const SESSION_COOKIE = "__session";
/** Firebase allows 5 minutes..14 days; 5 days balances security and UX. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 5;

export interface VerifiedFirebaseSession {
  uid: string;
  email: string | null;
}

/** Pure shape helper (unit-tested): the cookie attributes we always publish. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

/**
 * Exchanges a verified ID token for a Firebase session cookie value.
 * Injectable so tests can run without a service account.
 */
export async function mintSessionCookieValue(idToken: string): Promise<string> {
  let firebaseAuth: Auth;
  try {
    firebaseAuth = await auth();
  } catch (error) {
    throw new SessionCookieOperationError("admin_auth_initialization", error);
  }
  try {
    return await firebaseAuth.createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE_SECONDS * 1000,
    });
  } catch (error) {
    throw new SessionCookieOperationError("admin_create_session_cookie", error);
  }
}

/** Verifies a session cookie value; injectable for tests. Returns null when invalid/expired. */
export async function verifySessionCookieValue(value: string): Promise<VerifiedFirebaseSession | null> {
  if (typeof value !== "string" || value.length < 20 || value.split(".").length !== 3) return null;
  try {
    const decoded = await (await auth()).verifySessionCookie(value, true);
    if (typeof decoded.uid !== "string" || !decoded.uid) return null;
    return { uid: decoded.uid, email: typeof decoded.email === "string" ? decoded.email : null };
  } catch {
    return null;
  }
}

/** Reads + verifies the incoming session cookie, or null when signed out. */
export async function readVerifiedSession(): Promise<VerifiedFirebaseSession | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return null;
  return verifySessionCookieValue(value);
}

/** Publishes the session cookie after a successful server-side login. */
export async function publishSessionCookie(idToken: string): Promise<void> {
  const value = await mintSessionCookieValue(idToken);
  try {
    (await cookies()).set(SESSION_COOKIE, value, sessionCookieOptions());
  } catch (error) {
    throw new SessionCookieOperationError("next_cookie_write", error);
  }
}

/** Clears the session cookie (logout / rejected login). */
export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
