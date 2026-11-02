import { validateTelemetry } from "./telemetry";

export function validateReferenceTelemetry(
  input: unknown,
): ReturnType<typeof validateTelemetry> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "Reference message must be an object." };
  }

  const message = input as Record<string, unknown>;
  const supportedFields = ["messageId", "ahuId", "timestamp", "parameters"];

  if (Object.keys(message).some((key) => !supportedFields.includes(key))) {
    return { ok: false, error: "Unsupported reference message field." };
  }

  return validateTelemetry({
    messageId: message.messageId,
    ahuId: message.ahuId,
    measuredAt: message.timestamp,
    readings: message.parameters,
  });
}