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
  readings?: {
    roomTemp: number | null;
    humidity: number | null;
  }
}): SimulationResult {
  const result = validateTelemetry({
    ahuId: input.ahuId,
    messageId: input.messageId,
    measuredAt: input.measuredAt,
    readings:
      input.readings === undefined
        ? { roomTemp: 22, humidity: 50 }
        : input.readings,
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