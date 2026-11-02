import type { ReportTimelinePoint } from "./report-selection";
import {
  summarizeReadings,
  type ReadingSummary,
} from "./report-summary";

const HOUR_MS = 60 * 60 * 1000;
const MAX_WINDOW_MS = 31 * 24 * HOUR_MS;
const MAX_EXAMPLE_POINTS = 100;

export type FictionalInterval = {
  start: string;
  end: string;
  summary: ReadingSummary | null;
  excluded: number;
};

function utcTime(value: unknown): number | null {
  if (typeof value !== "string") return null;

  const date = new Date(value);
  const time = date.getTime();

  return Number.isFinite(time) && date.toISOString() === value
    ? time
    : null;
}

// Fixed fictional data only. Callers must filter unit, source, parameter and
// window first. This does not establish real sensor quality or completeness.
export function summarizeFictionalIntervals(
  points: readonly ReportTimelinePoint[],
  start: string,
  end: string,
): FictionalInterval[] | null {
  const startMs = utcTime(start);
  const endMs = utcTime(end);

  if (
    startMs === null ||
    endMs === null ||
    startMs >= endMs ||
    endMs - startMs > MAX_WINDOW_MS ||
    !Array.isArray(points) ||
    points.length > MAX_EXAMPLE_POINTS
  ) {
    return null;
  }

  const buckets = Array.from(
    { length: Math.ceil((endMs - startMs) / HOUR_MS) },
    (_, index) => {
      const bucketStart = startMs + index * HOUR_MS;

      return {
        start: new Date(bucketStart).toISOString(),
        end: new Date(
          Math.min(bucketStart + HOUR_MS, endMs),
        ).toISOString(),
        values: [] as number[],
        excluded: 0,
      };
    },
  );

  for (const point of points) {
    if (!point || typeof point !== "object") return null;

    const time = utcTime(point.measuredAt);

    if (time === null || time < startMs || time >= endMs) {
      return null;
    }

    const bucket = buckets[Math.floor((time - startMs) / HOUR_MS)];

    if (point.exclusion === null) {
      if (
        typeof point.value !== "number" ||
        !Number.isFinite(point.value)
      ) {
        return null;
      }

      bucket.values.push(point.value);
    } else {
      if (
        point.value !== null ||
        (point.exclusion !== "MISSING" &&
          point.exclusion !== "ESTIMATED" &&
          point.exclusion !== "UNAVAILABLE")
      ) {
        return null;
      }

      bucket.excluded++;
    }
  }

  return buckets.map((bucket) => ({
    start: bucket.start,
    end: bucket.end,
    summary: summarizeReadings(bucket.values),
    excluded: bucket.excluded,
  }));
}