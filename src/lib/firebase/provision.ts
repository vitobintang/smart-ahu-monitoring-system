import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import type { UserRole } from "@/lib/ahu";
import { getFirebaseAuth, getAhuRtdb } from "./admin";
import { createRtdbUser, deleteRtdbUser, getRtdbUserById, updateRtdbUserRole } from "@/lib/rtdb/users";

/**
 * Unified account provisioning across the three stores used during the
 * Firebase migration:
 *   1. Firebase Auth   — the identity (login credential, uid owner)
 *   2. RTDB users/{uid} — the AUTH-SESSION profile (role, username, email)
 *   3. PG users row     — admin management mirror until Phase 2 moves the
 *                         remaining tables (keeps audit FKs + admin UI alive)
 *
 * Invariants: uid is identical in all three; failures roll the prior store back.
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

/**
 * PG mirror (admin UI + audit FKs) — insert-if-absent so legacy rows and new
 * Firebase accounts coexist. Never throws on duplicate (idempotent).
 */
export async function ensurePgUserMirror(input: {
  id: string;
  email: string;
  username: string | null;
  fullName: string | null;
  role: UserRole;
}): Promise<void> {
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.id, input.id)).limit(1);
  if (existing.length > 0) return;
  await db.insert(users).values({
    id: input.id,
    email: input.email,
    username: input.username,
    fullName: input.fullName,
    role: input.role,
  });
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

/** Verifies a Google popup ID token. Returns null when invalid/expired. */
export async function verifyGoogleIdToken(idToken: string): Promise<{ uid: string; email: string | null; emailVerified: boolean; name: string | null } | null> {
  if (typeof idToken !== "string" || idToken.length < 20 || idToken.split(".").length !== 3) return null;
  try {
    const decoded = await (await getFirebaseAuth()).verifyIdToken(idToken, true);
    if (typeof decoded.uid !== "string" || !decoded.uid) return null;
    return {
      uid: decoded.uid,
      email: typeof decoded.email === "string" ? decoded.email : null,
      emailVerified: decoded.email_verified === true,
      name: typeof decoded.name === "string" ? decoded.name : null,
    };
  } catch {
    return null;
  }
}

/**
 * One-time relink token for "Google opened a NEW Firebase uid but an account
 * with this email already exists". The client exchanges it via
 * signInWithCustomToken → the follow-up ID token carries the ORIGINAL uid.
 */
export async function createRelinkCustomToken(uid: string): Promise<string> {
  return (await getFirebaseAuth()).createCustomToken(uid, { amr: ["relink"] });
}
