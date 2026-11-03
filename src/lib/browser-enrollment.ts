import { USER_ROLES, type UserRole } from "./ahu";
import { claimBrowserInvitation, type ClaimQuery } from "./device-claims";
import { validateLoginInput, type LoginInput } from "./login-input";
import type { LoginPreflightResult } from "./login-preflight";
import { readEnrollmentJson } from "./enrollment-request-body";
import type { StagedLogin } from "./login-orchestrator";
import { hasPermission } from "./permissions";

// UNWIRED: does not publish cookies or implement first-Admin bootstrap.
// A claimed invitation can be lost if response/cookie delivery fails or the DB
// commit outcome is unknown. Do not blindly retry; an Admin must review,
// revoke the uncertain authorization and issue a new invitation.
export type EnrollmentInput = LoginInput & { invitationToken: string };
export type EnrollmentDependencies<Session> = {
  checkGateway: () => Promise<LoginPreflightResult>;
  stagePassword: (input: LoginInput) => Promise<StagedLogin<Session> | null>;
  getProfile: (userId: string) => Promise<{ id: string; role: unknown } | null>;
  claimQuery: ClaimQuery;
};
export type EnrollmentDecision<Session> =
  | { ok: false; status: 400 | 401 | 403 | 429 | 503; retryAfterSeconds?: number }
  | { ok: true; user: { id: string; role: UserRole }; takeCredentials: () => { session: Session; deviceToken: string } };

export function validateEnrollmentInput(value: unknown): EnrollmentInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>; const keys = Object.keys(item);
  if (keys.length !== 3 || !keys.includes("email") || !keys.includes("password") || !keys.includes("invitationToken")) return null;
  if (typeof item.invitationToken !== "string" || !/^[a-f0-9]{64}$/.test(item.invitationToken)) return null;
  const login = validateLoginInput({ email: item.email, password: item.password });
  return login ? { ...login, invitationToken: item.invitationToken } : null;
}

export async function evaluateBrowserEnrollment<Session>(request: Request, deps: EnrollmentDependencies<Session>): Promise<EnrollmentDecision<Session>> {
  let candidate: StagedLogin<Session> | null = null; let accepted = false;
  try {
    if (request.method !== "POST") return { ok: false, status: 400 };
    const gate = await deps.checkGateway();
    if (!gate || typeof gate !== "object") return { ok: false, status: 503 };
    if (gate.ok !== true) {
      if (gate.ok !== false) return { ok: false, status: 503 };
      if (gate.status === 403 || gate.status === 503) return { ok: false, status: gate.status };
      if (gate.status === 429 && Number.isSafeInteger(gate.retryAfterSeconds) && gate.retryAfterSeconds! > 0 && gate.retryAfterSeconds! <= 86400)
        return { ok: false, status: 429, retryAfterSeconds: gate.retryAfterSeconds };
      return { ok: false, status: 503 };
    }
    const input = validateEnrollmentInput(await readEnrollmentJson(request));
    if (!input) return { ok: false, status: 400 };
    candidate = await deps.stagePassword({ email: input.email, password: input.password });
    if (!candidate) return { ok: false, status: 401 };
    if (typeof candidate.verifiedUserId !== "string" || !candidate.verifiedUserId.trim() || candidate.verifiedUserId.length > 128 ||
        typeof candidate.takeSession !== "function" || typeof candidate.discard !== "function") return { ok: false, status: 503 };
    const id = candidate.verifiedUserId;
    let profile: Awaited<ReturnType<EnrollmentDependencies<Session>["getProfile"]>>;
    try { profile = await deps.getProfile(id); } catch { return { ok: false, status: 401 }; }
    if (!profile || profile.id !== id || !USER_ROLES.some((role) => role === profile!.role) || !hasPermission(profile.role, "monitoring:read")) return { ok: false, status: 401 };
    let claim: Awaited<ReturnType<typeof claimBrowserInvitation>>;
    try { claim = await claimBrowserInvitation(deps.claimQuery, id, input.invitationToken); } catch { return { ok: false, status: 401 }; }
    if (!claim) return { ok: false, status: 401 };
    const approved = candidate; const deviceToken = claim.deviceToken; let taken = false;
    const takeCredentials = () => { if (taken) throw new Error("Enrollment credentials already taken"); taken = true; return { session: approved.takeSession(), deviceToken }; };
    accepted = true;
    return { ok: true, user: { id, role: profile.role as UserRole }, takeCredentials };
  } catch { return { ok: false, status: 503 }; }
  finally { if (candidate && !accepted && typeof candidate.discard === "function") { try { await candidate.discard(); } catch { /* deny */ } } }
}
