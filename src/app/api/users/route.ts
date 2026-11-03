import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import type { Role } from "@/db/schema";
import { getClientIp, jsonError, requireAuth, safePublicUser, writeAudit } from "@/lib/auth";
import { ROLES } from "@/lib/domain";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth("manageUsers");
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(users.createdAt);
    return Response.json({ users: rows, roles: ROLES });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireAuth("manageUsers", { mutating: true });
    const body = (await req.json()) as {
      email?: string;
      password?: string;
      fullName?: string;
      role?: string;
    };
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    const role = body.role as Role;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return Response.json({ error: "A valid email address is required" }, { status: 400 });
    if (password.length < 8)
      return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    if (!ROLES.includes(role))
      return Response.json({ error: `Role must be one of: ${ROLES.join(", ")}` }, { status: 400 });

    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0)
      return Response.json({ error: "A user with this email already exists" }, { status: 409 });

    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user)
      return Response.json({ error: "Could not create the Supabase Auth user" }, { status: 400 });

    const id = data.user.id;
    try {
      await db.insert(users).values({
        id,
        email,
        fullName: (body.fullName ?? "").trim() || null,
        role,
      });
    } catch (err) {
      const rollback = await supabase.auth.admin.deleteUser(id);
      if (rollback.error)
        console.error("[AHU] Could not roll back Auth user", id, rollback.error.message);
      throw err;
    }

    const ip = await getClientIp();
    await writeAudit({
      userId: actor.user.id,
      userEmail: actor.user.email,
      action: "USER_CREATED",
      entity: `user:${id}`,
      ipAddress: ip,
      details: { email, role, fullName: body.fullName ?? null },
    });
    const created = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
    return Response.json({ ok: true, user: safePublicUser(created) }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}