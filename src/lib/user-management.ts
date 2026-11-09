import type { Role, UserRow } from "@/lib/types";
import { invalidateSessionCache, safePublicUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/role-auth";
import { requireRtdb } from "@/lib/rtdb/live-read";
import { auditRtdb } from "@/lib/rtdb/lifecycle";
import { deleteRtdbUser, getRtdbUserById, listAllRtdbUsers, type RtdbUser } from "@/lib/rtdb/users";
import { changeRtdbUsername, revokeFirebaseUserSessions } from "@/lib/firebase/provision";

export type UserLifecycleResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

function toLifecycleError(err: unknown): UserLifecycleResult<never> {
  if (err instanceof Error && /already (taken|registered|in use)/i.test(err.message)) {
    return { ok: false, status: 409, error: err.message } as never;
  }
  throw err;
}

function rtdbToPublic(user: RtdbUser): ReturnType<typeof safePublicUser> {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    createdAt: user.createdAt,
  };
}

async function countAdminsRtdb(rtdb: NonNullable<Awaited<ReturnType<typeof requireRtdb>>>): Promise<number> {
  const all = await listAllRtdbUsers(rtdb);
  return all.filter((u) => isAdminRole(u.role)).length;
}

async function applyRtdbUserFields(
  rtdb: NonNullable<Awaited<ReturnType<typeof requireRtdb>>>,
  target: RtdbUser,
  fields: { role: Role; username: string; fullName: string | null },
): Promise<RtdbUser> {
  const next: RtdbUser = { ...target, ...fields, updatedAt: Date.now() };
  const { userNode } = await import("@/lib/rtdb/users");
  await rtdb.set(userNode(target.id), next);
  return next;
}

/**
 * FR-20 / FR-29: Update any user's role (Admin, Engineering, Operator),
 * username, and/or display name with strict self-demotion and last-Admin guards.
 */
export async function updateManagedUser(input: {
  actor: Pick<UserRow, "id" | "email">;
  targetUserId: string;
  role?: string;
  username?: string;
  fullName?: string;
  ipAddress?: string | null;
}): Promise<UserLifecycleResult<{ user: ReturnType<typeof safePublicUser> }>> {
  const targetId = input.targetUserId.trim();
  if (!targetId) {
    return { ok: false, status: 400, error: "Target userId is required" };
  }

  let nextRole: Role | undefined;
  if (input.role !== undefined) {
    if (!["Admin", "Engineering", "Operator"].includes(input.role)) {
      return { ok: false, status: 400, error: `Role must be one of: Admin, Engineering, Operator` };
    }
    nextRole = input.role as Role;
  }

  let nextUsername: string | undefined;
  if (input.username !== undefined) {
    const parsed = (await import("@/lib/role-auth")).normalizeUsername(input.username);
    if (!parsed.ok) {
      return { ok: false, status: 400, error: parsed.error };
    }
    nextUsername = parsed.username;
  }

  let nextFullName: string | null | undefined;
  if (input.fullName !== undefined) {
    const trimmed = input.fullName.trim();
    if (trimmed.length > 120) {
      return { ok: false, status: 400, error: "Full name must be at most 120 characters" };
    }
    nextFullName = trimmed || null;
  }

  if (nextRole === undefined && nextUsername === undefined && nextFullName === undefined) {
    return { ok: false, status: 400, error: "No user changes specified" };
  }

  try {
    const rtdb = await requireRtdb();
    const target = await getRtdbUserById(rtdb, targetId);
    if (!target) return { ok: false, status: 404, error: "User account not found" };

    const effectiveRole = nextRole ?? target.role;
    const effectiveUsername = nextUsername !== undefined ? nextUsername : target.username;
    const effectiveFullName = nextFullName !== undefined ? nextFullName : target.fullName;

    if (isAdminRole(target.role) && !isAdminRole(effectiveRole)) {
      if (target.id === input.actor.id) {
        return { ok: false, status: 409, error: "You cannot demote your own active Administrator account." };
      }
      const admins = await countAdminsRtdb(rtdb);
      if (admins <= 1) {
        return { ok: false, status: 409, error: "Cannot demote the last remaining Administrator account." };
      }
    }

    if (nextUsername !== undefined && nextUsername !== target.username) {
      await changeRtdbUsername(target.id, nextUsername);
    }

    const updated = await applyRtdbUserFields(rtdb, target, {
      role: effectiveRole,
      username: effectiveUsername,
      fullName: effectiveFullName,
    });

    const action = target.role !== updated.role ? "USER_ROLE_CHANGED" : "USER_UPDATED";
    await auditRtdb(rtdb, {
      userId: input.actor.id,
      userEmail: input.actor.email,
      action,
      entity: `user:${target.id}`,
      ipAddress: input.ipAddress ?? null,
      details: {
        previousRole: target.role,
        role: updated.role,
        previousUsername: target.username ?? null,
        username: updated.username ?? null,
        previousFullName: target.fullName,
        fullName: updated.fullName,
      },
    });

    invalidateSessionCache();
    return { ok: true, status: 200, data: { user: safePublicUser(rtdbToPublic(updated)) } };
  } catch (err) {
    try {
      return toLifecycleError(err);
    } catch {
      throw err;
    }
  }
}

/**
 * Revokes every active session for the target account: the Firebase refresh
 * tokens are revoked (all clients must re-authenticate) and the in-process
 * session cache is dropped. Returns 404 when the account does not exist.
 */
export async function revokeAllUserSessions(input: {
  actor: Pick<UserRow, "id" | "email">;
  targetUserId: string;
  ipAddress?: string | null;
  now?: Date;
}): Promise<UserLifecycleResult<{ revokedCount: number }>> {
  const targetId = input.targetUserId.trim();
  if (!targetId) {
    return { ok: false, status: 400, error: "Target userId is required" };
  }

  const rtdb = await requireRtdb();
  const target = await getRtdbUserById(rtdb, targetId);
  if (!target) {
    return { ok: false, status: 404, error: "User account not found" };
  }

  await revokeFirebaseUserSessions(target.id);

  await auditRtdb(rtdb, {
    userId: input.actor.id,
    userEmail: input.actor.email,
    action: "USER_SESSIONS_REVOKED",
    entity: `user:${target.id}`,
    ipAddress: input.ipAddress ?? null,
    details: {
      role: target.role,
      fullName: target.fullName,
      revokedCount: 1,
    },
  });

  invalidateSessionCache();
  return { ok: true, status: 200, data: { revokedCount: 1 } };
}

/**
 * FR-20 / FR-29: Removes a user account with strict self-lockout and last-Admin
 * protection, deleting the Firebase Auth credential and RTDB profile while
 * preserving historical audit_logs, alarms, and trend alerts.
 */
export async function removeManagedUser(input: {
  actor: Pick<UserRow, "id" | "email">;
  targetUserId: string;
  ipAddress?: string | null;
  deleteAuthUser?: (userId: string) => Promise<void>;
}): Promise<UserLifecycleResult<{ removedUserId: string; role: Role }>> {
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

  const rtdb = await requireRtdb();
  const target = await getRtdbUserById(rtdb, targetId);
  if (!target) return { ok: false, status: 404, error: "User account not found" };
  if (isAdminRole(target.role)) {
    const admins = await countAdminsRtdb(rtdb);
    if (admins <= 1) {
      return { ok: false, status: 409, error: "Cannot remove the last remaining Administrator account." };
    }
  }
  await deleteRtdbUser(rtdb, target.id);
  await auditRtdb(rtdb, {
    userId: input.actor.id,
    userEmail: input.actor.email,
    action: "USER_REMOVED",
    entity: `user:${target.id}`,
    ipAddress: input.ipAddress ?? null,
    details: {
      email: target.email,
      username: target.username ?? null,
      fullName: target.fullName,
      role: target.role,
    },
  });
  invalidateSessionCache();

  if (input.deleteAuthUser) {
    try {
      await input.deleteAuthUser(target.id);
    } catch (err) {
      console.warn(
        "[AHU] Removed user profile but Firebase Auth cleanup reported an error:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { ok: true, status: 200, data: { removedUserId: target.id, role: target.role } };
}
