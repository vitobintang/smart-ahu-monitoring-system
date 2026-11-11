import type { LoginInput } from "@/lib/login-input";
/** A staged, not-yet-committed login session (was login-orchestrator's contract). */
export type StagedLogin<Session> = {
  verifiedUserId: string;
  takeSession: () => Session;
  discard: () => Promise<void>;
};

/**
 * Firebase Authentication password sign-in for the staged login pipeline.
 *
 * Firebase has no server-side password-verification SDK method, so the server
 * performs sign-in through Google's public Identity Toolkit REST endpoint using
 * the project's web API key — the same key browsers use. The resulting ID token
 * is then exchanged server-side (Phase 1b) for a Firebase session cookie via
 * the Admin SDK; this module only stages the verified identity.
 *
 * Mirrors the legacy staged-password contract so the login orchestrator needs zero
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

/** Google-side throttling — surfaced as an availability failure (→429/503 upstream). */
const RATE_LIMIT_CODES = new Set([
  "TOO_MANY_ATTEMPTS_TRY_LATER",
  "EXCEEDED_RETRY_LIMIT",
]);

export type PasswordAuthFailureReason =
  | "invalid_api_key_format"
  | "identity_toolkit_request_failed"
  | "identity_toolkit_http_error"
  | "identity_toolkit_invalid_response"
  | "rate_limited";

/** Safe diagnostic metadata; never includes credentials, tokens, or request URLs. */
export class FirebasePasswordAuthError extends Error {
  constructor(
    readonly reason: PasswordAuthFailureReason,
    readonly upstreamStatus?: number,
  ) {
    super(reason === "rate_limited" ? "Authentication rate limited" : "Authentication unavailable");
    this.name = "FirebasePasswordAuthError";
  }
}

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

  let url: string;
  try {
    url = getIdentityToolkitUrl(apiKey);
  } catch {
    throw new FirebasePasswordAuthError("invalid_api_key_format");
  }
  const boundedFetch = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await boundedFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new FirebasePasswordAuthError("identity_toolkit_request_failed");
  }

  if (response.status === 400 || response.status === 401 || response.status === 403) {
    let code = "";
    try {
      const body = (await response.json()) as IdentityToolkitError;
      code = body.error?.message?.split(":")[0]?.trim() ?? "";
    } catch { /* body unreadable — treat as invalid */ }
    if (RATE_LIMIT_CODES.has(code)) throw new FirebasePasswordAuthError("rate_limited", response.status);
    return null;
  }
  if (!response.ok) {
    throw new FirebasePasswordAuthError("identity_toolkit_http_error", response.status);
  }

  let data: IdentityToolkitSuccess;
  try {
    data = (await response.json()) as IdentityToolkitSuccess;
  } catch {
    throw new FirebasePasswordAuthError("identity_toolkit_invalid_response", response.status);
  }
  if (
    typeof data.localId !== "string" || !data.localId ||
    typeof data.email !== "string" || !data.email ||
    typeof data.idToken !== "string" || data.idToken.length < 20 ||
    data.idToken.split(".").length !== 3
  ) {
    throw new FirebasePasswordAuthError("identity_toolkit_invalid_response", response.status);
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
