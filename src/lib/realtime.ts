import { requireRtdb } from "@/lib/rtdb/live-read";

/**
 * Firebase RTDB is the authoritative data store. Browser clients poll the
 * application API every ~5 s (FR-24).
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
  // The RTDB instance lives in asia-southeast1 — always the cloud path.
  return "CLOUD";
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
    try {
      const rtdb = await requireRtdb();
      const { getLatestTelemetry } = await import("@/lib/rtdb/telemetry");
      const { readActiveFleetRecords } = await import("@/lib/rtdb/local-fleet");
      const registry = await readActiveFleetRecords(rtdb);
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
    } catch (err) {
      const prev = g.__ahuSyncStatusCache?.value;
      const snapshot: SyncStatusSnapshot = {
        mode,
        firebaseConfigured: false,
        pollingIntervalSec: prev?.pollingIntervalSec ?? 5,
        lastSuccessAt: prev?.lastSuccessAt ?? new Date(),
        lastError: err instanceof Error ? err.message : String(err),
        queuedItems: 0,
      };
      g.__ahuSyncStatusCache = { value: snapshot, expiresAt: Date.now() + 5_000 };
      return snapshot;
    } finally {
      g.__ahuSyncStatusInFlight = null;
    }
  })();

  g.__ahuSyncStatusInFlight = task;
  return task;
}
