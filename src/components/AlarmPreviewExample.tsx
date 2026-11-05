"use client";

import { useState } from "react";

type ExampleState = "ACTIVE" | "RESOLVED";
type ExampleUnit = "AHU-01" | "AHU-02";
type ExamplePriority = "CRITICAL" | "HIGH" | "MEDIUM";

// Invented scenarios for layout only. These are not alerts or equipment data.
const EXAMPLES: {
  id: string;
  unit: ExampleUnit;
  priority: ExamplePriority;
  condition: string;
  state: ExampleState;
}[] = [
  {
    id: "example-a",
    unit: "AHU-01",
    priority: "HIGH",
    condition: "Temperature outside an example range",
    state: "ACTIVE",
  },
  {
    id: "example-b",
    unit: "AHU-02",
    priority: "CRITICAL",
    condition: "Controller fault scenario",
    state: "ACTIVE",
  },
  {
    id: "example-c",
    unit: "AHU-01",
    priority: "MEDIUM",
    condition: "Example condition returned to range",
    state: "RESOLVED",
  },
];

export default function AlarmPreviewExample() {
  const [state, setState] = useState<"ALL" | ExampleState>("ALL");
  const [unit, setUnit] = useState<"ALL" | ExampleUnit>("ALL");
  const [priority, setPriority] =
    useState<"ALL" | ExamplePriority>("ALL");

  const shown = EXAMPLES.filter(
    (example) =>
      (state === "ALL" || example.state === state) &&
      (unit === "ALL" || example.unit === unit) &&
      (priority === "ALL" || example.priority === priority),
  );

  return (
    <section
      aria-labelledby="alarm-examples-title"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="alarm-examples-title"
            className="text-xl font-bold text-[#12294d]"
          >
            Fictional alarm scenarios
          </h2>

          <p className="mt-1 text-sm leading-6 text-slate-600">
            These invented rows are only for trying the layout and filters.
            Their conditions, states and priorities are not real or configured
            alarms.
          </p>
        </div>

        <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-800">
          FICTIONAL EXAMPLES
        </span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div>
          <label
            htmlFor="example-alarm-state"
            className="block text-sm font-semibold text-slate-700"
          >
            Example state
          </label>

          <select
            id="example-alarm-state"
            value={state}
            onChange={(event) => {
              const value = event.target.value;

              if (
                value === "ALL" ||
                value === "ACTIVE" ||
                value === "RESOLVED"
              ) {
                setState(value);
              }
            }}
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="ALL">All example states</option>
            <option value="ACTIVE">Example active</option>
            <option value="RESOLVED">Example resolved</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="example-alarm-unit"
            className="block text-sm font-semibold text-slate-700"
          >
            Example unit
          </label>

          <select
            id="example-alarm-unit"
            value={unit}
            onChange={(event) => {
              const value = event.target.value;

              if (
                value === "ALL" ||
                value === "AHU-01" ||
                value === "AHU-02"
              ) {
                setUnit(value);
              }
            }}
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="ALL">All example units</option>
            <option value="AHU-01">AHU-01 example</option>
            <option value="AHU-02">AHU-02 example</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="example-alarm-priority"
            className="block text-sm font-semibold text-slate-700"
          >
            Example priority
          </label>

          <select
            id="example-alarm-priority"
            value={priority}
            onChange={(event) => {
              const value = event.target.value;

              if (
                value === "ALL" ||
                value === "CRITICAL" ||
                value === "HIGH" ||
                value === "MEDIUM"
              ) {
                setPriority(value);
              }
            }}
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="ALL">All example priorities</option>
            <option value="CRITICAL">Example critical</option>
            <option value="HIGH">Example high</option>
            <option value="MEDIUM">Example medium</option>
          </select>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="text-sm text-slate-600">
          {shown.length} fictional{" "}
          {shown.length === 1 ? "scenario" : "scenarios"} shown.
        </p>

        <button
          type="button"
          onClick={() => {
            setState("ALL");
            setUnit("ALL");
            setPriority("ALL");
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          Reset example filters
        </button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[650px] text-left text-sm">
          <caption className="sr-only">
            Fictional scenarios only; this table does not show real alarm
            status.
          </caption>

          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-3">Example</th>
              <th scope="col" className="px-4 py-3">Unit</th>
              <th scope="col" className="px-4 py-3">Priority</th>
              <th scope="col" className="px-4 py-3">Scenario</th>
              <th scope="col" className="px-4 py-3">State</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {shown.map((example) => (
              <tr key={example.id}>
                <td className="px-4 py-3 font-semibold text-violet-800">
                  Fictional
                </td>
                <td className="px-4 py-3 font-mono text-slate-700">
                  {example.unit}
                </td>
                <td className="px-4 py-3 text-slate-700">
                  Example {example.priority}
                </td>
                <td className="px-4 py-3 text-slate-700">
                  {example.condition}
                </td>
                <td className="px-4 py-3 text-slate-700">
                  Example {example.state}
                </td>
              </tr>
            ))}

            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-slate-600">
                  No fictional scenarios match these filters. Real alarm status
                  is unavailable.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}