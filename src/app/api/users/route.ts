import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accessDevices, users } from "@/db/schema";
import type { Role } from "@/db/schema";
import { getClientIp, jsonError, requireAuth, safePublicUser, writeAudit } from "@/lib/auth";
import { secretHash } from "@/lib/device-access";
import { ROLES } from "@/lib/domain";
import { randomHex, randomId } from "@/lib/ids";
import { buildTokenAccountEmail, isAdminRole } from "@/lib/role-auth";
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
      label?: string;
    };
    const role = body.role as Role;
    if (!ROLES.includes(role))
      return Response.json({ error: `Role must be one of: ${ROLES.join(", ")}` }, { status: 400 });

    const ip = await getClientIp();

    if (isAdminRole(role)) {
      const email = (body.email ?? "").trim().toLowerCase();
      const password = body.password ?? "";

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return Response.json({ error: "A valid email address is required for Administrators" }, { status: 400 });
      if (password.length < 8)
        return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });

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

      await writeAudit({
        userId: actor.user.id,
        userEmail: actor.user.email,
        action: "USER_CREATED",
        entity: `user:${id}`,
        ipAddress: ip,
        details: { email, role, fullName: (body.fullName ?? "").trim() || null, authMethod: "password" },
      });
      const created = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
      return Response.json({ ok: true, user: safePublicUser(created) }, { status: 201 });
    }

    // Non-Admin roles (Engineering, Operator, Viewer): token-only access, no email or password required.
    const fullName = (body.fullName ?? "").trim();
    if (!fullName || fullName.length > 120) {
      return Response.json(
        { error: "Member name is required for non-Admin roles (1–120 characters)" },
        { status: 400 },
      );
    }

    const label = (body.label ?? "").trim() || "Initial browser";
    if (label.length > 120) {
      return Response.json(
        { error: "Device label must be 1–120 characters" },
        { status: 400 },
      );
    }

    const id = randomId();
    const email = buildTokenAccountEmail(fullName, id);
    const code = randomHex(32);
    const deviceId = randomId();
    const invitationExpiresAt = new Date(Date.now() + 24 * 3600_000);
    const invitationHash = await secretHash(code);

    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          id,
          email,
          fullName,
          role,
        })
        .returning();

      await tx.insert(accessDevices).values({
        id: deviceId,
        userId: id,
        label,
        invitationHash,
        invitationExpiresAt,
      });

      await writeAudit(
        {
          userId: actor.user.id,
          userEmail: actor.user.email,
          action: "USER_CREATED",
          entity: `user:${id}`,
          ipAddress: ip,
          details: { role, fullName, authMethod: "token" },
        },
        tx,
      );

      await writeAudit(
        {
          userId: actor.user.id,
          userEmail: actor.user.email,
          action: "ACCESS_DEVICE_ISSUED",
          entity: `access-device:${deviceId}`,
          ipAddress: ip,
          details: { targetUserId: id, role, label },
        },
        tx,
      );

      return row;
    });

    return Response.json(
      { ok: true, user: safePublicUser(created), token: code, invitationExpiresAt },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return jsonError(err);
  }
}
