import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getAhuRtdb } from "@/lib/firebase/admin";
import { changeRtdbUsername, updateFirebaseUserPassword } from "@/lib/firebase/provision";
import {
  getClientIp,
  invalidateSessionCache,
  jsonError,
  requireAuth,
  safePublicUser,
  writeAudit,
} from "@/lib/auth";
import { normalizeUsername } from "@/lib/role-auth";
import { getRtdbUserByUsername } from "@/lib/rtdb/users";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireAuth("view");
    return Response.json({ user: safePublicUser(actor.user) });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const actor = await requireAuth("view", { mutating: true });
    const ip = await getClientIp();
    const body = (await req.json()) as {
      fullName?: string;
      username?: string;
      newPassword?: string;
    };

    const patch: { fullName?: string | null; username?: string } = {};
    if (body.fullName !== undefined) {
      const trimmed = body.fullName.trim();
      if (trimmed.length > 120) {
        return Response.json({ error: "Full name must be at most 120 characters" }, { status: 400 });
      }
      patch.fullName = trimmed || null;
    }

    if (body.username !== undefined) {
      const parsed = normalizeUsername(body.username);
      if (!parsed.ok) {
        return Response.json({ error: parsed.error }, { status: 400 });
      }
      const holder = await getRtdbUserByUsername(await getAhuRtdb(), parsed.username).catch(() => null);
      if (holder && holder.id !== actor.user.id) {
        return Response.json({ error: `Username "${parsed.username}" is already taken` }, { status: 409 });
      }
      patch.username = parsed.username;
    }

    let passwordUpdated = false;
    if (typeof body.newPassword === "string" && body.newPassword.length > 0) {
      if (body.newPassword.length < 8) {
        return Response.json({ error: "New password must be at least 8 characters" }, { status: 400 });
      }
      try {
        await updateFirebaseUserPassword(actor.user.id, body.newPassword);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not update password";
        return Response.json({ error: message }, { status: 400 });
      }
      passwordUpdated = true;
      await writeAudit({
        userId: actor.user.id,
        userEmail: actor.user.email,
        action: "USER_PASSWORD_CHANGED",
        entity: `user:${actor.user.id}`,
        ipAddress: ip,
        details: { selfChange: true, role: actor.user.role },
      });
    }

    let updatedUser = actor.user;
    if (Object.keys(patch).length > 0) {
      await db
        .update(users)
        .set(patch)
        .where(eq(users.id, actor.user.id));
      updatedUser = {
        ...actor.user,
        ...(patch.username !== undefined ? { username: patch.username } : {}),
        ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}),
      };
      // RTDB is the session-authorization source: mirror the profile change.
      if (patch.username) {
        await changeRtdbUsername(actor.user.id, patch.username).catch(() => undefined);
      }
      if (patch.fullName !== undefined) {
        const { getRtdbUserById } = await import("@/lib/rtdb/users");
        const current = await getRtdbUserById(await getAhuRtdb(), actor.user.id).catch(() => null);
        if (current) {
          const { getFirebaseDb } = await import("@/lib/firebase/admin");
          const { createAdminRtdbAdapter } = await import("@/lib/rtdb/store");
          await createAdminRtdbAdapter(await getFirebaseDb()).set(`users/${actor.user.id}/fullName`, patch.fullName);
        }
      }
      await writeAudit({
        userId: actor.user.id,
        userEmail: actor.user.email,
        action: "USER_PROFILE_UPDATED",
        entity: `user:${actor.user.id}`,
        ipAddress: ip,
        details: {
          previousUsername: actor.user.username ?? null,
          username: updatedUser.username ?? null,
          previousFullName: actor.user.fullName ?? null,
          fullName: updatedUser.fullName ?? null,
        },
      });
    }

    if (!passwordUpdated && Object.keys(patch).length === 0) {
      return Response.json({ error: "No profile changes specified" }, { status: 400 });
    }

    invalidateSessionCache();
    return Response.json({
      ok: true,
      passwordUpdated,
      user: safePublicUser(updatedUser),
    });
  } catch (err) {
    return jsonError(err);
  }
}
