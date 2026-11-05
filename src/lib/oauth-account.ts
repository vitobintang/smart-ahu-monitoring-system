import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accessDevices, ahuCommands, auditLogs, users, type UserRow } from "@/db/schema";
import { isValidUserRole } from "@/lib/role-auth";

export interface VerifiedAuthIdentity {
  id: string;
  email?: string | null;
  emailConfirmed?: boolean;
  fullName?: string | null;
}

/**
 * Resolves an authenticated Supabase Auth user (`password` or `google` OAuth)
 * to the single canonical `ahu_private.users` account.
 *
 * Unification guarantee:
 * 1. When a user already created with Email + Password signs in via Google OAuth
 *    with the same Gmail address, Supabase Auth links the Google identity to the
 *    existing `auth.users.id`, matching `users.id` directly.
 * 2. Even if an `ahu_private.users` record existed under a different UUID for the
 *    same verified email address, this helper atomically reconciles it onto the
 *    verified Supabase Auth UUID so Email/Password and Google Sign-In ALWAYS
 *    share the exact same account, role, @username, commands, and audit history.
 */
export async function resolveOrLinkAppUserForAuthUser(
  identity: VerifiedAuthIdentity,
  database: Pick<typeof db, "select" | "update" | "transaction"> = db,
): Promise<UserRow | null> {
  const normalizedEmail = identity.email?.trim().toLowerCase() ?? null;
  const candidateName = identity.fullName?.trim() || null;

  // 1. Fast path: direct primary-key match on Supabase Auth user ID
  const [byId] = await database.select().from(users).where(eq(users.id, identity.id)).limit(1);
  if (byId) {
    if (!isValidUserRole(byId.role)) return null;
    // Backfill display name from Google profile if the account had no fullName yet
    if (!byId.fullName && candidateName && candidateName.length <= 120) {
      const [updated] = await database
        .update(users)
        .set({ fullName: candidateName })
        .where(eq(users.id, byId.id))
        .returning();
      return updated ?? byId;
    }
    return byId;
  }

  // 2. Fallback unification: match by verified email (case-insensitive)
  if (!normalizedEmail || !identity.emailConfirmed) {
    return null;
  }

  const [byEmail] = await database
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizedEmail}`)
    .limit(1);

  if (!byEmail || !isValidUserRole(byEmail.role)) {
    return null;
  }

  // Reconcile the existing email account onto the verified Supabase Auth UUID
  return database.transaction(async (tx) => {
    const oldId = byEmail.id;
    const tempEmail = `${oldId}@reconciling.local`;

    await tx
      .update(users)
      .set({ email: tempEmail, username: null })
      .where(eq(users.id, oldId));

    const [linked] = await tx
      .insert(users)
      .values({
        id: identity.id,
        email: normalizedEmail,
        username: byEmail.username,
        fullName: byEmail.fullName || (candidateName && candidateName.length <= 120 ? candidateName : null),
        role: byEmail.role,
        createdAt: byEmail.createdAt,
      })
      .returning();

    await tx.update(accessDevices).set({ userId: identity.id }).where(eq(accessDevices.userId, oldId));
    await tx.update(ahuCommands).set({ userId: identity.id }).where(eq(ahuCommands.userId, oldId));
    await tx.update(auditLogs).set({ userId: identity.id }).where(eq(auditLogs.userId, oldId));
    await tx.delete(users).where(eq(users.id, oldId));

    return linked ?? null;
  });
}
