import type { UserRole } from "@/lib/ahu";
import { getFirebaseAuth, getAhuRtdb } from "./admin";
import { createRtdbUser, deleteRtdbUser, getRtdbUserById, updateRtdbUserRole } from "@/lib/rtdb/users";

/**
 * Unified account provisioning across the two Firebase stores:
 *   1. Firebase Auth    — the identity (login credential, uid owner)
 *   2. RTDB users/{uid} — the AUTH-SESSION profile (role, username, email)
 *
 * Invariant: the uid is identical in both; failures roll the prior store back.
 */

export class FirebaseAuthAdminError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "FirebaseAuthAdminError";
    this.status = status;
  }
}

function describeFirebaseError(err: unknown, fallback: string): string {
  const code = (err as { code?: string } | null)?.code ?? "";
  if (code === "auth/email-already-exists") return "A user with this email already exists";
  if (code === "auth/invalid-email") return "Invalid email address";
  if (code === "auth/weak-password") return "Password must be at least 6 characters";
  if (code === "auth/user-not-found") return "Firebase Auth user not found";
  return fallback;
}

/** Creates the Firebase Auth identity. Returns the new uid. */
export async function createFirebaseAuthUser(input: {
  email: string;
  password: string;
  fullName?: string | null;
}): Promise<string> {
  try {
    const user = await (await getFirebaseAuth()).createUser({
      email: input.email,
      password: input.password,
      emailVerified: true,
      displayName: input.fullName ?? undefined,
    });
    return user.uid;
  } catch (err) {
    throw new FirebaseAuthAdminError(400, describeFirebaseError(err, "Could not create Auth user"));
  }
}

export async function updateFirebaseUserPassword(uid: string, newPassword: string): Promise<void> {
  try {
    await (await getFirebaseAuth()).updateUser(uid, { password: newPassword, emailVerified: true });
  } catch (err) {
    throw new FirebaseAuthAdminError(400, describeFirebaseError(err, "Could not update password"));
  }
}

export async function deleteFirebaseAuthUser(uid: string): Promise<void> {
  try {
    await (await getFirebaseAuth()).deleteUser(uid);
  } catch (err) {
    throw new FirebaseAuthAdminError(400, describeFirebaseError(err, "Could not delete Auth user"));
  }
}

/** Revokes all refresh tokens for the uid — every signed-in session must re-authenticate. */
export async function revokeFirebaseUserSessions(uid: string): Promise<void> {
  try {
    await (await getFirebaseAuth()).revokeRefreshTokens(uid);
  } catch (err) {
    throw new FirebaseAuthAdminError(400, describeFirebaseError(err, "Could not revoke user sessions"));
  }
}

/** RTDB auth-profile write-through (record + uniqueness mirrors). */
export async function provisionRtdbUser(input: {
  uid: string;
  email: string;
  username: string;
  fullName?: string | null;
  role: UserRole;
}): Promise<void> {
  await createRtdbUser(await getAhuRtdb(), input);
}

export async function setRtdbUserRole(uid: string, role: UserRole): Promise<void> {
  await updateRtdbUserRole(await getAhuRtdb(), uid, role);
}

export async function removeRtdbUser(uid: string): Promise<void> {
  await deleteRtdbUser(await getAhuRtdb(), uid);
}

export async function getRtdbProfile(uid: string) {
  return getRtdbUserById(await getAhuRtdb(), uid);
}

/** Moves the RTDB username mirror after a username change (claim + release). */
export async function changeRtdbUsername(uid: string, nextUsername: string): Promise<void> {
  const dbRtdb = await getAhuRtdb();
  const current = await getRtdbUserById(dbRtdb, uid);
  if (!current || current.username === nextUsername) return;
  await provisionRtdbUser({
    uid,
    email: current.email,
    username: nextUsername,
    fullName: current.fullName,
    role: current.role,
  });
  const { USERNAMES_NODE } = await import("@/lib/rtdb/users");
  await dbRtdb.remove(`${USERNAMES_NODE}/${current.username}`);
}
