import { getDatabasePool } from "../db/connection";
import { USER_ROLES, type UserRole } from "./ahu";
import type { Permission } from "./permissions";
import { authorizeRolePermission } from "./role-auth";
import { createSupabaseServerClient } from "./supabase/server";

export async function authorizeServerRequest(permission: Permission) {
  return authorizeRolePermission<{ id: string; role: UserRole }>(
    {
      getSupabaseUserId: async () => {
        const supabase = await createSupabaseServerClient();
        const { data, error } = await supabase.auth.getUser();
        return error || !data.user ? null : data.user.id;
      },
      getUserById: async (userId) => {
        const result = await getDatabasePool().query<{
          id: string;
          role: string;
        }>("SELECT id, role FROM ahu_private.users WHERE id = $1 LIMIT 1", [
          userId,
        ]);
        const row = result.rows[0];
        if (!row || !USER_ROLES.some((r) => r === row.role)) {
          return null;
        }
        return { id: row.id, role: row.role as UserRole };
      },
    },
    permission,
  );
}
