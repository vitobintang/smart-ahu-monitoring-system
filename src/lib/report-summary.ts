export type ReadingSummary = {
  count: number;
  min: number;
  max: number;
  average: number;
};

// Values must already be filtered for the requested AHU, source and time range.
export function summarizeReadings(values: unknown): ReadingSummary | null {
  if (!Array.isArray(values)) {
    return null;
  }

  let count = 0;
  let min = Infinity;
  let max = -Infinity;
  let average = 0;

  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }

    count++;
    min = Math.min(min, value);
    max = Math.max(max, value);

    const delta = value - average;
    average = Number.isFinite(delta)
      ? average + delta / count
      : average * ((count - 1) / count) + value / count;
  }

  return count === 0 ? null : { count, min, max, average };
}