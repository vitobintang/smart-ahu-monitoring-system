"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  AHU_IDS,
  SENSOR_PARAMETERS,
  type SensorKey,
} from "../lib/ahu";

type Section = "config" | "trends" | "energy" | "maintenance";

const details: Record<
  Section,
  { title: string; description: string }
> = {
  config: {
    title: "Configuration",
    description:
      "Practice the unit settings layout with an unsaved fictional draft.",
  },
  trends: {
    title: "Trend analysis",
    description:
      "Explore a fictional chart and the trend-analysis layout.",
  },
  energy: {
    title: "Energy management",
    description:
      "Explore fictional electrical readings and the energy layout.",
  },
  maintenance: {
    title: "Maintenance",
    description:
      "Explore a fictional equipment-condition layout.",
  },
};

const fieldClass =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

const cardClass =
  "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";

const buttonClass =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

function Notice() {
  return (
    <section
      aria-label="Development notice"
      className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"
    >
      <strong>Not operational:</strong> This page is not protected by
      login. All examples are fictional; no real equipment data is shown.
      Do not use this page to assess equipment or respond to alarms.
    </section>
  );
}

function UnitSelector({
  unit,
  onChange,
}: {
  unit: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block max-w-xs text-sm font-semibold text-slate-700">
      Example unit

      <select
        className={fieldClass}
        value={unit}
        onChange={(event) => onChange(event.target.value)}
      >
        {AHU_IDS.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
    </label>
  );
}

function Configuration() {
  const [unit, setUnit] = useState<string>(AHU_IDS[0]);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [timeout, setTimeout] = useState("");
  const [heater, setHeater] = useState(false);
  const [sensors, setSensors] = useState<SensorKey[]>([]);

  const timeoutValid =
    /^\d{1,4}$/.test(timeout) &&
    Number(timeout) >= 1 &&
    Number(timeout) <= 9999;

  function clearDraft() {
    setName("");
    setLocation("");
    setTimeout("");
    setHeater(false);
    setSensors([]);
  }

  function changeUnit(value: string) {
    setUnit(value);
    clearDraft();
  }

  function toggleSensor(key: SensorKey) {
    setSensors((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  }

  return (
    <div className="mt-6 grid gap-5 xl:grid-cols-3">
      <section className={`${cardClass} xl:col-span-2`}>
        <h2 className="text-lg font-bold text-[#12294d]">
          Fictional settings draft
        </h2>

        <p className="mt-1 text-sm leading-6 text-slate-600">
          The draft exists only on this page. Changing the example unit
          or resetting clears it. Nothing is saved.
        </p>

        <div className="mt-5">
          <UnitSelector unit={unit} onChange={changeUnit} />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">
            Example name

            <input
              className={fieldClass}
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label className="text-sm font-semibold text-slate-700">
            Example location

            <input
              className={fieldClass}
              value={location}
              maxLength={80}
              onChange={(event) => setLocation(event.target.value)}
            />
          </label>

          <label className="text-sm font-semibold text-slate-700">
            Example timeout in seconds

            <input
              className={fieldClass}
              type="text"
              inputMode="numeric"
              value={timeout}
              maxLength={4}
              onChange={(event) => setTimeout(event.target.value)}
              aria-describedby="timeout-help"
            />
          </label>
        </div>

        <p
          id="timeout-help"
          className="mt-2 text-xs leading-5 text-slate-600"
        >
          Practice only: enter a whole number from 1 to 9999. This is
          not an equipment limit.
        </p>

        <fieldset className="mt-5">
          <legend className="text-sm font-bold text-slate-800">
            Example installed sensors
          </legend>

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {SENSOR_PARAMETERS.map((sensor) => (
              <label
                key={sensor.key}
                className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
              >
                <input
                  type="checkbox"
                  checked={sensors.includes(sensor.key)}
                  onChange={() => toggleSensor(sensor.key)}
                />

                {sensor.label} ({sensor.unit})
              </label>
            ))}
          </div>
        </fieldset>

        <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={heater}
            onChange={(event) => setHeater(event.target.checked)}
          />

          Example heater present
        </label>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass}
            onClick={clearDraft}
          >
            Reset draft
          </button>

          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded-lg bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-500"
          >
            Save real settings unavailable
          </button>
        </div>

        <p className="mt-3 text-xs leading-5 text-slate-600">
          Real configuration, access control, alarm rules and audit
          logging are not implemented here.
        </p>
      </section>

      <section
        aria-label="Draft summary"
        className={`${cardClass} h-fit`}
      >
        <h2 className="text-lg font-bold text-[#12294d]">
          Unsaved draft
        </h2>

        <dl className="mt-4 space-y-3 text-sm text-slate-700">
          <div>
            <dt className="font-semibold">Unit</dt>
            <dd>{unit}</dd>
          </div>

          <div>
            <dt className="font-semibold">Name</dt>
            <dd className="break-words">{name.trim() || "Not entered"}</dd>
          </div>

          <div>
            <dt className="font-semibold">Location</dt>
            <dd className="break-words">
              {location.trim() || "Not entered"}
            </dd>
          </div>

          <div>
            <dt className="font-semibold">Timeout</dt>

            <dd>
              {!timeout
                ? "Not entered"
                : timeoutValid
                  ? `${Number(timeout)} seconds (example)`
                  : "Invalid practice value"}
            </dd>
          </div>

          <div>
            <dt className="font-semibold">Sensors</dt>
            <dd>{sensors.length} selected (example)</dd>
          </div>

          <div>
            <dt className="font-semibold">Heater</dt>
            <dd>
              {heater ? "Selected (example)" : "Not selected"}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

function ExampleFrame({ children }: { children: React.ReactNode }) {
  const [unit, setUnit] = useState<string>(AHU_IDS[0]);

  return (
    <div className="mt-6 space-y-5">
      <div className={cardClass}>
        <UnitSelector unit={unit} onChange={setUnit} />

        <p className="mt-3 text-sm text-slate-600">
          Showing the same invented example for <strong>{unit}</strong>.
          Selection does not load unit data.
        </p>
      </div>

      {children}
    </div>
  );
}

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className={cardClass}>
      <h3 className="text-sm font-semibold text-slate-600">
        {label}
      </h3>

      <p className="mt-2 text-2xl font-bold text-[#12294d]">
        {value}
      </p>

      <p className="mt-1 text-xs text-slate-500">
        {note}
      </p>
    </article>
  );
}

function Trends() {
  return (
    <ExampleFrame>
      <div className="grid gap-4 sm:grid-cols-3">
        <Metric
          label="Current example value"
          value="22 °C"
          note="Fictional room temperature"
        />

        <Metric
          label="Trend prediction"
          value="Unavailable"
          note="No prediction engine connected"
        />

        <Metric
          label="Acknowledgment"
          value="Unavailable"
          note="No warnings can be acknowledged"
        />
      </div>

      <section className={cardClass}>
        <h2 className="text-lg font-bold text-[#12294d]">
          Fictional room-temperature chart
        </h2>

        <p className="mt-1 text-sm text-slate-600">
          Three invented points; this is not historical telemetry or a
          forecast.
        </p>

        <svg
          viewBox="0 0 300 120"
          role="img"
          aria-label="Fictional temperature points: 20, 21 and 22 degrees Celsius"
          className="mt-4 h-40 w-full max-w-2xl rounded-lg bg-blue-50"
        >
          <path
            d="M30 90 L150 60 L270 30"
            fill="none"
            stroke="#2563eb"
            strokeWidth="3"
          />

          <circle cx="30" cy="90" r="4" fill="#1d4ed8" />
          <circle cx="150" cy="60" r="4" fill="#1d4ed8" />
          <circle cx="270" cy="30" r="4" fill="#1d4ed8" />
        </svg>

        <p className="mt-3 text-sm text-slate-700">
          Example values: 20 °C → 21 °C → 22 °C
        </p>
      </section>
    </ExampleFrame>
  );
}

function Energy() {
  return (
    <ExampleFrame>
      <div className="grid gap-4 sm:grid-cols-3">
        <Metric
          label="Current"
          value="4 A"
          note="Fictional example"
        />

        <Metric
          label="Voltage"
          value="220 V"
          note="Fictional example"
        />

        <Metric
          label="Operating hours"
          value="120 h"
          note="Fictional example"
        />
      </div>

      <section className={cardClass}>
        <h2 className="text-lg font-bold text-[#12294d]">
          Electrical history
        </h2>

        <p className="mt-2 text-sm leading-6 text-slate-600">
          Real history and energy calculations are unavailable. These
          examples do not describe the selected unit or its electrical
          installation.
        </p>
      </section>
    </ExampleFrame>
  );
}

function Maintenance() {
  return (
    <ExampleFrame>
      <div className="grid gap-4 sm:grid-cols-3">
        <Metric
          label="Filter pressure"
          value="85 Pa"
          note="Fictional example; no assessment"
        />

        <Metric
          label="Operating hours"
          value="120 h"
          note="Fictional example"
        />

        <Metric
          label="Communication"
          value="Unknown"
          note="No real connectivity check"
        />
      </div>

      <section className={cardClass}>
        <h2 className="text-lg font-bold text-[#12294d]">
          Condition overview
        </h2>

        <p className="mt-2 text-sm leading-6 text-slate-600">
          Real filter condition, maintenance status and alarms are
          unknown. No resets or equipment commands are available.
        </p>
      </section>
    </ExampleFrame>
  );
}

export default function ReferencePreview({
  section,
}: {
  section: Section;
}) {
  const detail = details[section];

  return (
    <main
      className="min-h-screen bg-[#eef3fa] px-4 py-6 text-slate-900 sm:px-8"
      style={{ colorScheme: "light" }}
    >
      <div className="mx-auto max-w-7xl">
        <Link
          href="/"
          className="inline-block rounded text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <span aria-hidden="true">← </span>
          Back to dashboard
        </Link>

        <header className="mt-6 border-b border-slate-200 pb-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">
            Development preview
          </p>

          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#12294d] sm:text-4xl">
            {detail.title}
          </h1>

          <p className="mt-2 text-sm text-slate-600">
            {detail.description}
          </p>
        </header>

        <Notice />

        {section === "config" && <Configuration />}
        {section === "trends" && <Trends />}
        {section === "energy" && <Energy />}
        {section === "maintenance" && <Maintenance />}
      </div>
    </main>
  );
}