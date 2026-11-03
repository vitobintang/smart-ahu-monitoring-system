import { authorizeRequest, type AuthorizationDependencies } from "./authorized-request";
import { readLoginRequestBody } from "./login-request-body";
import type { LoginPreflightResult } from "./login-preflight";
import type { LoginInput } from "./login-input";
import type { UserRole } from "./ahu";

// UNWIRED: this is not a route and it never sends a response or writes cookies.
// The future password provider MUST use an isolated session, verify the identity
// with Supabase, stage rather than publish cookies, and implement safe discard.
// A session must never be logged or sent to the browser except as secure cookies.
export type StagedLogin<Session> = {
  verifiedUserId: string;
  takeSession: () => Session;
  discard: () => Promise<void>;
};
export type LoginDependencies<Session> = {
  checkGateway: () => Promise<LoginPreflightResult>;
  stagePassword: (input: LoginInput) => Promise<StagedLogin<Session> | null>;
  getProfile: AuthorizationDependencies["getProfile"];
  isBrowserAuthorized: AuthorizationDependencies["isBrowserAuthorized"];
};
export type LoginDecision<Session> =
  | { ok: false; status: 400 | 401 | 403 | 429 | 503; retryAfterSeconds?: number }
  | { ok: true; user: { id: string; role: UserRole }; takeSession: () => Session };

export async function evaluatePasswordLogin<Session>(
  request: Request,
  deviceToken: unknown,
  deps: LoginDependencies<Session>,
): Promise<LoginDecision<Session>> {
  let candidate: StagedLogin<Session> | null = null;
  let accepted = false;
  try {
    if (request.method !== "POST") return { ok: false, status: 400 };
    const gate = await deps.checkGateway();
    if (!gate || typeof gate !== "object") return { ok: false, status: 503 };
    if (gate.ok !== true) {
      if (gate.ok !== false) return { ok: false, status: 503 };
      if (gate.status === 403 || gate.status === 503) return { ok: false, status: gate.status };
      if (gate.status === 429 && Number.isSafeInteger(gate.retryAfterSeconds) &&
          gate.retryAfterSeconds! > 0 && gate.retryAfterSeconds! <= 86400) {
        return { ok: false, status: 429, retryAfterSeconds: gate.retryAfterSeconds };
      }
      return { ok: false, status: 503 };
    }
    const input = await readLoginRequestBody(request);
    if (!input) return { ok: false, status: 400 };
    // Browser tokens use the existing app's exact 32-byte lowercase hex format.
    if (typeof deviceToken !== "string" || !/^[a-f0-9]{64}$/.test(deviceToken)) {
      return { ok: false, status: 401 };
    }
    candidate = await deps.stagePassword(input);
    if (!candidate) return { ok: false, status: 401 };
    if (typeof candidate.verifiedUserId !== "string" ||
        typeof candidate.takeSession !== "function" || typeof candidate.discard !== "function") {
      return { ok: false, status: 503 };
    }
    const user = await authorizeRequest({
      getVerifiedUser: async () => ({ id: candidate!.verifiedUserId }),
      getProfile: deps.getProfile,
      isBrowserAuthorized: deps.isBrowserAuthorized,
    }, deviceToken, "monitoring:read");
    if (!user) return { ok: false, status: 401 };

    // The caller may take the staged session only once after successful checks.
    // Real cookie publication and stale-cookie cleanup are deliberately absent.
    const approved = candidate;
    let taken = false;
    const takeSession = () => {
      if (taken) throw new Error("Staged session already taken");
      taken = true;
      return approved.takeSession();
    };
    accepted = true;
    return { ok: true, user, takeSession };
  } catch {
    return { ok: false, status: 503 };
  } finally {
    if (candidate && !accepted && typeof candidate.discard === "function") {
      try { await candidate.discard(); } catch { /* deny even if cleanup fails */ }
    }
  }
}