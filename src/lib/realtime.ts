import { eq, sql } from "drizzle-orm";
import { db, summarizeDbError } from "@/db";
import { syncState, telemetry } from "@/db/schema";
import { tryGetAhuRtdb } from "@/lib/rtdb/live-read";

/**
 * Supabase PostgreSQL is the authoritative data store (replacing the
 * specification's MySQL + Firebase Realtime Database combination).
 * Browser clients poll the application API every ~5 s (FR-24).
 */
export type SyncMode = "CLOUD" | "LOCAL";
export type SyncChannel = "telemetry" | "status" | "alarm" | "trend" | "command" | "notification";

export interface SyncStatusSnapshot {
  mode: SyncMode;
  firebaseConfigured: boolean;
  pollingIntervalSec: number;
  lastSuccessAt: Date;
  lastError: string | null;
  queuedItems: number;
}

const g = globalThis as typeof globalThis & {
  __ahuSyncStatusCache?: { value: SyncStatusSnapshot; expiresAt: number };
  __ahuSyncStatusInFlight?: Promise<SyncStatusSnapshot> | null;
};

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

export async function getSyncStatus(): Promise<SyncStatusSnapshot> {
  const now = Date.now();
  if (g.__ahuSyncStatusCache && g.__ahuSyncStatusCache.expiresAt > now) {
    return g.__ahuSyncStatusCache.value;
  }
  if (g.__ahuSyncStatusInFlight) {
    return g.__ahuSyncStatusInFlight;
  }

  const mode = detectDatabaseSyncMode();

  const task = (async (): Promise<SyncStatusSnapshot> => {
    // Phase 5b slice 3: the sync-health snapshot reports the RTDB primary
    // (latest telemetry pointer) when Firebase is configured.
    try {
      const rtdb = await tryGetAhuRtdb();
      if (rtdb) {
        const { listAllRtdbUsers } = await import("@/lib/rtdb/users");
        void listAllRtdbUsers; // no-op; keep import graph minimal
        const { getLatestTelemetry } = await import("@/lib/rtdb/telemetry");
        const { readRtdbAhus } = await import("@/lib/rtdb/registry");
        const registry = await readRtdbAhus(rtdb);
        let latestAt: Date | null = null;
        for (const id of registry.keys()) {
          const latest = await getLatestTelemetry(rtdb, id);
          if (latest && (latestAt === null || latest.timestamp > latestAt.getTime())) {
            latestAt = new Date(latest.timestamp);
          }
        }
        const snapshot: SyncStatusSnapshot = {
          mode,
          firebaseConfigured: true,
          pollingIntervalSec: 5,
          lastSuccessAt: latestAt ?? new Date(),
          lastError: null,
          queuedItems: 0,
        };
        g.__ahuSyncStatusCache = { value: snapshot, expiresAt: Date.now() + 5_000 };
        return snapshot;
      }
    } catch (err) {
      console.error("[sync] RTDB status failed, using PostgreSQL:", err instanceof Error ? err.message : err);
    }
    try {
      // Sequential single-socket reads prevent acquiring 2 pool slots per session check
      const stateRows = await db.select().from(syncState).where(eq(syncState.id, 1)).limit(1);
      const latestTelemetry = await db
        .select({ latestAt: sql<Date | null>`max(${telemetry.timestamp})` })
        .from(telemetry);
      const state = stateRows[0];
      const latestAt = latestTelemetry[0]?.latestAt ? new Date(latestTelemetry[0].latestAt) : null;
      const snapshot: SyncStatusSnapshot = {
        mode,
        firebaseConfigured: false,
        pollingIntervalSec: state?.pollingIntervalSec ?? 5,
        lastSuccessAt: latestAt ?? state?.lastSuccessAt ?? new Date(),
        lastError: null,
        queuedItems: 0,
      };
      g.__ahuSyncStatusCache = { value: snapshot, expiresAt: Date.now() + 5_000 };
      return snapshot;
    } catch (err) {
      const prev = g.__ahuSyncStatusCache?.value;
      return {
        mode,
        firebaseConfigured: false,
        pollingIntervalSec: prev?.pollingIntervalSec ?? 5,
        lastSuccessAt: prev?.lastSuccessAt ?? new Date(),
        lastError: summarizeDbError(err),
        queuedItems: 0,
      };
    } finally {
      g.__ahuSyncStatusInFlight = null;
    }
  })();

  g.__ahuSyncStatusInFlight = task;
  return task;
}
