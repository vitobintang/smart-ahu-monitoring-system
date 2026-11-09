import { jsonError, requireAuth } from "@/lib/auth";
import { drainSyncOutbox, getSyncStatus } from "@/lib/realtime";

export const dynamic = "force-dynamic";

/**
 * FR-24 sync-mode indicator (Firebase RTDB polling).
 */
export async function GET() {
  try {
    await requireAuth("view");
    return Response.json(await getSyncStatus());
  } catch (err) {
    return jsonError(err);
  }
}

/** Compatibility endpoint; there is no external sync queue. */
export async function POST() {
  try {
    await requireAuth("configure", { mutating: true });
    return Response.json({ ok: true, ...(await drainSyncOutbox()) });
  } catch (err) {
    return jsonError(err);
  }
}