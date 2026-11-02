import { AHU_IDS } from "./ahu";

type Source = "PHYSICAL" | "SIMULATION";
type TimestampStatus = "unknown" | "future" | "past_or_present";
type Sensor = { configured: boolean; value: number | null };

export type HistoricalObservation = {
  ahuId: string;
  configuredSource: Source | null;
  observedSource: Source | null;
  measuredAt: string | null;
  timestampStatus: TimestampStatus;
  roomTemp: Sensor;
  humidity: Sensor;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSource(value: unknown): value is Source {
  return value === "PHYSICAL" || value === "SIMULATION";
}

function parseSensor(input: unknown): Sensor | null {
  if (!isRecord(input) || typeof input.configured !== "boolean") {
    return null;
  }

  const value = input.value;

  if (
    value !== null &&
    (typeof value !== "number" || !Number.isFinite(value))
  ) {
    return null;
  }

  if (!input.configured && value !== null) {
    return null;
  }

  return {
    configured: input.configured,
    value: value as number | null,
  };
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const date = new Date(value);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString() === value
  );
}

export function parseHistoricalObservations(
  input: unknown,
): HistoricalObservation[] | null {
  if (
    !isRecord(input) ||
    !Array.isArray(input.observations) ||
    input.observations.length > AHU_IDS.length
  ) {
    return null;
  }

  const seen = new Set<string>();
  const observations: HistoricalObservation[] = [];

  for (const row of input.observations) {
    if (
      !isRecord(row) ||
      typeof row.ahuId !== "string" ||
      !AHU_IDS.some((id) => id === row.ahuId) ||
      seen.has(row.ahuId)
    ) {
      return null;
    }

    const configuredSource = row.configuredSource;
    const observedSource = row.observedSource;

    if (
      (configuredSource !== null && !isSource(configuredSource)) ||
      (observedSource !== null && !isSource(observedSource)) ||
      (observedSource !== null && observedSource !== configuredSource)
    ) {
      return null;
    }

    const roomTemp = parseSensor(row.roomTemp);
    const humidity = parseSensor(row.humidity);

    if (roomTemp === null || humidity === null) {
      return null;
    }

    const measuredAt = row.measuredAt;
    const timestampStatus = row.timestampStatus;

    if (observedSource === null) {
      if (
        measuredAt !== null ||
        timestampStatus !== "unknown" ||
        roomTemp.value !== null ||
        humidity.value !== null
      ) {
        return null;
      }
    } else {
      if (
        !isTimestamp(measuredAt) ||
        (timestampStatus !== "future" &&
          timestampStatus !== "past_or_present")
      ) {
        return null;
      }

      if (
        timestampStatus === "future" &&
        (roomTemp.value !== null || humidity.value !== null)
      ) {
        return null;
      }
    }

    seen.add(row.ahuId);

    observations.push({
      ahuId: row.ahuId,
      configuredSource: configuredSource as Source | null,
      observedSource: observedSource as Source | null,
      measuredAt: measuredAt as string | null,
      timestampStatus: timestampStatus as TimestampStatus,
      roomTemp,
      humidity,
    });
  }

  return observations;
}