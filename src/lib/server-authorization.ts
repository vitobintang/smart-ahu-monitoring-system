import { USER_ROLES, type UserRole } from "./ahu";
import type { Permission } from "./permissions";
import { authorizeRolePermission } from "./role-auth";
import { getRtdbUserById } from "./rtdb/users";
import type { RtdbAdapter } from "./rtdb/store";

async function ahuRtdb(): Promise<RtdbAdapter> {
  const { getAhuRtdb } = await import("./firebase/admin");
  return getAhuRtdb();
}

async function verifiedUid(): Promise<string | null> {
  const { readVerifiedSession } = await import("./firebase/session");
  const verified = await readVerifiedSession();
  return verified?.uid ?? null;
}

export async function authorizeServerRequest(permission: Permission) {
  return authorizeRolePermission<{ id: string; role: UserRole }>(
    {
      getSupabaseUserId: verifiedUid,
      getUserById: async (userId) => {
        const profile = await getRtdbUserById(await ahuRtdb(), userId);
        if (!profile || !USER_ROLES.some((r) => r === profile.role)) return null;
        return { id: profile.id, role: profile.role as UserRole };
      },
    },
    permission,
  );
}
