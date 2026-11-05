import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import type { Role } from "@/db/schema";
import {
  getClientIp,
  invalidateSessionCache,
  jsonError,
  requireAuth,
  safePublicUser,
  writeAudit,
} from "@/lib/auth";
import { ROLES } from "@/lib/domain";
import { normalizeUsername, suggestUsernameFromEmail } from "@/lib/role-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  removeManagedUser,
  revokeAllUserSessions,
  updateManagedUser,
} from "@/lib/user-management";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireAuth("manageUsers");
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        fullName: users.fullName,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(users.createdAt);
    return Response.json({
      users: rows,
      roles: ROLES,
      currentUserId: actor.user.id,
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireAuth("manageUsers", { mutating: true });
    const body = (await req.json()) as {
      email?: string;
      username?: string;
      password?: string;
      fullName?: string;
      role?: string;
    };
    const role = body.role as Role;
    if (!ROLES.includes(role)) {
      return Response.json({ error: `Role must be one of: ${ROLES.join(", ")}` }, { status: 400 });
    }

    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    const fullName = (body.fullName ?? "").trim() || null;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "A valid email address is required" }, { status: 400 });
    }
    if (password.length < 8) {
      return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    if (fullName && fullName.length > 120) {
      return Response.json({ error: "Full name must be at most 120 characters" }, { status: 400 });
    }

    const rawUsername = (body.username ?? "").trim() || suggestUsernameFromEmail(email);
    const parsedUsername = normalizeUsername(rawUsername);
    if (!parsedUsername.ok) {
      return Response.json({ error: parsedUsername.error }, { status: 400 });
    }
    const username = parsedUsername.username;

    const existingEmail = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existingEmail.length > 0) {
      return Response.json({ error: "A user with this email already exists" }, { status: 409 });
    }

    const existingUsername = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.username}) = ${username}`)
      .limit(1);
    if (existingUsername.length > 0) {
      return Response.json(
        { error: `Username "${username}" is already taken. Choose another username.` },
        { status: 409 },
      );
    }

    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) {
      return Response.json(
        { error: error?.message ? `Could not create Auth user: ${error.message}` : "Could not create Auth user" },
        { status: 400 },
      );
    }

    const id = data.user.id;
    try {
      await db.insert(users).values({
        id,
        email,
        username,
        fullName,
        role,
      });
    } catch (err) {
      const rollback = await supabase.auth.admin.deleteUser(id);
      if (rollback.error) {
        console.error("[AHU] Could not roll back Auth user", id, rollback.error.message);
      }
      throw err;
    }

    const ip = await getClientIp();
    await writeAudit({
      userId: actor.user.id,
      userEmail: actor.user.email,
      action: "USER_CREATED",
      entity: `user:${id}`,
      ipAddress: ip,
      details: { email, username, role, fullName, authMethod: "password" },
    });

    const [created] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return Response.json({ ok: true, user: safePublicUser(created) }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const actor = await requireAuth("manageUsers", { mutating: true });
    const ip = await getClientIp();
    const body = (await req.json()) as {
      userId?: string;
      password?: string;
      role?: string;
      username?: string;
      fullName?: string;
      revokeSessions?: boolean;
    };

    if (body.revokeSessions) {
      const res = await revokeAllUserSessions({
        actor: actor.user,
        targetUserId: body.userId ?? "",
        ipAddress: ip,
      });
      if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
      return Response.json({ ok: true, ...res.data });
    }

    if (body.role !== undefined || body.username !== undefined || body.fullName !== undefined) {
      const res = await updateManagedUser({
        actor: actor.user,
        targetUserId: body.userId ?? "",
        role: body.role,
        username: body.username,
        fullName: body.fullName,
        ipAddress: ip,
      });
      if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
      return Response.json({ ok: true, ...res.data });
    }

    const userId = (body.userId ?? actor.user.id).trim();
    const password = body.password ?? "";
    if (!userId) {
      return Response.json({ error: "Target userId is required" }, { status: 400 });
    }
    if (password.length < 8) {
      return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!target) {
      return Response.json({ error: "User account not found" }, { status: 404 });
    }

    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.auth.admin.updateUserById(target.id, {
      password,
      email_confirm: true,
    });
    if (error) {
      return Response.json({ error: `Could not update password: ${error.message}` }, { status: 400 });
    }

    invalidateSessionCache();
    await writeAudit({
      userId: actor.user.id,
      userEmail: actor.user.email,
      action: "USER_PASSWORD_CHANGED",
      entity: `user:${target.id}`,
      ipAddress: ip,
      details: {
        email: target.email,
        username: target.username ?? null,
        role: target.role,
        selfChange: actor.user.id === target.id,
      },
    });

    return Response.json({ ok: true, email: target.email, username: target.username ?? null });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const actor = await requireAuth("manageUsers", { mutating: true });
    const ip = await getClientIp();
    const url = new URL(req.url);
    let userId = url.searchParams.get("userId")?.trim() ?? "";

    if (!userId) {
      try {
        const body = (await req.json()) as { userId?: string };
        userId = (body.userId ?? "").trim();
      } catch {
        /* empty body is valid when userId query param is used */
      }
    }

    const res = await removeManagedUser({
      actor: actor.user,
      targetUserId: userId,
      ipAddress: ip,
      deleteSupabaseAuthUser: async (authUserId) => {
        const supabase = createSupabaseAdminClient();
        const { error } = await supabase.auth.admin.deleteUser(authUserId);
        if (error) throw new Error(error.message);
      },
    });
    if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
    return Response.json({ ok: true, ...res.data });
  } catch (err) {
    return jsonError(err);
  }
}
