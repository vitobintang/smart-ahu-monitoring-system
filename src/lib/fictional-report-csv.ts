import type { ReportTimelinePoint } from "./report-selection";

const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_EXAMPLE_POINTS = 100;

type ExampleInput = {
  ahuId: "AHU-01" | "AHU-02";
  start: string;
  end: string;
  points: readonly ReportTimelinePoint[];
};

function utcTime(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return null;
  }

  const date = new Date(value);
  const time = date.getTime();

  return Number.isFinite(time) && date.toISOString() === value
    ? time
    : null;
}

function csvLine(cells: readonly (string | number)[]): string {
  return cells
    .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
    .join(",");
}

// Fictional fixed-sample export only; not a real-data reporting interface.
export function buildFictionalReportCsv(
  input: ExampleInput,
): string | null {
  if (
    !input ||
    (input.ahuId !== "AHU-01" && input.ahuId !== "AHU-02")
  ) {
    return null;
  }

  const start = utcTime(input.start);
  const end = utcTime(input.end);

  if (
    start === null ||
    end === null ||
    start >= end ||
    end - start > MAX_WINDOW_MS ||
    !Array.isArray(input.points) ||
    input.points.length > MAX_EXAMPLE_POINTS
  ) {
    return null;
  }

  const lines = [
    csvLine(["Notice", "FICTIONAL EXAMPLE - NOT REAL AHU DATA", ""]),
    csvLine(["Example AHU", input.ahuId, ""]),
    csvLine(["Source", "SIMULATION", ""]),
    csvLine(["Parameter", "roomTemp", ""]),
    csvLine(["Unit", "example units (not confirmed)", ""]),
    csvLine(["Start UTC (inclusive)", input.start, ""]),
    csvLine(["End UTC (exclusive)", input.end, ""]),
    csvLine(["", "", ""]),
    csvLine(["Measured at UTC", "Example value", "Selection"]),
  ];

  for (const point of input.points) {
    if (!point || typeof point !== "object") return null;

    const time = utcTime(point.measuredAt);

    if (time === null || time < start || time >= end) {
      return null;
    }

    if (point.exclusion === null) {
      if (
        typeof point.value !== "number" ||
        !Number.isFinite(point.value)
      ) {
        return null;
      }

      lines.push(csvLine([point.measuredAt, point.value, "INCLUDED"]));
    } else {
      if (
        point.value !== null ||
        (point.exclusion !== "MISSING" &&
          point.exclusion !== "ESTIMATED" &&
          point.exclusion !== "UNAVAILABLE")
      ) {
        return null;
      }

      lines.push(
        csvLine([
          point.measuredAt,
          "",
          `${point.exclusion} - EXCLUDED`,
        ]),
      );
    }
  }

  return `${lines.join("\r\n")}\r\n`;
}