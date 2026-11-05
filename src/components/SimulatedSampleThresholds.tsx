"use client";

import { useState } from "react";

import {
  classifyThreshold,
  type ThresholdObservation,
} from "../lib/threshold-observation";

type Range = "A" | "B" | "C";

type Readings = {
  roomTemp: number | null;
  humidity: number | null;
};

const EXAMPLE_RANGES = {
  A: {
    temperature: { lower: 20, upper: 24 },
    humidity: { lower: 40, upper: 60 },
  },
  B: {
    temperature: { lower: 23, upper: 27 },
    humidity: { lower: 55, upper: 65 },
  },
  C: {
    temperature: { lower: 17, upper: 21 },
    humidity: { lower: 35, upper: 45 },
  },
} as const;

// The fresh flag is used only for this newly generated fictional sample.
// This does not assess freshness or safety of real telemetry.
export function assessSimulatedSample(
  readings: Readings,
  range: Range,
): {
  temperature: ThresholdObservation;
  humidity: ThresholdObservation;
} {
  const limits = EXAMPLE_RANGES[range];

  function assess(
    value: number | null,
    lower: number,
    upper: number,
  ): ThresholdObservation {
    const result = classifyThreshold({
      value,
      lower,
      upper,
      fresh: true,
    });

    return result.ok === true ? result.observation : "UNKNOWN";
  }

  return {
    temperature: assess(
      readings.roomTemp,
      limits.temperature.lower,
      limits.temperature.upper,
    ),
    humidity: assess(
      readings.humidity,
      limits.humidity.lower,
      limits.humidity.upper,
    ),
  };
}

export default function SimulatedSampleThresholds({
  hasSample,
  roomTemp,
  humidity,
}: {
  hasSample: boolean;
  roomTemp: number | null;
  humidity: number | null;
}) {
  const [range, setRange] = useState<Range>("A");
  const limits = EXAMPLE_RANGES[range];

  const result = hasSample
    ? assessSimulatedSample({ roomTemp, humidity }, range)
    : null;

  return (
    <section
      aria-labelledby="sample-threshold-heading"
      className="mt-6 rounded-2xl border border-violet-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <h2
        id="sample-threshold-heading"
        className="text-xl font-bold text-[#12294d]"
      >
        Simulated sample: example ranges
      </h2>

      <p className="mt-2 text-sm leading-6 text-slate-600">
        Compare the generated fictional sample with illustrative ranges.
        These are not equipment settings, real alarms, or evidence that a
        machine is safe. The values and units require equipment confirmation.
      </p>

      <label
        htmlFor="sample-example-range"
        className="mt-4 block text-sm font-semibold text-slate-700"
      >
        Example range
      </label>

      <select
        id="sample-example-range"
        value={range}
        onChange={(event) => {
          const next = event.target.value;

          if (next === "A" || next === "B" || next === "C") {
            setRange(next);
          }
        }}
        className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
      >
        <option value="A">Example A</option>
        <option value="B">Example B</option>
        <option value="C">Example C</option>
      </select>

      <p className="mt-3 text-sm text-slate-600">
        Example temperature: {limits.temperature.lower}–
        {limits.temperature.upper} °C; example humidity:{" "}
        {limits.humidity.lower}–{limits.humidity.upper} %RH.
      </p>

      <div aria-live="polite" className="mt-4 text-sm text-slate-700">
        {result === null ? (
          <p>Generate a simulated sample to compare it.</p>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="font-semibold">
                Example room temperature comparison
              </dt>
              <dd>{result.temperature}</dd>
            </div>

            <div>
              <dt className="font-semibold">
                Example humidity comparison
              </dt>
              <dd>{result.humidity}</dd>
            </div>
          </dl>
        )}
      </div>

      <p className="mt-4 text-xs leading-5 text-slate-500">
        Single-sample comparison only. No alarm is created, cleared, saved,
        or sent.
      </p>
    </section>
  );
}