import { eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { accessDevices, users } from "@/db/schema";
import { getClientIp, invalidateSessionCache, jsonError, requireAuth, writeAudit } from "@/lib/auth";
import { secretHash } from "@/lib/device-access";
import { randomHex, randomId } from "@/lib/ids";
import { isAdminRole } from "@/lib/role-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth("manageUsers");
    const rows = await db
      .select({
        id: accessDevices.id,
        userId: accessDevices.userId,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        label: accessDevices.label,
        createdAt: accessDevices.createdAt,
        claimedAt: accessDevices.claimedAt,
        expiresAt: accessDevices.expiresAt,
        invitationExpiresAt: accessDevices.invitationExpiresAt,
        revokedAt: accessDevices.revokedAt,
      })
      .from(accessDevices)
      .innerJoin(users, eq(accessDevices.userId, users.id))
      .where(ne(users.role, "Admin"))
      .orderBy(accessDevices.createdAt);
    return Response.json({ devices: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireAuth("manageUsers", { mutating: true });
    const body = (await req.json()) as { userId?: string; label?: string; revokeId?: string };
    if (body.revokeId) {
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(accessDevices)
          .set({ revokedAt: new Date() })
          .where(eq(accessDevices.id, body.revokeId!))
          .returning({ id: accessDevices.id, userId: accessDevices.userId });
        if (row) {
          await writeAudit(
            {
              userId: actor.user.id,
              userEmail: actor.user.email,
              action: "ACCESS_DEVICE_REVOKED",
              entity: `access-device:${row.id}`,
              ipAddress: await getClientIp(),
              details: { targetUserId: row.userId },
            },
            tx,
          );
        }
        return row;
      });
      if (!updated) return Response.json({ error: "Authorization not found" }, { status: 404 });
      invalidateSessionCache();
      return Response.json({ ok: true });
    }

    if (
      !body.userId ||
      typeof body.label !== "string" ||
      !body.label.trim() ||
      body.label.trim().length > 120
    ) {
      return Response.json(
        { error: "Select a non-Admin member and enter a device label (1–120 characters)" },
        { status: 400 },
      );
    }

    const [target] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, body.userId))
      .limit(1);
    if (!target) return Response.json({ error: "User not found" }, { status: 404 });
    if (isAdminRole(target.role)) {
      return Response.json(
        { error: "Administrators sign in with email and password and do not use access tokens" },
        { status: 400 },
      );
    }

    const code = randomHex(32);
    const id = randomId();
    const invitationExpiresAt = new Date(Date.now() + 24 * 3600_000);
    const label = body.label.trim();
    const invitationHash = await secretHash(code);

    await db.transaction(async (tx) => {
      await tx.insert(accessDevices).values({ id, userId: target.id, label, invitationHash, invitationExpiresAt });
      await writeAudit(
        {
          userId: actor.user.id,
          userEmail: actor.user.email,
          action: "ACCESS_DEVICE_ISSUED",
          entity: `access-device:${id}`,
          ipAddress: await getClientIp(),
          details: { targetUserId: target.id, role: target.role, label },
        },
        tx,
      );
    });
    return Response.json(
      { ok: true, token: code, invitationExpiresAt },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}
