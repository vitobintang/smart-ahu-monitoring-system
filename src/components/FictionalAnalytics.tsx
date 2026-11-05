"use client";

import { useState } from "react";

import { AHU_IDS } from "../lib/ahu";
import {
  EXAMPLE_METRICS,
  examplePoints,
  summarizeExample,
  type ExampleMetric,
} from "../lib/fictional-analytics";

type Section = "trends" | "energy" | "maintenance";

const sectionMetrics: Record<Section, ExampleMetric[]> = {
  trends: ["roomTemp", "humidity"],
  energy: ["current", "voltage"],
  maintenance: ["filterPressure"],
};

const card =
  "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";

const select =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

function display(value: number | null, unit: string) {
  return value === null
    ? "Unavailable"
    : `${Number(value.toFixed(2))} ${unit}`;
}

export default function FictionalAnalytics({
  section,
}: {
  section: Section;
}) {
  const [unit, setUnit] = useState<string>(AHU_IDS[0]);

  const [metric, setMetric] = useState<ExampleMetric>(
    sectionMetrics[section][0],
  );

  const [windowSize, setWindowSize] = useState<3 | 6>(6);

  const points = examplePoints(unit);
  const last = points[points.length - 1];
  const shown = points.slice(-windowSize);
  const values = shown.map((point) => point[metric]);
  const summary = summarizeExample(values);
  const meta = EXAMPLE_METRICS[metric];

  const min = summary.min ?? 0;
  const range = (summary.max ?? min) - min || 1;

  const coords = values.map((value, index) =>
    value === null
      ? null
      : {
          x:
            20 +
            index * (260 / Math.max(values.length - 1, 1)),
          y: 100 - ((value - min) / range) * 80,
        },
  );

  const cards =
    section === "trends"
      ? [
          {
            label: "Latest example point",
            value: display(last[metric], meta.unit),
          },
          {
            label: "Real trend prediction",
            value: "Unavailable",
          },
          {
            label: "Real warning acknowledgment",
            value: "Unavailable",
          },
        ]
      : section === "energy"
        ? [
            {
              label: "Example current",
              value: display(last.current, "A"),
            },
            {
              label: "Example voltage",
              value: display(last.voltage, "V"),
            },
            {
              label: "Example operating hours",
              value: display(last.runHours, "h"),
            },
          ]
        : [
            {
              label: "Example filter pressure",
              value: display(last.filterPressure, "Pa"),
            },
            {
              label: "Example operating hours",
              value: display(last.runHours, "h"),
            },
            {
              label: "Real communication",
              value: "Unknown",
            },
          ];

  return (
    <div className="mt-6 space-y-5">
      <section
        className={card}
        aria-label="Fictional analytics filters"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="text-sm font-semibold text-slate-700">
            Example unit

            <select
              className={select}
              value={unit}
              onChange={(event) => {
                if (
                  AHU_IDS.some(
                    (id) => id === event.target.value,
                  )
                ) {
                  setUnit(event.target.value);
                }
              }}
            >
              {AHU_IDS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-semibold text-slate-700">
            Example parameter

            <select
              className={select}
              value={metric}
              onChange={(event) => {
                const next = sectionMetrics[section].find(
                  (key) => key === event.target.value,
                );

                if (next) setMetric(next);
              }}
            >
              {sectionMetrics[section].map((key) => (
                <option key={key} value={key}>
                  {EXAMPLE_METRICS[key].label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-semibold text-slate-700">
            Example window

            <select
              className={select}
              value={windowSize}
              onChange={(event) => {
                if (event.target.value === "3") setWindowSize(3);
                if (event.target.value === "6") setWindowSize(6);
              }}
            >
              <option value="3">Last 3 example steps</option>
              <option value="6">All 6 example steps</option>
            </select>
          </label>
        </div>

        <p className="mt-3 text-sm leading-6 text-slate-600">
          Fixed invented values for {unit}; the selection does not
          load unit data. Steps are not timestamps. Filters are local
          to this page and reset on reload.
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((item) => (
          <article key={item.label} className={card}>
            <h2 className="text-sm font-semibold text-slate-600">
              {item.label}
            </h2>

            <p className="mt-2 text-2xl font-bold text-[#12294d]">
              {item.value}
            </p>

            <p className="mt-1 text-xs text-slate-500">
              {item.label.startsWith("Real")
                ? "Not connected"
                : "Fictional step 6 only"}
            </p>
          </article>
        ))}
      </div>

      <section
        className={card}
        aria-labelledby="fictional-chart-title"
      >
        <h2
          id="fictional-chart-title"
          className="text-lg font-bold text-[#12294d]"
        >
          Fictional {meta.label.toLowerCase()} examples
        </h2>

        <p className="mt-1 text-sm leading-6 text-slate-600">
          Invented points only, not a forecast or actual history.
          Missing points create gaps.
        </p>

        <svg
          viewBox="0 0 300 120"
          role="img"
          aria-label={`Fictional ${meta.label} chart. Exact values are in the table below.`}
          className="mt-4 h-40 w-full max-w-2xl rounded-lg bg-blue-50"
        >
          {coords.map((point, index) => {
            const previous =
              index > 0 ? coords[index - 1] : null;

            return point && previous ? (
              <line
                key={`line-${index}`}
                x1={previous.x}
                y1={previous.y}
                x2={point.x}
                y2={point.y}
                stroke="#2563eb"
                strokeWidth="2"
              />
            ) : null;
          })}

          {coords.map((point, index) =>
            point ? (
              <circle
                key={`point-${index}`}
                cx={point.x}
                cy={point.y}
                r="4"
                fill="#1d4ed8"
              />
            ) : null,
          )}
        </svg>

        <p className="mt-3 text-sm text-slate-700">
          {summary.included} included, {summary.missing} missing.
          Example minimum: {display(summary.min, meta.unit)};
          maximum: {display(summary.max, meta.unit)};
          average: {display(summary.average, meta.unit)}.
        </p>

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Fictional example points for {unit}, {meta.label}
            </caption>

            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-2">
                  Example step
                </th>
                <th scope="col" className="px-4 py-2">
                  Example value
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {shown.map((point) => (
                <tr key={point.step}>
                  <td className="px-4 py-2">{point.step}</td>
                  <td className="px-4 py-2">
                    {display(point[metric], meta.unit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={card}>
        <h2 className="text-lg font-bold text-[#12294d]">
          Real information unavailable
        </h2>

        <p className="mt-2 text-sm leading-6 text-slate-600">
          No real history, predictions, energy calculation, filter
          assessment, connectivity or alarms are available here.
          No settings, acknowledgments or equipment commands can be
          sent.
        </p>
      </section>
    </div>
  );
}