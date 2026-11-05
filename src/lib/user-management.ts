import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { accessDevices, users } from "@/db/schema";
import type { Role, UserRow } from "@/db/schema";
import { invalidateSessionCache, safePublicUser, writeAudit } from "@/lib/auth";
import { ROLES } from "@/lib/domain";
import { isAdminRole } from "@/lib/role-auth";

type DbClient = typeof db;

export const NON_ADMIN_ROLES: readonly Role[] = ["Engineering", "Operator", "Viewer"];

export type UserLifecycleResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

/**
 * FR-20 / FR-29: Update a user's role (across Engineering / Operator / Viewer)
 * and/or display name, invalidating cached sessions immediately and recording
 * an immutable audit entry.
 */
export async function updateManagedUser(
  input: {
    actor: Pick<UserRow, "id" | "email">;
    targetUserId: string;
    role?: string;
    fullName?: string;
    ipAddress?: string | null;
  },
  client: DbClient = db,
): Promise<UserLifecycleResult<{ user: ReturnType<typeof safePublicUser> }>> {
  const targetId = input.targetUserId.trim();
  if (!targetId) {
    return { ok: false, status: 400, error: "Target userId is required" };
  }

  let nextRole: Role | undefined;
  if (input.role !== undefined) {
    if (!ROLES.includes(input.role as Role)) {
      return { ok: false, status: 400, error: `Role must be one of: ${ROLES.join(", ")}` };
    }
    nextRole = input.role as Role;
  }

  let nextFullName: string | null | undefined;
  if (input.fullName !== undefined) {
    const trimmed = input.fullName.trim();
    if (trimmed.length > 120) {
      return { ok: false, status: 400, error: "Full name must be at most 120 characters" };
    }
    nextFullName = trimmed || null;
  }

  if (nextRole === undefined && nextFullName === undefined) {
    return { ok: false, status: 400, error: "No user changes specified" };
  }

  const outcome = await client.transaction(async (tx): Promise<UserLifecycleResult<{ user: UserRow }>> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('users:admin_guard', 0))`);
    const [target] = await tx.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) {
      return { ok: false, status: 404, error: "User account not found" };
    }

    const effectiveRole = nextRole ?? target.role;
    const effectiveFullName = nextFullName !== undefined ? nextFullName : target.fullName;

    if (isAdminRole(target.role) && !isAdminRole(effectiveRole)) {
      if (target.id === input.actor.id) {
        return {
          ok: false,
          status: 409,
          error: "You cannot demote your own active Administrator account.",
        };
      }
      return {
        ok: false,
        status: 400,
        error:
          "Administrator accounts sign in with email and password and cannot be converted to token-only roles. Create a non-Admin token member instead.",
      };
    }

    if (!isAdminRole(target.role) && isAdminRole(effectiveRole)) {
      return {
        ok: false,
        status: 400,
        error:
          "Token-only members do not have email/password credentials and cannot be promoted directly to Admin. Create a dedicated Admin account with email and password instead.",
      };
    }

    if (!isAdminRole(effectiveRole) && !effectiveFullName) {
      return {
        ok: false,
        status: 400,
        error: "Member name is required for non-Admin roles (1–120 characters)",
      };
    }

    const [updated] = await tx
      .update(users)
      .set({
        role: effectiveRole,
        fullName: effectiveFullName,
      })
      .where(eq(users.id, target.id))
      .returning();

    const action = target.role !== updated.role ? "USER_ROLE_CHANGED" : "USER_UPDATED";
    await writeAudit(
      {
        userId: input.actor.id,
        userEmail: input.actor.email,
        action,
        entity: `user:${target.id}`,
        ipAddress: input.ipAddress ?? null,
        details: {
          previousRole: target.role,
          role: updated.role,
          previousFullName: target.fullName,
          fullName: updated.fullName,
        },
      },
      tx,
    );

    return { ok: true, status: 200, data: { user: updated } };
  });

  if (!outcome.ok) return outcome;
  invalidateSessionCache();
  return {
    ok: true,
    status: outcome.status,
    data: { user: safePublicUser(outcome.data.user) },
  };
}

/**
 * FR-20 / FR-29: Immediately revokes all active browser sessions and unclaimed
 * one-time tokens for a non-Admin member without deleting their user record.
 */
export async function revokeAllUserSessions(
  input: {
    actor: Pick<UserRow, "id" | "email">;
    targetUserId: string;
    ipAddress?: string | null;
    now?: Date;
  },
  client: DbClient = db,
): Promise<UserLifecycleResult<{ revokedCount: number }>> {
  const targetId = input.targetUserId.trim();
  if (!targetId) {
    return { ok: false, status: 400, error: "Target userId is required" };
  }
  const now = input.now ?? new Date();

  const outcome = await client.transaction(
    async (tx): Promise<UserLifecycleResult<{ revokedCount: number }>> => {
      const [target] = await tx.select().from(users).where(eq(users.id, targetId)).limit(1);
      if (!target) {
        return { ok: false, status: 404, error: "User account not found" };
      }

      const revoked = await tx
        .update(accessDevices)
        .set({ revokedAt: now })
        .where(and(eq(accessDevices.userId, target.id), isNull(accessDevices.revokedAt)))
        .returning({ id: accessDevices.id });

      await writeAudit(
        {
          userId: input.actor.id,
          userEmail: input.actor.email,
          action: "USER_SESSIONS_REVOKED",
          entity: `user:${target.id}`,
          ipAddress: input.ipAddress ?? null,
          details: {
            role: target.role,
            fullName: target.fullName,
            revokedCount: revoked.length,
          },
        },
        tx,
      );

      return { ok: true, status: 200, data: { revokedCount: revoked.length } };
    },
  );

  if (!outcome.ok) return outcome;
  invalidateSessionCache();
  return outcome;
}

/**
 * FR-20 / FR-29: Removes a user account with strict self-lockout and last-Admin
 * protection. Cascades access_devices while preserving historical audit_logs,
 * alarms, and trend_alerts.
 */
export async function removeManagedUser(
  input: {
    actor: Pick<UserRow, "id" | "email">;
    targetUserId: string;
    ipAddress?: string | null;
    deleteSupabaseAuthUser?: (userId: string) => Promise<void>;
  },
  client: DbClient = db,
): Promise<UserLifecycleResult<{ removedUserId: string; role: Role }>> {
  const targetId = input.targetUserId.trim();
  if (!targetId) {
    return { ok: false, status: 400, error: "Target userId is required" };
  }
  if (targetId === input.actor.id) {
    return {
      ok: false,
      status: 409,
      error: "You cannot remove your own currently signed-in Administrator account.",
    };
  }

  let deletedTarget: UserRow | null = null;
  const outcome = await client.transaction(
    async (tx): Promise<UserLifecycleResult<{ removedUserId: string; role: Role }>> => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('users:admin_guard', 0))`);
      const [target] = await tx.select().from(users).where(eq(users.id, targetId)).limit(1);
      if (!target) {
        return { ok: false, status: 404, error: "User account not found" };
      }

      if (isAdminRole(target.role)) {
        const admins = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.role, "Admin"));
        if (admins.length <= 1) {
          return {
            ok: false,
            status: 409,
            error: "Cannot remove the last remaining Administrator account.",
          };
        }
      }

      const activeTokens = await tx
        .select({ id: accessDevices.id })
        .from(accessDevices)
        .where(and(eq(accessDevices.userId, target.id), isNull(accessDevices.revokedAt)));

      await tx.delete(users).where(eq(users.id, target.id));
      deletedTarget = target;

      await writeAudit(
        {
          userId: input.actor.id,
          userEmail: input.actor.email,
          action: "USER_REMOVED",
          entity: `user:${target.id}`,
          ipAddress: input.ipAddress ?? null,
          details: {
            email: target.email,
            fullName: target.fullName,
            role: target.role,
            revokedActiveTokens: activeTokens.length,
          },
        },
        tx,
      );

      return { ok: true, status: 200, data: { removedUserId: target.id, role: target.role } };
    },
  );

  if (!outcome.ok) return outcome;
  invalidateSessionCache();

  if (deletedTarget && isAdminRole((deletedTarget as UserRow).role) && input.deleteSupabaseAuthUser) {
    try {
      await input.deleteSupabaseAuthUser((deletedTarget as UserRow).id);
    } catch (err) {
      console.warn(
        "[AHU] Removed Admin DB row but Supabase Auth cleanup reported an error:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return outcome;
}
