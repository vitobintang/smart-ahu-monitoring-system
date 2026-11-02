import { AHU_IDS } from "./ahu";
import type { MonitoringUnit } from "../db/monitoring";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseMonitoringResponse(
  input: unknown,
): MonitoringUnit[] | null {
  if (
    !isRecord(input) ||
    !Array.isArray(input.units) ||
    input.units.length > AHU_IDS.length
  ) {
    return null;
  }

  const units: MonitoringUnit[] = [];
  const seen = new Set<string>();

  for (const row of input.units) {
    if (
      !isRecord(row) ||
      typeof row.id !== "string" ||
      typeof row.name !== "string" ||
      typeof row.location !== "string" ||
      !AHU_IDS.some((id) => id === row.id) ||
      seen.has(row.id)
    ) {
      return null;
    }

    seen.add(row.id);
    units.push({ id: row.id, name: row.name, location: row.location });
  }

  return units;
}