"use client";

import React, { useState } from "react";

type WindowMinutes = 5 | 15 | 30;

type ExamplePoint = {
  minute: number;
  running: boolean;
  current: number;
  temperature: number;
  humidity: number;
};

type Measurement = "current" | "temperature" | "humidity";

// One invented observation per example minute. This is not telemetry.
export function makeExamplePoints(
  endMinute: number,
  windowMinutes: WindowMinutes,
): ExamplePoint[] {
  return Array.from({ length: windowMinutes }, (_, index) => {
    const minute = endMinute - windowMinutes + index + 1;
    const running = minute % 5 !== 0;

    return {
      minute,
      running,
      current: running ? 4 + (minute % 3) * 0.4 : 0,
      temperature: 20 + (minute % 7) * 0.5,
      humidity: 45 + (minute % 6) * 2,
    };
  });
}

function Chart({
  points,
  field,
  label,
  unit,
}: {
  points: ExamplePoint[];
  field: Measurement;
  label: string;
  unit: string;
}) {
  const values = points.map((point) => point[field]);
  const min = Math.min(...values);
  const max = Math.max(...values);

  const coordinates = values
    .map((value, index) => {
      const x = 10 + (index / (values.length - 1)) * 300;

      const y =
        max === min
          ? 60
          : 100 - ((value - min) / (max - min)) * 80;

      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="font-semibold text-[#12294d]">
        {label}
      </h3>

      <p className="mt-1 text-xs text-slate-600">
        Fictional range: {min.toFixed(1)}–{max.toFixed(1)} {unit}
      </p>

      <svg
        viewBox="0 0 320 120"
        role="img"
        aria-label={`${label} fictional example chart. Latest value ${values[values.length - 1].toFixed(1)} ${unit}.`}
        className="mt-3 h-32 w-full rounded-lg bg-white"
      >
        <path d="M10 100 H310" stroke="#cbd5e1" />

        <polyline
          points={coordinates}
          fill="none"
          stroke="#2563eb"
          strokeWidth="3"
          strokeLinejoin="round"
        />
      </svg>

      <p className="mt-2 text-sm text-slate-700">
        Latest example:{" "}
        <strong>
          {values[values.length - 1].toFixed(1)} {unit}
        </strong>
      </p>
    </article>
  );
}

export default function FictionalPerformance() {
  const [windowMinutes, setWindowMinutes] =
    useState<WindowMinutes>(5);

  const [endMinute, setEndMinute] = useState(29);
  const [paused, setPaused] = useState(false);

  const points = makeExamplePoints(endMinute, windowMinutes);

  const runningCount = points.filter(
    (point) => point.running,
  ).length;

  const runPercent = (runningCount / points.length) * 100;

  return (
    <section
      aria-labelledby="fictional-performance-heading"
      className="mt-6 rounded-2xl border border-violet-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-violet-700">
            Fictional chart practice
          </p>

          <h2
            id="fictional-performance-heading"
            className="mt-2 text-xl font-bold text-[#12294d]"
          >
            Performance examples
          </h2>
        </div>

        <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-800">
          SIMULATED
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-600">
        Invented data only, independent of the sample above and the
        selected AHU. This is not live telemetry, history, equipment
        status, or a safety assessment. No data is sent or saved.
      </p>

      <p className="mt-2 text-sm leading-6 text-slate-600">
        One example point represents one fictional minute. There is
        no automatic playback or timer: use Advance example to move
        one step. Pause disables advancing; window selection remains
        available.
      </p>

      <div
        aria-label="Example chart window"
        className="mt-4 flex flex-wrap gap-2"
      >
        {([5, 15, 30] as const).map((minutes) => (
          <button
            key={minutes}
            type="button"
            aria-pressed={windowMinutes === minutes}
            onClick={() => setWindowMinutes(minutes)}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
              windowMinutes === minutes
                ? "border-blue-700 bg-blue-50 text-blue-800"
                : "border-slate-300 text-slate-700"
            }`}
          >
            {minutes} minutes
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          {paused ? "Resume example" : "Pause example"}
        </button>

        <button
          type="button"
          disabled={paused || endMinute >= 10000}
          onClick={() =>
            setEndMinute((value) => Math.min(value + 1, 10000))
          }
          className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          Advance example
        </button>

        <button
          type="button"
          onClick={() => {
            setEndMinute(29);
            setWindowMinutes(5);
            setPaused(false);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          Reset chart example
        </button>
      </div>

      <p aria-live="polite" className="mt-3 text-sm text-slate-700">
        {paused ? "Example paused" : "Example ready to advance"}.
        Fictional minute {endMinute}; showing {points.length}{" "}
        one-minute example points.
      </p>

      {endMinute >= 10000 && (
        <p className="mt-2 text-sm text-slate-600">
          Example limit reached. Reset to start again.
        </p>
      )}

      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="font-semibold text-[#12294d]">
          Example RUN sample proportion
        </h3>

        <p className="mt-2 text-2xl font-bold text-[#12294d]">
          {runPercent.toFixed(1)}%
        </p>

        <p className="mt-1 text-xs text-slate-600">
          {runningCount} of {points.length} fictional samples marked
          RUN; not a real unit status.
        </p>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Chart
          points={points}
          field="current"
          label="Current"
          unit="A"
        />

        <Chart
          points={points}
          field="temperature"
          label="Room temperature"
          unit="°C"
        />

        <Chart
          points={points}
          field="humidity"
          label="Humidity"
          unit="%"
        />
      </div>

      <details className="mt-5 rounded-xl border border-slate-200 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-blue-800">
          Show fictional example points
        </summary>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[500px] text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-600">
              <tr>
                <th scope="col" className="px-2 py-2">
                  Example minute
                </th>

                <th scope="col" className="px-2 py-2">
                  Example state
                </th>

                <th scope="col" className="px-2 py-2">
                  Current (A)
                </th>

                <th scope="col" className="px-2 py-2">
                  Temp (°C)
                </th>

                <th scope="col" className="px-2 py-2">
                  Humidity (%)
                </th>
              </tr>
            </thead>

            <tbody>
              {points.map((point) => (
                <tr
                  key={point.minute}
                  className="border-b border-slate-100"
                >
                  <td className="px-2 py-2">{point.minute}</td>

                  <td className="px-2 py-2">
                    {point.running
                      ? "RUN (example)"
                      : "STOP (example)"}
                  </td>

                  <td className="px-2 py-2">
                    {point.current.toFixed(1)}
                  </td>

                  <td className="px-2 py-2">
                    {point.temperature.toFixed(1)}
                  </td>

                  <td className="px-2 py-2">
                    {point.humidity.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}