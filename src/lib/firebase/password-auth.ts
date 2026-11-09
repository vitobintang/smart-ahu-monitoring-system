import type { LoginInput } from "@/lib/login-input";
import type { StagedLogin } from "@/lib/login-orchestrator";

/**
 * Firebase Authentication password sign-in for the staged login pipeline.
 *
 * Firebase has no server-side password-verification SDK method, so the server
 * performs sign-in through Google's public Identity Toolkit REST endpoint using
 * the project's web API key — the same key browsers use. The resulting ID token
 * is then exchanged server-side (Phase 1b) for a Firebase session cookie via
 * the Admin SDK; this module only stages the verified identity.
 *
 * Mirrors stageSupabasePassword's contract so login-orchestrator needs zero
 * changes: null = bad credentials (→401), throw = auth unavailable (→503).
 */

export interface FirebaseStagedSession {
  /** Firebase Auth uid (== the RTDB users/{uid} key). */
  uid: string;
  email: string;
  /** One-hour ID token; Phase 1b exchanges it for a session cookie. */
  idToken: string;
}

interface IdentityToolkitSuccess {
  localId: string;
  email: string;
  idToken: string;
  registered: boolean;
  expiresIn?: string;
  displayName?: string;
}

interface IdentityToolkitError {
  error?: { message?: string };
}

const SIGN_IN_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword";

/** Errors that mean "wrong credentials / unusable account" — not an outage. */
const INVALID_CREDENTIAL_CODES = new Set([
  "EMAIL_NOT_FOUND",
  "INVALID_PASSWORD",
  "INVALID_LOGIN_CREDENTIALS",
  "INVALID_IDP_RESPONSE",
  "USER_DISABLED",
  "OPERATION_NOT_ALLOWED",
]);

/** Google-side throttling — surfaced as an availability failure (→429/503 upstream). */
const RATE_LIMIT_CODES = new Set([
  "TOO_MANY_ATTEMPTS_TRY_LATER",
  "EXCEEDED_RETRY_LIMIT",
]);

export function getIdentityToolkitUrl(apiKey: string): string {
  if (!/^AIza[0-9A-Za-z_-]{30,50}$/.test(apiKey)) throw new Error("Invalid Firebase web API key format");
  return `${SIGN_IN_URL}?key=${encodeURIComponent(apiKey)}`;
}

export async function stageFirebasePassword(
  input: LoginInput,
  options: { apiKey: string; fetch?: typeof fetch },
): Promise<StagedLogin<FirebaseStagedSession> | null> {
  const apiKey = options.apiKey;
  const email = input.email?.trim();
  const password = input.password;
  if (!email || !password) return null;

  const boundedFetch = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await boundedFetch(getIdentityToolkitUrl(apiKey), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Authentication unavailable");
  }

  if (response.status === 400 || response.status === 401 || response.status === 403) {
    let code = "";
    try {
      const body = (await response.json()) as IdentityToolkitError;
      code = body.error?.message?.split(":")[0]?.trim() ?? "";
    } catch { /* body unreadable — treat as invalid */ }
    if (RATE_LIMIT_CODES.has(code)) throw new Error("Authentication rate limited");
    return null;
  }
  if (!response.ok) throw new Error("Authentication unavailable");

  let data: IdentityToolkitSuccess;
  try {
    data = (await response.json()) as IdentityToolkitSuccess;
  } catch {
    throw new Error("Authentication unavailable");
  }
  if (
    typeof data.localId !== "string" || !data.localId ||
    typeof data.email !== "string" || !data.email ||
    typeof data.idToken !== "string" || data.idToken.length < 20 ||
    data.idToken.split(".").length !== 3
  ) {
    throw new Error("Authentication unavailable");
  }

  // Nothing to revoke server-side: an unused ID token simply expires (~1 h).
  // Discard therefore only clears the staged value from this process.
  let staged: FirebaseStagedSession | null = {
    uid: data.localId,
    email: data.email,
    idToken: data.idToken,
  };
  let finished = false;
  return {
    verifiedUserId: data.localId,
    takeSession() {
      if (finished || !staged) throw new Error("Staged session unavailable");
      finished = true;
      const session = staged;
      staged = null;
      return session;
    },
    async discard() {
      finished = true;
      staged = null;
    },
  };
}
