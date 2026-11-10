import { requireRtdb } from "@/lib/rtdb/live-read";
import { ingestTelemetryRtdb } from "@/lib/rtdb/lifecycle";

/* ------------------------------------------------------------------ */
/* FR-22 / FR-23 / NFR-04: telemetry ingestion                        */
/* ------------------------------------------------------------------ */

export interface TelemetryPayload {
  ahuId?: string;
  messageId?: string;
  timestamp?: string;
  parameters?: Record<string, number | null>;
  quality?: { current?: "measured" | "fallback"; voltage?: "measured" | "fallback" };
  runState?: string;
  faultCode?: string | null;
  setpoint?: number | null;
  controlMode?: string | null;
}

export interface IngestResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

/**
 * FR-22/23/NFR-04 telemetry ingestion — Phase 5c: the ENTIRE pipeline runs
 * RTDB-native (see src/lib/rtdb/lifecycle.ts). An unconfigured Firebase
 * environment is a fatal error, not a silent fallback.
 */
export async function ingestTelemetry(token: string, payload: TelemetryPayload): Promise<IngestResult> {
  const rtdb = await requireRtdb();
  if (!rtdb) throw new Error("Firebase RTDB is not configured");
  const { tryGetOwnerRtdb } = await import("@/lib/firebase/admin");
  const owner = await tryGetOwnerRtdb();
  const result = await ingestTelemetryRtdb(rtdb, token, payload, Date.now(), owner ?? undefined);
  return result as IngestResult;
}
