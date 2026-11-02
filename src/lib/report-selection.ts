import { AHU_IDS, SENSOR_PARAMETERS, type SensorKey } from "./ahu";

const MAX_REPORT_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

export type ReportSource = "PHYSICAL" | "SIMULATION";
type Quality = "VALID" | "MISSING" | "ESTIMATED";

export type ReportFilter = {
  ahuId: string;
  source: ReportSource;
  parameter: SensorKey;
  start: string;
  end: string;
};

type Selection =
  | {
      ok: true;
      values: number[];
      matched: number;
      excluded: number;
    }
  | {
      ok: false;
      error: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSource(value: unknown): value is ReportSource {
  return value === "PHYSICAL" || value === "SIMULATION";
}

function isQuality(value: unknown): value is Quality {
  return value === "VALID" || value === "MISSING" || value === "ESTIMATED";
}

function isParameter(value: unknown): value is SensorKey {
  return (
    typeof value === "string" &&
    SENSOR_PARAMETERS.some((sensor) => sensor.key === value)
  );
}

function utcTime(value: unknown): number | null {
  if (typeof value !== "string") return null;

  const date = new Date(value);
  const time = date.getTime();

  return Number.isFinite(time) && date.toISOString() === value
    ? time
    : null;
}

// Inputs must come from a trusted source and validated equipment configuration.
// This helper does not authenticate data or establish sensor quality.
export function selectReportReadings(
  input: unknown,
  filter: ReportFilter,
): Selection {
  if (
    !isRecord(filter) ||
    typeof filter.ahuId !== "string" ||
    !AHU_IDS.some((id) => id === filter.ahuId) ||
    !isSource(filter.source) ||
    !isParameter(filter.parameter)
  ) {
    return { ok: false, error: "Invalid report filter." };
  }

  const start = utcTime(filter.start);
  const end = utcTime(filter.end);

  if (
    start === null ||
    end === null ||
    start >= end ||
    end - start > MAX_REPORT_WINDOW_MS
  ) {
    return { ok: false, error: "Invalid report time range." };
  }

  if (!Array.isArray(input)) {
    return { ok: false, error: "Invalid readings." };
  }

  const values: number[] = [];
  let matched = 0;
  let excluded = 0;

  for (const row of input) {
    if (
      !isRecord(row) ||
      typeof row.ahuId !== "string" ||
      !AHU_IDS.some((id) => id === row.ahuId) ||
      !isSource(row.source) ||
      !isParameter(row.parameter) ||
      !isQuality(row.quality) ||
      (row.value !== null && typeof row.value !== "number")
    ) {
      return { ok: false, error: "Invalid reading." };
    }

    const time = utcTime(row.measuredAt);

    if (time === null) {
      return { ok: false, error: "Invalid reading time." };
    }

    if (
      row.ahuId !== filter.ahuId ||
      row.source !== filter.source ||
      row.parameter !== filter.parameter ||
      time < start ||
      time >= end
    ) {
      continue;
    }

    matched++;

    if (
      row.quality !== "VALID" ||
      typeof row.value !== "number" ||
      !Number.isFinite(row.value)
    ) {
      excluded++;
      continue;
    }

    values.push(row.value);
  }

  return { ok: true, values, matched, excluded };
}