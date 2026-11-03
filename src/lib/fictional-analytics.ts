import { AHU_IDS } from "./ahu";

// Fixed illustration data, not a backend contract or operational measurements.
export type ExampleMetric =
  | "roomTemp"
  | "humidity"
  | "current"
  | "voltage"
  | "filterPressure";

export type ExamplePoint = {
  step: number;
  roomTemp: number | null;
  humidity: number | null;
  current: number | null;
  voltage: number | null;
  filterPressure: number | null;
  runHours: number | null;
};

export const EXAMPLE_METRICS: Record<
  ExampleMetric,
  { label: string; unit: string }
> = {
  roomTemp: { label: "Room temperature", unit: "°C" },
  humidity: { label: "Humidity", unit: "%" },
  current: { label: "Current", unit: "A" },
  voltage: { label: "Voltage", unit: "V" },
  filterPressure: { label: "Filter pressure", unit: "Pa" },
};

export function examplePoints(unit: string): ExamplePoint[] {
  const index = AHU_IDS.findIndex((id) => id === unit);

  if (index < 0) {
    throw new Error("Unknown example unit");
  }

  return Array.from({ length: 6 }, (_, i) => {
    const missing = i === 3;

    return {
      step: i + 1,
      roomTemp: missing ? null : 20 + index + i * 0.5,
      humidity: missing ? null : 40 + index + i,

      current: missing
        ? null
        : Number((2 + index * 0.2 + i * 0.1).toFixed(1)),

      voltage:
        missing || (index === 1 && i === 5)
          ? null
          : 220 + index,

      filterPressure:
        missing || (index === 2 && i === 5)
          ? null
          : 60 + index * 5 + i * 2,

      runHours: missing ? null : 100 + index * 10 + i,
    };
  });
}

export function summarizeExample(values: (number | null)[]) {
  const present = values.filter(
    (value): value is number =>
      value !== null && Number.isFinite(value),
  );

  return {
    included: present.length,
    missing: values.length - present.length,
    min: present.length ? Math.min(...present) : null,
    max: present.length ? Math.max(...present) : null,

    average: present.length
      ? present.reduce((sum, value) => sum + value, 0) /
        present.length
      : null,
  };
}