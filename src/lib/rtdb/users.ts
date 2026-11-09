import type { UserRole } from "@/lib/ahu";
import type { RtdbAdapter } from "./store";

/**
 * User identities stored in the Realtime Database.
 *
 * Tree layout (mirrors the previous relational columns 1:1):
 *   users/{uid}              → RtdbUser record (id, email, username, fullName, role, timestamps)
 *   usernames/{key}          → uid            (uniqueness mirror, transaction-claimed)
 *   emails/{key}             → uid            (uniqueness mirror; email lowercased, key = base64url)
 *
 * All writes go through the trusted server (Admin SDK bypasses security rules).
 */

export interface RtdbUser {
  id: string;
  email: string;
  username: string;
  fullName: string | null;
  role: UserRole;
  /** Epoch milliseconds. */
  createdAt: number;
  updatedAt: number;
}

export const USERS_NODE = "users";
export const USERNAMES_NODE = "usernames";
export const EMAILS_NODE = "emails";

/** Emails contain "." which is illegal in RTDB keys — base64url the normalized value. */
export function emailKey(email: string): string {
  return Buffer.from(email.trim().toLowerCase(), "utf8").toString("base64url");
}

export function userNode(uid: string): string {
  return `${USERS_NODE}/${uid}`;
}

function normalizeUsernameValue(username: string): string {
  const value = username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(value)) throw new Error("Invalid username format");
  return value;
}

export class UsernameTakenError extends Error {
  constructor(username: string) {
    super(`Username already taken: ${username}`);
    this.name = "UsernameTakenError";
  }
}

export class EmailTakenError extends Error {
  constructor(email: string) {
    super(`Email already registered: ${email}`);
    this.name = "EmailTakenError";
  }
}

/** All user profiles, oldest first (the admin user-management list). */
export async function listAllRtdbUsers(db: RtdbAdapter): Promise<RtdbUser[]> {
  const tree = (await db.get<Record<string, RtdbUser>>(USERS_NODE)) ?? {};
  return Object.values(tree).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export async function getRtdbUserById(db: RtdbAdapter, uid: string): Promise<RtdbUser | null> {
  if (typeof uid !== "string" || !uid.trim() || uid.length > 128) return null;
  return db.get<RtdbUser>(userNode(uid));
}

async function getUidForUsername(db: RtdbAdapter, username: string): Promise<string | null> {
  return db.get<string>(`${USERNAMES_NODE}/${normalizeUsernameValue(username)}`);
}

async function getUidForEmail(db: RtdbAdapter, email: string): Promise<string | null> {
  return db.get<string>(`${EMAILS_NODE}/${emailKey(email)}`);
}

export async function getRtdbUserByUsername(db: RtdbAdapter, username: string): Promise<RtdbUser | null> {
  const uid = await getUidForUsername(db, username);
  return uid ? getRtdbUserById(db, uid) : null;
}

export async function getRtdbUserByEmail(db: RtdbAdapter, email: string): Promise<RtdbUser | null> {
  const uid = await getUidForEmail(db, email);
  return uid ? getRtdbUserById(db, uid) : null;
}

function isValidRtdbUser(value: unknown): value is RtdbUser {
  if (typeof value !== "object" || value === null) return false;
  const user = value as Partial<RtdbUser>;
  return (
    typeof user.id === "string" && user.id.length > 0 &&
    typeof user.email === "string" && user.email.length > 0 &&
    typeof user.username === "string" && user.username.length > 0 &&
    (user.role === "Admin" || user.role === "Engineering" || user.role === "Operator") &&
    typeof user.createdAt === "number" && typeof user.updatedAt === "number"
  );
}

/**
 * Creates the RTDB user record after Firebase Auth already created the auth
 * user (`uid` comes from admin.createUser / import). Uniqueness mirrors are
 * claimed transactionally; on any conflict the caller should delete the Auth
 * user (compensation) — this function leaves nothing half-claimed.
 */
export async function createRtdbUser(
  db: RtdbAdapter,
  user: { uid: string; email: string; username: string; fullName?: string | null; role: UserRole },
): Promise<RtdbUser> {
  const uid = user.uid.trim();
  if (!uid || uid.length > 128) throw new Error("Invalid uid");
  const email = user.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email");
  const username = normalizeUsernameValue(user.username);
  const now = Date.now();

  const usernameClaim = await db.transaction<string>(`${USERNAMES_NODE}/${username}`, (current) =>
    current === null ? uid : undefined,
  );
  if (!usernameClaim.committed) throw new UsernameTakenError(username);

  const emailClaim = await db.transaction<string>(`${EMAILS_NODE}/${emailKey(email)}`, (current) =>
    current === null ? uid : undefined,
  );
  if (!emailClaim.committed) {
    await db.remove(`${USERNAMES_NODE}/${username}`);
    throw new EmailTakenError(email);
  }

  const record: RtdbUser = {
    id: uid,
    email,
    username,
    fullName: user.fullName ?? null,
    role: user.role,
    createdAt: now,
    updatedAt: now,
  };
  await db.set(userNode(uid), record);

  // Belt-and-braces: if the record write surfaced anything odd, fail loudly so
  // the caller can compensate (delete the Auth user). Mirrors stay consistent.
  const written = await getRtdbUserById(db, uid);
  if (!isValidRtdbUser(written)) {
    await db.remove(`${USERNAMES_NODE}/${username}`);
    await db.remove(`${EMAILS_NODE}/${emailKey(email)}`);
    await db.remove(userNode(uid));
    throw new Error("Failed to persist user record");
  }
  return written;
}

/** Role changes update both the record and its audit-friendly updatedAt stamp. */
export async function updateRtdbUserRole(db: RtdbAdapter, uid: string, role: UserRole): Promise<RtdbUser | null> {
  const existing = await getRtdbUserById(db, uid);
  if (!existing) return null;
  const next: RtdbUser = { ...existing, role, updatedAt: Date.now() };
  await db.set(userNode(uid), next);
  return next;
}

export async function deleteRtdbUser(db: RtdbAdapter, uid: string): Promise<void> {
  const existing = await getRtdbUserById(db, uid);
  if (!existing) return;
  await db.remove(userNode(uid));
  await db.remove(`${USERNAMES_NODE}/${normalizeUsernameValue(existing.username)}`);
  await db.remove(`${EMAILS_NODE}/${emailKey(existing.email)}`);
}
