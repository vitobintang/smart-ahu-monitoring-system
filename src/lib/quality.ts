import type { DataSource } from "./ahu";

export type ReadingQuality =
  | "UNINSTALLED"
  | "STALE"
  | "NULL_UNAVAILABLE"
  | "ESTIMATED_FALLBACK"
  | "SIMULATED"
  | "OK"
  | "SOURCE_UNKNOWN";

export type ReadingQualityInput = {
  installed: boolean;
  stale: boolean;
  value: number | null | undefined;
  isFallback: boolean;
  source: DataSource | null;
};

export function classifyReadingQuality(input: ReadingQualityInput): ReadingQuality {
  if (!input.installed) {
    return "UNINSTALLED";
  }

  if (input.stale) {
    return "STALE";
  }

  if (typeof input.value !== "number" || !Number.isFinite(input.value)) {
    return "NULL_UNAVAILABLE";
  }

  if (input.isFallback) {
    return "ESTIMATED_FALLBACK";
  }

  if (input.source === "SIMULATION") {
    return "SIMULATED";
  }

  if (input.source === "PHYSICAL") {
    return "OK";
  }

  return "SOURCE_UNKNOWN";
}