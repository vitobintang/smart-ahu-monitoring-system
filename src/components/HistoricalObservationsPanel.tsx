"use client";

import { useEffect, useRef, useState } from "react";

import {
  parseHistoricalObservations,
  type HistoricalObservation,
} from "../lib/historical-observations-client";

type Phase = "idle" | "loading" | "ready" | "denied" | "error";

export default function HistoricalObservationsPanel({
  ahuId,
}: {
  ahuId: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [observation, setObservation] =
    useState<HistoricalObservation | null>(null);
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    function clearForPrivacy() {
      active.current?.abort();
      active.current = null;
      setObservation(null);
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
    setObservation(null);
    setPhase("idle");
  }

  async function load() {
    if (active.current || document.visibilityState === "hidden") {
      return;
    }

    const controller = new AbortController();
    active.current = controller;
    setObservation(null);
    setPhase("loading");

    try {
      const response = await fetch("/api/monitoring/observations", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      if (response.status === 401) {
        setPhase("denied");
        return;
      }

      if (!response.ok) {
        setPhase("error");
        return;
      }

      const parsed = parseHistoricalObservations(await response.json());

      if (controller.signal.aborted) return;

      if (parsed === null) {
        setPhase("error");
        return;
      }

      setObservation(
        parsed.find((item) => item.ahuId === ahuId) ?? null,
      );
      setPhase("ready");
    } catch {
      if (!controller.signal.aborted) setPhase("error");
    } finally {
      if (active.current === controller) {
        active.current = null;
      }
    }
  }

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

  return (
    <section
      aria-labelledby="history-heading"
      className="mt-9 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2
        id="history-heading"
        className="text-xl font-bold text-[#12294d]"
      >
        Historical sensor observations
      </h2>

      <p className="mt-2 text-sm leading-6 text-slate-600">
        Optional read of the latest recorded room temperature and humidity
        for {ahuId}. These are historical, not live status. Freshness and
        validity are not verified. Do not use them to monitor or control
        equipment.
      </p>

      <p className="mt-2 text-sm leading-6 text-slate-600">
        This page is not protected by login. Loading requires a verified
        session and authorized browser; an existing session may contact
        Supabase. Clear removes displayed values from this panel, but does
        not log you out or verify revocation.
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
            : "Load historical observations"}
        </button>

        <button
          type="button"
          onClick={clear}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          Clear / cancel
        </button>
      </div>

      <div aria-live="polite" className="mt-4 text-sm text-slate-700">
        {phase === "idle" && (
          <p>No observations displayed. No request is made automatically.</p>
        )}

        {phase === "loading" && (
          <p>Loading historical observations...</p>
        )}

        {phase === "denied" && (
          <p>
            Access is unavailable. A session and authorized browser are
            required; a service issue can also cause this response.
          </p>
        )}

        {phase === "error" && (
          <p>Historical observations are unavailable. Please try again later.</p>
        )}

        {phase === "ready" && observation === null && (
          <p>No configured unit was returned for {ahuId}.</p>
        )}

        {phase === "ready" && observation !== null && (
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="font-semibold">Configured source</dt>
              <dd>{observation.configuredSource ?? "None configured"}</dd>
            </div>

            <div>
              <dt className="font-semibold">Observation source</dt>
              <dd>{observation.observedSource ?? "No observation"}</dd>
            </div>

            <div>
              <dt className="font-semibold">
                Reported measurement time (UTC)
              </dt>
              <dd>{observation.measuredAt ?? "Unavailable"}</dd>
            </div>

            <div>
              <dt className="font-semibold">Timestamp check</dt>
              <dd>
                {observation.timestampStatus === "future"
                  ? "Future timestamp; values withheld"
                  : observation.timestampStatus === "unknown"
                    ? "Unknown"
                    : "Not in the future; freshness not verified"}
              </dd>
            </div>

            <div>
              <dt className="font-semibold">Room temperature</dt>
              <dd>{sensorText(observation.roomTemp, "°C")}</dd>
            </div>

            <div>
              <dt className="font-semibold">Humidity</dt>
              <dd>{sensorText(observation.humidity, "%RH")}</dd>
            </div>
          </dl>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-500">
        This panel clears its display when the tab is hidden or the page
        is left or restored from the back/forward cache. It does not
        automatically reload. Browser behavior can vary; clearing does not
        log you out or guarantee removal from browser memory or history.
        Revocation is not detected while the panel stays idle.
      </p>
    </section>
  );
}