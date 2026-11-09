import type { RtdbAdapter } from "./store";
import { TELEMETRY_NODE, type RtdbTelemetryRecord } from "./telemetry";

/**
 * Phase 3 Slice 1: RTDB range reads over the day-sharded telemetry history
 * (telemetry/{ahuId}/{YYYY-MM-DD}/{messageId}).
 *
 * A report range spans at most MAX_REPORT_RANGE_DAYS (31) UTC days, so a
 * range read is at most ~32 shard gets issued in parallel. Any failed shard
 * REJECTS the whole read — the caller falls back to PostgreSQL rather than
 * presenting a silently incomplete report.
 */

/** Inclusive UTC calendar-day keys covering [fromMs, toMs], capped for safety. */
export function listUtcDays(fromMs: number, toMs: number, maxDays = 40): string[] {
  const days: string[] = [];
  const cursor = new Date(fromMs);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= toMs && days.length < maxDays) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * Reads every mirrored observation for one AHU within [fromMs, toMs],
 * optionally filtered by source, ascending by measurement timestamp.
 * Rejects if any day shard cannot be read (no partial results).
 */
export async function readTelemetryRange(
  rtdb: RtdbAdapter,
  ahuId: string,
  fromMs: number,
  toMs: number,
  source?: "ALL" | "PHYSICAL" | "SIMULATION",
): Promise<RtdbTelemetryRecord[]> {
  const days = listUtcDays(fromMs, toMs);
  const shards = await Promise.all(days.map((day) => rtdb.get<Record<string, RtdbTelemetryRecord>>(`${TELEMETRY_NODE}/${ahuId}/${day}`)));
  const out: RtdbTelemetryRecord[] = [];
  for (const shard of shards) {
    if (!shard) continue;
    for (const record of Object.values(shard)) {
      if (record.timestamp < fromMs || record.timestamp > toMs) continue;
      if (source && source !== "ALL" && record.source !== source) continue;
      out.push(record);
    }
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}
