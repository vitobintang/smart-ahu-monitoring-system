"use client";

import { useEffect, useRef, useState } from "react";

import type { MonitoringUnit } from "../db/monitoring";
import { parseMonitoringResponse } from "../lib/monitoring-client";

type Phase =
  | "idle"
  | "loading"
  | "ready"
  | "denied"
  | "error"
  | "cleared";

export default function ProtectedUnitList() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [units, setUnits] = useState<MonitoringUnit[]>([]);
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    function clearForPrivacy() {
      active.current?.abort();
      active.current = null;
      setUnits([]);
      setPhase("cleared");
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
    setUnits([]);
    setPhase("cleared");
  }

   async function loadUnits() {
    if (active.current || document.visibilityState === "hidden") {
      return;
    }

    const controller = new AbortController();
    active.current = controller;
    setUnits([]);
    setPhase("loading");

    try {
      const response = await fetch("/api/monitoring/units", {
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

      const parsed = parseMonitoringResponse(await response.json());

      if (controller.signal.aborted) return;

      if (parsed === null) {
        setPhase("error");
        return;
      }

      setUnits(parsed);
      setPhase("ready");
    } catch {
      if (!controller.signal.aborted) setPhase("error");
    } finally {
      if (active.current === controller) {
        active.current = null;
      }
    }
  }

  return (
    <section
      aria-labelledby="protected-units-heading"
      className="mx-auto mt-6 max-w-7xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2
        id="protected-units-heading"
        className="text-lg font-bold text-[#12294d]"
      >
        Configured unit names
      </h2>

      <p className="mt-2 text-sm leading-6 text-slate-600">
        This optional read requires a verified session and an authorized
        browser. If a session already exists, it may query the primary
        database when clicked. The dashboard itself is not protected by login yet.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={loadUnits}
          disabled={phase === "loading"}
          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          {phase === "loading" ? "Loading..." : "Load configured units"}
        </button>

        <button
          type="button"
          onClick={clear}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          Clear / cancel
        </button>
      </div>

      <div aria-live="polite" className="mt-4 text-sm">
        {phase === "idle" && (
          <p className="text-slate-600">No request has been made.</p>
        )}

        {phase === "cleared" && (
          <p className="text-slate-600">
            List cleared. No request in progress.
          </p>
        )}

        {phase === "loading" && (
          <p className="text-slate-600">Loading configured units...</p>
        )}

        {phase === "denied" && (
          <p className="text-slate-700">
            Access is unavailable. A valid session and authorized browser
            are required; a service issue can also cause this response.
          </p>
        )}

        {phase === "error" && (
          <p className="text-slate-700">
            The unit list is unavailable. Please try again later.
          </p>
        )}

        {phase === "ready" && units.length === 0 && (
          <p className="text-slate-600">No configured units were returned.</p>
        )}

        {phase === "ready" && units.length > 0 && (
          <ul className="space-y-2">
            {units.map((unit) => (
              <li
                key={unit.id}
                className="rounded-lg bg-slate-50 px-4 py-3"
              >
                <strong>{unit.id}</strong>
                <span> - {unit.name} - {unit.location}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Names and locations are configuration, not live status or equipment
        readings. This panel clears its display when the tab is hidden or
        the page is left or restored from the back/forward cache. It does
        not automatically reload. Browser behavior can vary, and clearing
        does not log you out or guarantee removal from browser memory or
        history. Revocation is not detected while the panel stays idle.
      </p>
    </section>
  );
}