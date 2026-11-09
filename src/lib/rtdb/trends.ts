import type { RtdbAdapter } from "./store";

/**
 * Trend-alert tree — the RTDB replacement for the legacy `trend_alerts`
 * table (computed by the trend worker from recent telemetry projections).
 *
 * Tree layout (epoch-ms timestamps):
 *   trendAlerts/{id} → full trend-alert record
 *
 * Alerts are append-mostly: the trend worker inserts, users acknowledge.
 * Detection is id-keyed with no cross-record invariants, so writes are
 * simple sets/patches. Reads needed by the app: per-AHU unacknowledged
 * counts (dashboard tile), unacknowledged feed (notifications) and the
 * per-AHU history (unit detail page).
 */

export const TREND_ALERTS_NODE = "trendAlerts";

/** Epoch-ms flattened `trend_alerts` row. */
export interface RtdbTrendRecord {
  id: string;
  ahuId: string;
  parameter: string;
  estimatedMin: number;
  direction: string;
  isReliable: boolean;
  unreliabilityReason: string | null;
  sampleCount: number;
  variance: number | null;
  slopePerMin: number | null;
  currentValue: number | null;
  projectedValue: number | null;
  thresholdValue: number | null;
  minutesToBreach: number | null;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: number | null;
  createdAt: number;
}

export async function writeRtdbTrendAlert(rtdb: RtdbAdapter, record: RtdbTrendRecord): Promise<void> {
  await rtdb.set(`${TREND_ALERTS_NODE}/${record.id}`, record);
}

export async function ackRtdbTrendAlert(rtdb: RtdbAdapter, id: string, by: string | null, at: number): Promise<void> {
  await rtdb.update(`${TREND_ALERTS_NODE}/${id}`, { acknowledged: true, acknowledgedBy: by, acknowledgedAt: at });
}

/**
 * Per-AHU unacknowledged counts — the RTDB replacement for the dashboard's
 * `count(*) filter (where not acknowledged) group by ahu_id` query.
 */
export async function readRtdbTrendCounts(rtdb: RtdbAdapter, ahuIds: string[]): Promise<Map<string, number>> {
  const tree = (await rtdb.get<Record<string, RtdbTrendRecord>>(TREND_ALERTS_NODE)) ?? {};
  const counts = new Map<string, number>(ahuIds.map((id) => [id, 0]));
  for (const record of Object.values(tree)) {
    if (!record.acknowledged && counts.has(record.ahuId)) {
      counts.set(record.ahuId, (counts.get(record.ahuId) ?? 0) + 1);
    }
  }
  return counts;
}

/** Fleet-wide unacknowledged alerts, newest first (notifications feed). */
export async function readRtdbUnackedTrends(rtdb: RtdbAdapter, limit = 100): Promise<RtdbTrendRecord[]> {
  const tree = (await rtdb.get<Record<string, RtdbTrendRecord>>(TREND_ALERTS_NODE)) ?? {};
  return Object.values(tree)
    .filter((r) => !r.acknowledged)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/** One AHU's full trend-alert history, newest first (unit detail page). */
export async function readRtdbTrendHistory(rtdb: RtdbAdapter, ahuId: string, limit = 25): Promise<RtdbTrendRecord[]> {
  const tree = (await rtdb.get<Record<string, RtdbTrendRecord>>(TREND_ALERTS_NODE)) ?? {};
  return Object.values(tree)
    .filter((r) => r.ahuId === ahuId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/** Maps a record onto the trend_alerts row shape the UI expects (Dates). */
export function trendToRow(record: RtdbTrendRecord): Record<string, unknown> {
  // `n()` restores nulls RTDB stripped (see live-read.ts).
  const n = <T,>(value: T | undefined): T | null => (value === undefined ? null : (value as T));
  return {
    id: record.id,
    ahuId: record.ahuId,
    parameter: record.parameter,
    estimatedMin: record.estimatedMin,
    direction: record.direction,
    isReliable: record.isReliable,
    unreliabilityReason: n(record.unreliabilityReason),
    sampleCount: record.sampleCount,
    variance: n(record.variance),
    slopePerMin: n(record.slopePerMin),
    currentValue: n(record.currentValue),
    projectedValue: n(record.projectedValue),
    thresholdValue: n(record.thresholdValue),
    minutesToBreach: n(record.minutesToBreach),
    acknowledged: record.acknowledged,
    acknowledgedBy: n(record.acknowledgedBy),
    acknowledgedAt: record.acknowledgedAt == null ? null : new Date(record.acknowledgedAt),
    createdAt: new Date(record.createdAt),
  };
}
