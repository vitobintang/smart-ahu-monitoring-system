export type ThresholdObservation = "LOW" | "NORMAL" | "HIGH" | "UNKNOWN";

export type ThresholdInput = {
  value: number | null;
  lower: number | null;
  upper: number | null;
  fresh: boolean;
};

type ThresholdResult =
  | { ok: true; observation: ThresholdObservation }
  | { ok: false; error: string };

// This only classifies one observation. It does not create or clear alarms.
export function classifyThreshold(input: ThresholdInput): ThresholdResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "Invalid input." };
  }

  const { value, lower, upper, fresh } = input;

  if (
    (lower !== null && (typeof lower !== "number" || !Number.isFinite(lower))) ||
    (upper !== null && (typeof upper !== "number" || !Number.isFinite(upper))) ||
    (lower === null && upper === null) ||
    (lower !== null && upper !== null && lower >= upper)
  ) {
    return { ok: false, error: "Invalid limits." };
  }

  if (
    typeof fresh !== "boolean" ||
    (value !== null && typeof value !== "number")
  ) {
    return { ok: false, error: "Invalid observation." };
  }

  if (!fresh || value === null || !Number.isFinite(value)) {
    return { ok: true, observation: "UNKNOWN" };
  }

  if (lower !== null && value < lower) {
    return { ok: true, observation: "LOW" };
  }

  if (upper !== null && value > upper) {
    return { ok: true, observation: "HIGH" };
  }

  return { ok: true, observation: "NORMAL" };
}