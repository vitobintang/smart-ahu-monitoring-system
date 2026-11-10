import type { RtdbAdapter } from "./store";
import { DEVICE_HISTORY_NODE, snapshotToRecord, type RtdbTelemetryRecord } from "./telemetry";

/**
 * RTDB range reads over the day-sharded device history
 * (deviceHistory/{id}/{YYYY-MM-DD}/{s21-{id}-{ts}} — verbatim owner-format
 * snapshots). Every stored snapshot is synthesized into the stable
 * RtdbTelemetryRecord view before filtering/returning.
 *
 * A report range spans at most MAX_REPORT_RANGE_DAYS (31) UTC days, so a
 * range read is at most ~32 shard gets issued in parallel. Any failed shard
 * REJECTS the whole read rather than presenting a silently incomplete report.
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

function shardToRecords(ahuId: string, shard: Record<string, unknown> | null): RtdbTelemetryRecord[] {
  if (!shard) return [];
  const out: RtdbTelemetryRecord[] = [];
  for (const value of Object.values(shard)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = snapshotToRecord(ahuId, value as Record<string, unknown>);
    if (record) out.push(record);
  }
  return out;
}

/**
 * Reads every stored snapshot for one device within [fromMs, toMs], optionally
 * filtered by source, ascending by measurement timestamp. Rejects if any day
 * shard cannot be read (no partial results).
 */
export async function readTelemetryRange(
  rtdb: RtdbAdapter,
  ahuId: string,
  fromMs: number,
  toMs: number,
  source?: "ALL" | "PHYSICAL" | "SIMULATION",
): Promise<RtdbTelemetryRecord[]> {
  const days = listUtcDays(fromMs, toMs);
  const shards = await Promise.all(days.map((day) => rtdb.get<Record<string, unknown>>(`${DEVICE_HISTORY_NODE}/${ahuId}/${day}`)));
  const out: RtdbTelemetryRecord[] = [];
  for (const shard of shards) {
    for (const record of shardToRecords(ahuId, shard)) {
      if (record.timestamp < fromMs || record.timestamp > toMs) continue;
      if (source && source !== "ALL" && record.source !== source) continue;
      out.push(record);
    }
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

/**
 * Descending chunked iteration for the CSV exporter: reads one UTC day shard
 * at a time (RAM bounded per shard), newest day first, records within a day
 * newest first. A shard failure mid-stream throws — the caller's stream errors
 * and the client sees a truncated download, which the CSV contract already
 * accepts for transient storage failures.
 */
export async function* streamTelemetryRangeDescending(
  rtdb: RtdbAdapter,
  ahuId: string,
  fromMs: number,
  toMs: number,
  source: "ALL" | "PHYSICAL" | "SIMULATION",
  chunkSize = 1000,
): AsyncGenerator<RtdbTelemetryRecord[]> {
  const days = listUtcDays(fromMs, toMs).reverse();
  for (const day of days) {
    const shard = await rtdb.get<Record<string, unknown>>(`${DEVICE_HISTORY_NODE}/${ahuId}/${day}`);
    if (!shard) continue;
    const dayRecords = shardToRecords(ahuId, shard)
      .filter(
        (r) =>
          r.timestamp >= fromMs &&
          r.timestamp <= toMs &&
          (source === "ALL" || r.source === source),
      )
      .sort((a, b) => b.timestamp - a.timestamp);
    for (let i = 0; i < dayRecords.length; i += chunkSize) {
      yield dayRecords.slice(i, i + chunkSize);
    }
  }
}
