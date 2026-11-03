"use client";

import React, { useEffect, useRef, useState } from "react";

import { AHU_IDS } from "../lib/ahu";
import {
  parseHistoricalObservations,
  type HistoricalObservation,
} from "../lib/historical-observations-client";

type Phase = "idle" | "loading" | "ready" | "denied" | "error";

type SourceFilter =
  | "ALL"
  | "PHYSICAL"
  | "SIMULATION"
  | "NONE";

const selectClass =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

function sensorText(
  sensor: HistoricalObservation["roomTemp"],
  unit: string,
) {
  if (!sensor.configured) {
    return "Not listed in configuration";
  }

  return sensor.value === null
    ? "Unavailable"
    : `${sensor.value} ${unit} (unit to confirm)`;
}

export default function HistoricalFleetPanel() {
  const [phase, setPhase] = useState<Phase>("idle");

  const [observations, setObservations] = useState<
    HistoricalObservation[]
  >([]);

  const [unit, setUnit] = useState("ALL");

  const [source, setSource] =
    useState<SourceFilter>("ALL");

  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    function clearForPrivacy() {
      active.current?.abort();
      active.current = null;
      setObservations([]);
      setUnit("ALL");
      setSource("ALL");
      setPhase("idle");
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        clearForPrivacy();
      }
    }

    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        clearForPrivacy();
      }
    }

    document.addEventListener(
      "visibilitychange",
      onVisibilityChange,
    );

    window.addEventListener("pagehide", clearForPrivacy);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      document.removeEventListener(
        "visibilitychange",
        onVisibilityChange,
      );

      window.removeEventListener("pagehide", clearForPrivacy);
      window.removeEventListener("pageshow", onPageShow);

      active.current?.abort();
      active.current = null;
    };
  }, []);

  function clear() {
    active.current?.abort();
    active.current = null;
    setObservations([]);
    setUnit("ALL");
    setSource("ALL");
    setPhase("idle");
  }

  async function load() {
    if (active.current || document.visibilityState === "hidden") {
      return;
    }

    const controller = new AbortController();

    active.current = controller;
    setObservations([]);
    setPhase("loading");

    try {
      const response = await fetch(
        "/api/monitoring/observations",
        {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        },
      );

      if (controller.signal.aborted) return;

      if (response.status === 401) {
        setPhase("denied");
        return;
      }

      if (!response.ok) {
        setPhase("error");
        return;
      }

      const parsed = parseHistoricalObservations(
        await response.json(),
      );

      if (controller.signal.aborted) return;

      if (parsed === null) {
        setPhase("error");
        return;
      }

      setObservations(parsed);
      setPhase("ready");
    } catch {
      if (!controller.signal.aborted) {
        setPhase("error");
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
      }
    }
  }

  const shown = observations
    .filter(
      (item) =>
        (unit === "ALL" || item.ahuId === unit) &&
        (
          source === "ALL" ||
          (
            source === "NONE"
              ? item.observedSource === null
              : item.observedSource === source
          )
        ),
    )
    .slice()
    .sort(
      (a, b) =>
        AHU_IDS.findIndex((id) => id === a.ahuId) -
        AHU_IDS.findIndex((id) => id === b.ahuId),
    );

  return (
    <section
      aria-labelledby="fleet-history-heading"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2
        id="fleet-history-heading"
        className="text-lg font-bold text-[#12294d]"
      >
        Historical fleet observations
      </h2>

      <p className="mt-2 text-sm leading-6 text-slate-600">
        Optional manual read of the latest recorded room temperature
        and humidity returned for configured units. Historical only,
        not live status. Freshness, validity and units are not
        verified. Do not use for equipment monitoring or control.
      </p>

      <p className="mt-2 text-sm leading-6 text-slate-600">
        This dashboard is not protected by login. The existing
        endpoint is designed to require a verified session and
        authorized browser; real access is not yet verified. If a
        session exists, Load may contact Supabase. An omitted unit has
        unknown status, not zero readings or an inferred configuration.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={load}
          disabled={phase === "loading"}
          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          {phase === "loading"
            ? "Loading..."
            : "Load historical fleet observations"}
        </button>

        <button
          type="button"
          onClick={clear}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          Clear fleet / cancel
        </button>
      </div>

      <div
        aria-live="polite"
        className="mt-4 text-sm text-slate-700"
      >
        {phase === "idle" && (
          <p>
            No fleet observations displayed. No request is made
            automatically.
          </p>
        )}

        {phase === "loading" && (
          <p>Loading historical fleet observations...</p>
        )}

        {phase === "denied" && (
          <p>
            Access is unavailable. A session and authorized browser
            are required; a service issue can also cause this response.
          </p>
        )}

        {phase === "error" && (
          <p>
            Historical fleet observations are unavailable. Please try
            again later.
          </p>
        )}

        {phase === "ready" && (
          <p>
            {shown.length} of {observations.length} returned units
            shown. Missing units are unknown.
          </p>
        )}
      </div>

      {phase === "ready" && (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700">
              Filter returned unit

              <select
                className={selectClass}
                value={unit}
                onChange={(event) => {
                  const value = event.target.value;

                  if (
                    value === "ALL" ||
                    AHU_IDS.some((id) => id === value)
                  ) {
                    setUnit(value);
                  }
                }}
              >
                <option value="ALL">All returned units</option>

                {AHU_IDS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-semibold text-slate-700">
              Filter reported observation source

              <select
                className={selectClass}
                value={source}
                onChange={(event) => {
                  const value = event.target.value;

                  if (
                    value === "ALL" ||
                    value === "PHYSICAL" ||
                    value === "SIMULATION" ||
                    value === "NONE"
                  ) {
                    setSource(value);
                  }
                }}
              >
                <option value="ALL">All sources</option>
                <option value="PHYSICAL">Physical</option>
                <option value="SIMULATION">Simulation</option>
                <option value="NONE">No observation</option>
              </select>
            </label>
          </div>

          {shown.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">
              No returned observations match. This does not establish
              equipment status.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[850px] text-left text-sm">
                <caption className="sr-only">
                  Historical observations returned by the server;
                  not live status.
                </caption>

                <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                  <tr>
                    <th scope="col" className="px-4 py-3">
                      Unit
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Reported configured source
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Reported observation source
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Reported time (UTC)
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Timestamp check
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Room temperature
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Humidity
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {shown.map((item) => (
                    <tr key={item.ahuId}>
                      <td className="px-4 py-3 font-semibold">
                        {item.ahuId}
                      </td>

                      <td className="px-4 py-3">
                        {item.configuredSource ?? "None configured"}
                      </td>

                      <td className="px-4 py-3">
                        {item.observedSource ?? "No observation"}
                      </td>

                      <td className="px-4 py-3">
                        {item.measuredAt ?? "Unavailable"}
                      </td>

                      <td className="px-4 py-3">
                        {item.timestampStatus === "future"
                          ? "Future timestamp; values withheld"
                          : item.timestampStatus === "unknown"
                            ? "Unknown"
                            : "Not in the future; freshness not verified"}
                      </td>

                      <td className="px-4 py-3">
                        {sensorText(item.roomTemp, "°C")}
                      </td>

                      <td className="px-4 py-3">
                        {sensorText(item.humidity, "%RH")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <p className="mt-4 text-xs leading-5 text-slate-500">
        Display clears on tab hiding or page navigation/restoration
        when browser events fire. No automatic reload. This does not
        log you out, guarantee removal from browser memory/history, or
        detect revocation while idle.
      </p>
    </section>
  );
}