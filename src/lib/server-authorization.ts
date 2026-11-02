import { cookies } from "next/headers";

import { getDatabasePool, queryDeviceRecords } from "../db/connection";
import { authorizeRequest } from "./authorized-request";
import { isBrowserAuthorized } from "./device-verification";
import type { Permission } from "./permissions";
import { createSupabaseServerClient } from "./supabase/server";

export async function authorizeServerRequest(permission: Permission) {
  const cookieStore = await cookies();
  const deviceToken = cookieStore.get("ahu_device")?.value;

  return authorizeRequest(
    {
      getVerifiedUser: async () => {
        const supabase = await createSupabaseServerClient();
        const { data, error } = await supabase.auth.getUser();

        if (error || !data.user) {
          return null;
        }

        return { id: data.user.id };
      },

      getProfile: async (userId) => {
        const result = await getDatabasePool().query<{
          id: string;
          role: string;
        }>(
          "SELECT id, role FROM ahu_private.users WHERE id = $1 LIMIT 1",
          [userId],
        );

        return result.rows[0] ?? null;
      },

      isBrowserAuthorized: (userId, token) =>
        isBrowserAuthorized(queryDeviceRecords, userId, token),
    },
    deviceToken,
    permission,
  );
}