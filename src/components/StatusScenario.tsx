"use client";

import { useState } from "react";
import { getStatusDetails } from "../lib/status";

export default function StatusScenario() {
  const [communication, setCommunication] = useState("fresh");
  const [fault, setFault] = useState("reported");

  const details = getStatusDetails({
    nowMs: 60000,
    timeoutMs: 10000,
    lastReceivedAtMs: communication === "fresh" ? 59000 : 50000,
    fault:
      fault === "reported" ? true :
      fault === "not-reported" ? false :
      null,
    running: true,
  });

  const communicationLabel = {
    FRESH: "Fresh",
    STALE: "Timed out",
    NO_TELEMETRY: "No telemetry",
    UNKNOWN: "Unknown",
  }[details.communication];

  const faultLabel = {
    FAULT_REPORTED: "Last example reported a fault",
    NO_FAULT_REPORTED: "Last example reported no fault",
    UNKNOWN: "Fault flag unavailable",
  }[details.lastFaultFlag];

  return (
    <section
      aria-labelledby="scenario-heading"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <h2
        id="scenario-heading"
        className="text-xl font-bold text-[#12294d]"
      >
        Status example
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        A separate, fixed simulation of running feedback and a fault flag.
        It is not linked to the sample above or to equipment.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="scenario-communication"
            className="block text-sm font-semibold text-slate-700"
          >
            Example communication
          </label>
          <select
            id="scenario-communication"
            value={communication}
            onChange={(event) => setCommunication(event.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <option value="fresh">Fresh</option>
            <option value="stale">Timed out</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="scenario-fault"
            className="block text-sm font-semibold text-slate-700"
          >
            Last example fault flag
          </label>
          <select
            id="scenario-fault"
            value={fault}
            onChange={(event) => setFault(event.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <option value="reported">Fault reported</option>
            <option value="not-reported">No fault reported</option>
            <option value="unknown">Unavailable</option>
          </select>
        </div>
      </div>

      <dl
        aria-live="polite"
        className="mt-5 grid gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-2"
      >
        <div>
          <dt className="text-sm text-slate-600">Simulated status</dt>
          <dd className="mt-1 font-bold text-[#12294d]">
            {details.status ?? "Unavailable"}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-slate-600">Communication</dt>
          <dd className="mt-1 font-bold text-[#12294d]">
            {communicationLabel}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-sm text-slate-600">
            Last simulated fault flag
          </dt>
          <dd className="mt-1 font-semibold text-slate-800">{faultLabel}</dd>
        </div>
      </dl>

      <p className="mt-4 text-xs leading-5 text-slate-500">
        A past no-fault report does not establish present safety. This example
        cannot control equipment or clear alarms.
      </p>
    </section>
  );
}