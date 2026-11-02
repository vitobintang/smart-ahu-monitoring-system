import { USER_ROLES, type UserRole } from "./ahu";
import { hasPermission } from "./permissions";

export type AuthorizationDependencies = {
  getVerifiedUser: () => Promise<{ id: string } | null>;

  getProfile: (
    userId: string,
  ) => Promise<{ id: string; role: unknown } | null>;

  isBrowserAuthorized: (
    userId: string,
    deviceToken: string,
  ) => Promise<boolean>;
};

export async function authorizeRequest(
  deps: AuthorizationDependencies,
  deviceToken: unknown,
  permission: unknown,
): Promise<{ id: string; role: UserRole } | null> {
  if (typeof deviceToken !== "string" || !deviceToken) {
    return null;
  }

  try {
    const identity = await deps.getVerifiedUser();

    if (
      !identity ||
      typeof identity.id !== "string" ||
      !identity.id.trim() ||
      identity.id.length > 128
    ) {
      return null;
    }

    const profile = await deps.getProfile(identity.id);

    if (
      !profile ||
      profile.id !== identity.id ||
      !USER_ROLES.some((role) => role === profile.role)
    ) {
      return null;
    }

    if (!hasPermission(profile.role, permission)) {
      return null;
    }

    if ((await deps.isBrowserAuthorized(identity.id, deviceToken)) !== true) {
      return null;
    }

    return {
      id: identity.id,
      role: profile.role as UserRole,
    };
  } catch {
    // Do not grant access when authentication or database checks fail.
    return null;
  }
}