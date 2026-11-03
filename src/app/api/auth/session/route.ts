import { getSession, safePublicUser } from "@/lib/auth";
import { getSyncStatus } from "@/lib/realtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getSession();
  const sync = await getSyncStatus();
  if (!ctx) {
    return Response.json(
      { user: null, sync },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    {
      user: safePublicUser(ctx.user),
      physicalControlUnlocked: false,
      sync,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}