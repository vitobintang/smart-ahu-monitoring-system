import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { syncState, telemetry } from "@/db/schema";

/**
 * Supabase PostgreSQL is the authoritative data store (replacing the
 * specification's MySQL + Firebase Realtime Database combination).
 * Browser clients poll the application API every ~5 s (FR-24).
 */
export type SyncMode = "CLOUD" | "LOCAL";
export type SyncChannel = "telemetry" | "status" | "alarm" | "trend" | "command" | "notification";

function detectDatabaseSyncMode(): SyncMode {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const dbUrl = process.env.DATABASE_URL?.trim() ?? "";
  try {
    if (supabaseUrl) {
      const { hostname } = new URL(supabaseUrl);
      if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
        return "CLOUD";
      }
    }
  } catch {
    /* ignore malformed URL here */
  }
  try {
    if (dbUrl) {
      const { hostname } = new URL(dbUrl);
      if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
        return "CLOUD";
      }
    }
  } catch {
    /* ignore malformed URL here */
  }
  return "LOCAL";
}

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
  const [stateRows, latestTelemetry] = await Promise.all([
    db.select().from(syncState).where(eq(syncState.id, 1)).limit(1),
    db.select({ latestAt: sql<Date | null>`max(${telemetry.timestamp})` }).from(telemetry),
  ]);
  const state = stateRows[0];
  const mode = detectDatabaseSyncMode();
  const latestAt = latestTelemetry[0]?.latestAt ? new Date(latestTelemetry[0].latestAt) : null;
  return {
    mode,
    firebaseConfigured: false,
    pollingIntervalSec: state?.pollingIntervalSec ?? 5,
    lastSuccessAt: latestAt ?? state?.lastSuccessAt ?? new Date(),
    lastError: null,
    queuedItems: 0,
  };
}
