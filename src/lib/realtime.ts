import { eq } from "drizzle-orm";
import { db } from "@/db";
import { syncState } from "@/db/schema";

/** The Supabase database is the only data store. Browser clients poll the
 * application API; telemetry has already been committed before publication. */
export type SyncMode = "LOCAL";
export type SyncChannel = "telemetry" | "status" | "alarm" | "trend" | "command" | "notification";

export async function publishRealtime(
  _channel: SyncChannel,
  _ahuId: string | null,
  _payload: Record<string, unknown>,
): Promise<{ queued: boolean; delivered: boolean; error?: string }> {
  return { queued: false, delivered: false };
}

/** Kept for API compatibility; there is no external database retry queue. */
export async function drainSyncOutbox(): Promise<{ retried: number; sent: number; failed: number }> {
  return { retried: 0, sent: 0, failed: 0 };
}

export async function getSyncStatus() {
  const [state] = await db.select().from(syncState).where(eq(syncState.id, 1)).limit(1);
  return {
    mode: "LOCAL" as const,
    firebaseConfigured: false,
    pollingIntervalSec: state?.pollingIntervalSec ?? 5,
    lastSuccessAt: state?.lastSuccessAt ?? null,
    lastError: null,
    queuedItems: 0,
  };
}