import { validateTelemetry, type TelemetryMessage } from "./telemetry";

type SimulationResult =
  | {
      ok: true;
      sample: {
        source: "SIMULATION";
        message: TelemetryMessage;
      };
    }
  | {
      ok: false;
      error: string;
    };

export function createSimulationSample(input: {
  ahuId: unknown;
  messageId: unknown;
  measuredAt: unknown;
}): SimulationResult {
  const result = validateTelemetry({
    ahuId: input.ahuId,
    messageId: input.messageId,
    measuredAt: input.measuredAt,
    readings: {
      roomTemp: 22,
      humidity: 50,
    },
  });

  if (result.ok === false) {
    return result;
  }

  return {
    ok: true,
    sample: {
      source: "SIMULATION",
      message: result.value,
    },
  };
}