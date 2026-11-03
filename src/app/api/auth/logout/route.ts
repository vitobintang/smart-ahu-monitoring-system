import { csrfValid, destroySession, getClientIp, getSession, writeAudit } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!(await csrfValid()))
    return Response.json({ error: "Invalid or missing CSRF token" }, { status: 403 });
  const ctx = await getSession();
  if (ctx) {
    await writeAudit({
      userId: ctx.user.id,
      userEmail: ctx.user.email,
      action: "LOGOUT",
      entity: "auth",
      ipAddress: await getClientIp(),
      details: { role: ctx.user.role },
    });
  }
  await destroySession();
  return Response.json({ ok: true });
}