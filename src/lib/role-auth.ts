import { USER_ROLES, type UserRole } from "./ahu";
import { hasPermission, type Permission } from "./permissions";

export type LoginIdentifierType = "email" | "username";

export type ParsedLoginPayload =
  | {
      ok: true;
      identifierType: LoginIdentifierType;
      identifier: string;
      password: string;
    }
  | { ok: false; error: string };

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidUserRole(role: unknown): role is UserRole {
  return typeof role === "string" && USER_ROLES.some((r) => r === role);
}

export function isAdminRole(role: unknown): role is "Admin" {
  return role === "Admin";
}

export function normalizeUsername(
  raw: unknown,
): { ok: true; username: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "Username is required" };
  }
  const username = raw.trim().toLowerCase();
  if (username.length < 3 || username.length > 32) {
    return {
      ok: false,
      error: "Username must be 3–32 characters long",
    };
  }
  if (!USERNAME_PATTERN.test(username)) {
    return {
      ok: false,
      error:
        "Username may contain only letters, numbers, dots (.), underscores (_), and hyphens (-), and must start and end with a letter or number",
    };
  }
  return { ok: true, username };
}

export function suggestUsernameFromEmail(email: string): string {
  const localPart = (email.split("@")[0] ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  if (localPart.length >= 3) {
    return localPart.slice(0, 32).replace(/[._-]+$/g, "") || "ahuuser";
  }
  return (localPart + "user").slice(0, 32);
}

/**
 * Parses credential sign-in payloads for ALL roles (Admin, Engineering, Operator, Viewer).
 * Accepts `identifier` (email or username), `email`, or `username` + `password`.
 * User accounts never sign in with tokens; tokens are reserved strictly for AHU
 * telemetry monitoring modules (`POST /api/devices` / `POST /api/telemetry`).
 */
export function parseLoginPayload(body: unknown): ParsedLoginPayload {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Invalid request payload" };
  }

  const record = body as {
    mode?: unknown;
    identifier?: unknown;
    email?: unknown;
    username?: unknown;
    password?: unknown;
    token?: unknown;
    deviceToken?: unknown;
  };

  if (
    record.mode === "token" ||
    (typeof record.token === "string" && record.token.trim().length > 0) ||
    (typeof record.deviceToken === "string" && record.deviceToken.trim().length > 0)
  ) {
    return {
      ok: false,
      error:
        "All user roles sign in with Email or Username and Password. Tokens are only used to connect AHU monitoring modules.",
    };
  }

  const rawIdentifier =
    typeof record.identifier === "string" && record.identifier.trim()
      ? record.identifier.trim()
      : typeof record.email === "string" && record.email.trim()
        ? record.email.trim()
        : typeof record.username === "string" && record.username.trim()
          ? record.username.trim()
          : "";

  const password = typeof record.password === "string" ? record.password : "";

  if (!rawIdentifier || !password) {
    return { ok: false, error: "Email or username and password are required" };
  }

  if (rawIdentifier.length > 254 || password.length > 256) {
    return { ok: false, error: "Invalid credentials" };
  }

  if (rawIdentifier.includes("@")) {
    const email = rawIdentifier.toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      return { ok: false, error: "Enter a valid email address or username" };
    }
    return { ok: true, identifierType: "email", identifier: email, password };
  }

  const normalized = normalizeUsername(rawIdentifier);
  if (!normalized.ok) {
    return { ok: false, error: "Enter a valid email address or username" };
  }

  return {
    ok: true,
    identifierType: "username",
    identifier: normalized.username,
    password,
  };
}

export type RoleSessionDependencies<TUser extends { id: string; role: UserRole }> = {
  getSupabaseUserId: () => Promise<string | null>;
  getUserById: (id: string) => Promise<TUser | null>;
};

/**
 * Resolves the active session for ALL roles (Admin, Engineering, Operator, Viewer)
 * exclusively from a verified Supabase Auth session matched against `ahu_private.users`.
 */
export async function resolveRoleSession<TUser extends { id: string; role: UserRole }>(
  deps: RoleSessionDependencies<TUser>,
): Promise<TUser | null> {
  try {
    const authUserId = await deps.getSupabaseUserId();
    if (!authUserId || !authUserId.trim() || authUserId.length > 128) {
      return null;
    }
    const candidate = await deps.getUserById(authUserId);
    if (!candidate || candidate.id !== authUserId || !isValidUserRole(candidate.role)) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

export async function authorizeRolePermission<TUser extends { id: string; role: UserRole }>(
  deps: RoleSessionDependencies<TUser>,
  permission: Permission,
): Promise<{ id: string; role: UserRole } | null> {
  const user = await resolveRoleSession(deps);
  if (!user || !hasPermission(user.role, permission)) {
    return null;
  }
  return { id: user.id, role: user.role };
}
