"use client";

import { useState } from "react";
import { classifyThreshold } from "../lib/threshold-observation";

const scenarios = [
  { id: "normal", label: "Within limits", value: 20, fresh: true },
  { id: "low", label: "Below lower limit", value: 9, fresh: true },
  { id: "high", label: "Above upper limit", value: 31, fresh: true },
  { id: "missing", label: "Unavailable reading", value: null, fresh: true },
  { id: "stale", label: "Stale reading", value: 31, fresh: false },
] as const;

export default function ThresholdScenario() {
  const [selectedId, setSelectedId] = useState<string>("normal");
  const selected = scenarios.find((item) => item.id === selectedId);

  const result = classifyThreshold({
    lower: 10,
    upper: 30,
    value: selected?.value ?? null,
    fresh: selected?.fresh === true,
  });

  return (
    <section
      aria-labelledby="threshold-heading"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <h2
        id="threshold-heading"
        className="text-xl font-bold text-[#12294d]"
      >
        Threshold example
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Compare a synthetic reading against example limits of 10 and 30.
        These are not equipment settings or real readings.
      </p>

      <div className="mt-5 max-w-sm">
        <label
          htmlFor="threshold-scenario"
          className="block text-sm font-semibold text-slate-700"
        >
          Example reading
        </label>
        <select
          id="threshold-scenario"
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          {scenarios.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      <dl
        aria-live="polite"
        className="mt-5 grid gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-2"
      >
        <div>
          <dt className="text-sm text-slate-600">Example value</dt>
          <dd className="mt-1 font-semibold text-slate-800">
            {selected?.value ?? "Unavailable"}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-slate-600">Comparison result</dt>
          <dd className="mt-1 font-bold text-[#12294d]">
            {result.ok === false ? "Invalid example" : result.observation}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-xs leading-5 text-slate-500">
        A stale or missing reading is UNKNOWN. This example does not create
        or clear alarms, save data, or control equipment.
      </p>
    </section>
  );
}