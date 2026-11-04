import { USER_ROLES, type UserRole } from "./ahu";
import { hasPermission, type Permission } from "./permissions";

export type LoginMode = "admin" | "token";

export type ParsedLoginPayload =
  | { ok: true; mode: "admin"; email: string; password: string }
  | { ok: true; mode: "token"; token: string }
  | { ok: false; error: string };

export function isAdminRole(role: unknown): role is "Admin" {
  return role === "Admin";
}

export function isTokenRole(
  role: unknown,
): role is Exclude<UserRole, "Admin"> {
  return (
    typeof role === "string" &&
    role !== "Admin" &&
    USER_ROLES.some((r) => r === role)
  );
}

export function buildTokenAccountEmail(fullName: string, id: string): string {
  const slug =
    fullName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "member";
  const suffix = id.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 8) || "user";
  return `${slug}-${suffix}@token.local`;
}

export function isSyntheticTokenEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith("@token.local");
}

export function parseLoginPayload(body: unknown): ParsedLoginPayload {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Invalid request payload" };
  }

  const record = body as {
    mode?: unknown;
    email?: unknown;
    password?: unknown;
    token?: unknown;
    deviceToken?: unknown;
  };

  const email = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
  const password = typeof record.password === "string" ? record.password : "";
  const rawToken =
    typeof record.token === "string" && record.token.trim()
      ? record.token.trim()
      : typeof record.deviceToken === "string"
        ? record.deviceToken.trim()
        : "";

  const wantsTokenMode =
    record.mode === "token" || (record.mode !== "admin" && !email && !password && Boolean(rawToken));

  if (wantsTokenMode) {
    if (!rawToken) {
      return { ok: false, error: "Access token is required" };
    }
    return { ok: true, mode: "token", token: rawToken };
  }

  if (!email || !password) {
    return { ok: false, error: "Email and password are required" };
  }

  return { ok: true, mode: "admin", email, password };
}

export type RoleSessionDependencies<TUser extends { id: string; role: UserRole }> = {
  getSupabaseUserId: () => Promise<string | null>;
  getUserById: (id: string) => Promise<TUser | null>;
  getAuthorizedTokenUser: () => Promise<TUser | null>;
};

/**
 * Resolves the active session according to role authentication rules:
 * - Admin: authenticated solely via Supabase Auth email/password (no device token).
 * - Engineering, Operator, Viewer: authenticated solely via an Admin-issued browser token.
 */
export async function resolveRoleSession<TUser extends { id: string; role: UserRole }>(
  deps: RoleSessionDependencies<TUser>,
): Promise<TUser | null> {
  try {
    const authUserId = await deps.getSupabaseUserId();
    if (authUserId && authUserId.trim() && authUserId.length <= 128) {
      const adminCandidate = await deps.getUserById(authUserId);
      if (adminCandidate && adminCandidate.id === authUserId && isAdminRole(adminCandidate.role)) {
        return adminCandidate;
      }
    }
  } catch {
    // Fall through to token-based session check for non-Admin roles.
  }

  try {
    const tokenCandidate = await deps.getAuthorizedTokenUser();
    if (tokenCandidate && isTokenRole(tokenCandidate.role)) {
      return tokenCandidate;
    }
  } catch {
    return null;
  }

  return null;
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
