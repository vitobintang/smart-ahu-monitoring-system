"use client";

import Link from "next/link";
import React, { useState } from "react";

import { AHU_IDS } from "../../lib/ahu";
import { createSimulationSample } from "../../lib/simulation";
import { parseSimulatedValue } from "../../lib/simulated-input";

import StatusScenario from "../../components/StatusScenario";
import ThresholdScenario from "../../components/ThresholdScenario";
import SimulatedSampleThresholds from "../../components/SimulatedSampleThresholds";

type SimulatedSample = Extract<
  ReturnType<typeof createSimulationSample>,
  { ok: true }
>["sample"];

export default function SimulatorPage() {
  const [ahuId, setAhuId] = useState<string>(AHU_IDS[0]);
  const [sample, setSample] = useState<SimulatedSample | null>(null);
  const [error, setError] = useState("");
  const [temperatureInput, setTemperatureInput] = useState("22");
  const [humidityInput, setHumidityInput] = useState("50");

  function generateSample() {
    setSample(null);
    setError("");

    const temperature = parseSimulatedValue(temperatureInput);
    const humidity = parseSimulatedValue(humidityInput);

    if (temperature.ok === false || humidity.ok === false) {
      setError(
        "Enter decimal example values using a dot, or leave a field blank.",
      );
      return;
    }

    if (typeof globalThis.crypto?.randomUUID !== "function") {
      setError("This browser cannot generate a sample ID in this context.");
      return;
    }

    const result = createSimulationSample({
      ahuId,
      messageId: `simulation-${globalThis.crypto.randomUUID()}`,
      measuredAt: new Date().toISOString(),
      readings: {
        roomTemp: temperature.value,
        humidity: humidity.value,
      },
    });

    if (result.ok === false) {
      setError(result.error);
      return;
    }

    setSample(result.sample);
  }

  return (
    <main
      className="min-h-screen bg-[#eef3fa] px-4 py-6 text-slate-900 sm:px-8"
      style={{ colorScheme: "light" }}
    >
      <div className="mx-auto max-w-4xl">
        <Link
          href="/"
          className="inline-block rounded text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <span aria-hidden="true">&larr; </span>
          Back to dashboard
        </Link>

        <header className="mt-6 border-b border-slate-200 pb-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">
            Development preview
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#12294d]">
            Local simulator
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Generate one example sample in this browser.
          </p>
        </header>

        <section
          aria-label="Safety notice"
          className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"
        >
          <strong>Simulated data only.</strong> This page is not protected by
          login. Samples are not sent or saved, and no equipment controls are
          available. Do not use this preview to monitor real equipment.
        </section>

        <section
          aria-labelledby="generate-heading"
          className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
        >
          <h2
            id="generate-heading"
            className="text-xl font-bold text-[#12294d]"
          >
            Generate a sample
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Choose a planned unit and enter fictional values. Leave a field
            blank for a missing value. These are not measurements or
            equipment settings.
          </p>

          <p className="mt-2 text-xs leading-5 text-slate-500">
            Use decimal numbers with a dot, or leave a field blank. Inputs
            are not checked against real equipment limits.
          </p>

          <div className="mt-5 flex flex-wrap items-end gap-4">
            <div className="w-full sm:w-56">
              <label
                htmlFor="ahu-id"
                className="block text-sm font-semibold text-slate-700"
              >
                AHU identifier
              </label>
              <select
                id="ahu-id"
                value={ahuId}
                onChange={(event) => {
                  setAhuId(event.target.value);
                  setSample(null);
                  setError("");
                }}
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                {AHU_IDS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-full sm:w-56">
              <label
                htmlFor="simulation-temperature"
                className="block text-sm font-semibold text-slate-700"
              >
                Fictional room temperature (°C)
              </label>
              <input
                id="simulation-temperature"
                type="text"
                inputMode="decimal"
                value={temperatureInput}
                onChange={(event) => {
                  setTemperatureInput(event.target.value);
                  setSample(null);
                  setError("");
                }}
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              />
            </div>

            <div className="w-full sm:w-56">
              <label
                htmlFor="simulation-humidity"
                className="block text-sm font-semibold text-slate-700"
              >
                Fictional humidity (%)
              </label>
              <input
                id="simulation-humidity"
                type="text"
                inputMode="decimal"
                value={humidityInput}
                onChange={(event) => {
                  setHumidityInput(event.target.value);
                  setSample(null);
                  setError("");
                }}
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              />
            </div>            

            <button
              type="button"
              onClick={generateSample}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              Generate sample
            </button>
          </div>
        </section>

        <section
          aria-labelledby="sample-heading"
          className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2
              id="sample-heading"
              className="text-xl font-bold text-[#12294d]"
            >
              Example sample
            </h2>
            <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-800">
              SIMULATED
            </span>
          </div>

          <div aria-live="polite">
            {error ? (
              <p className="mt-4 text-sm text-red-700">{error}</p>
            ) : null}

            {!sample && !error ? (
              <p className="mt-4 text-sm text-slate-600">
                No sample generated yet.
              </p>
            ) : null}

            {sample ? (
              <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-slate-600">AHU</dt>
                  <dd className="mt-1 font-semibold">
                    {sample.message.ahuId}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-slate-600">Sample time (UTC)</dt>
                  <dd className="mt-1 break-all font-semibold">
                    {sample.message.measuredAt}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-slate-600">
                    Example room temperature
                  </dt>
                  <dd className="mt-1 font-semibold">
                    {sample.message.readings.roomTemp == null
                      ? "Unavailable"
                      : `${sample.message.readings.roomTemp} °C`}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-slate-600">Example humidity</dt>
                  <dd className="mt-1 font-semibold">
                    {sample.message.readings.humidity == null
                      ? "Unavailable"
                      : `${sample.message.readings.humidity} %`}
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>

          <p className="mt-5 text-xs leading-5 text-slate-500">
            The sample exists only in memory and disappears when you leave
            or refresh. The dashboard is not connected to it.
          </p>
        </section>
        <SimulatedSampleThresholds
          hasSample={sample !== null}
          roomTemp={sample?.message.readings.roomTemp ?? null}
          humidity={sample?.message.readings.humidity ?? null}
        />
        <StatusScenario />
        <ThresholdScenario />
      </div>
    </main>
  );
}