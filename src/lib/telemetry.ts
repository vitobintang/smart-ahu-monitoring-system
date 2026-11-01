import {
  AHU_IDS,
  SENSOR_PARAMETERS,
  type AhuId,
  type SensorKey,
} from "./ahu";

export type TelemetryMessage = {
  messageId: string;
  ahuId: AhuId;
  measuredAt: string;
  readings: Partial<Record<SensorKey, number | null>>;
};

type ValidationResult =
  | { ok: true; value: TelemetryMessage }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateTelemetry(input: unknown): ValidationResult {
  if (!isRecord(input)) {
    return { ok: false, error: "Message must be an object." };
  }

  const allowedFields = ["messageId", "ahuId", "measuredAt", "readings"];

  if (Object.keys(input).some((key) => !allowedFields.includes(key))) {
    return { ok: false, error: "Unexpected message field." };
  }

  const { messageId, measuredAt } = input;

  if (
    typeof messageId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(messageId)
  ) {
    return { ok: false, error: "Invalid message ID." };
  }

  const ahuId = AHU_IDS.find((id) => id === input.ahuId);

  if (!ahuId) {
    return { ok: false, error: "Unknown AHU ID." };
  }

  if (
    typeof measuredAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(measuredAt)
  ) {
    return {
      ok: false,
      error: "Measurement time must be UTC ISO format with milliseconds.",
    };
  }

  const time = Date.parse(measuredAt);

  if (!Number.isFinite(time) || new Date(time).toISOString() !== measuredAt) {
    return { ok: false, error: "Invalid measurement time." };
  }

  if (!isRecord(input.readings) || Object.keys(input.readings).length === 0) {
    return { ok: false, error: "Readings must be a non-empty object." };
  }

  const readings: Partial<Record<SensorKey, number | null>> = {};

  for (const [key, value] of Object.entries(input.readings)) {
    const sensor = SENSOR_PARAMETERS.find((item) => item.key === key);

    if (!sensor) {
      return { ok: false, error: "Unknown sensor parameter." };
    }

    if (value === null) {
      readings[sensor.key] = null;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      readings[sensor.key] = value;
    } else {
      return { ok: false, error: "Readings must be finite numbers or null." };
    }
  }

  return {
    ok: true,
    value: { messageId, ahuId, measuredAt, readings },
  };
}