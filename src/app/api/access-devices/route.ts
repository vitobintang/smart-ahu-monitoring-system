import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accessDevices } from "@/db/schema";
import { getClientIp, invalidateSessionCache, jsonError, requireAuth, writeAudit } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth("manageUsers");
    return Response.json(
      {
        devices: [],
        note: "All user roles authenticate via Email/Username and Password. Bearer tokens are issued exclusively for AHU monitoring modules via /api/devices.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireAuth("manageUsers", { mutating: true });
    const body = (await req.json()) as { revokeId?: string };
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

    return Response.json(
      {
        error:
          "User accounts no longer use access tokens. Create accounts with Email/Username and Password in /api/users; use /api/devices to generate AHU monitoring module tokens.",
      },
      { status: 410 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
