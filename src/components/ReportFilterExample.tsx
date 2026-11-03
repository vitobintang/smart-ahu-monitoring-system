"use client";

import React, { useState } from "react";

import { selectReportTimeline } from "../lib/report-selection";
import { summarizeReadings } from "../lib/report-summary";
import { buildFictionalReportCsv } from "../lib/fictional-report-csv";
import {
  EXAMPLE_READINGS,
  WINDOWS,
  type WindowName,
} from "../lib/fictional-report-example";

import ReportTrendExample from "./ReportTrendExample";
import ReportIntervalsExample from "./ReportIntervalsExample";

export default function ReportFilterExample() {
  const [ahuId, setAhuId] =
    useState<"AHU-01" | "AHU-02">("AHU-01");

  const [windowName, setWindowName] = useState<WindowName>("ALL");

  const selection = selectReportTimeline(EXAMPLE_READINGS, {
    ahuId,
    source: "SIMULATION",
    parameter: "roomTemp",
    ...WINDOWS[windowName],
  });

  const summary =
    selection.ok === true
      ? summarizeReadings(selection.values)
      : null;

  const exampleCsv =
    selection.ok === true
      ? buildFictionalReportCsv({
          ahuId,
          ...WINDOWS[windowName],
          points: selection.points,
        })
      : null;

  const exampleCsvHref =
    exampleCsv === null
      ? null
      : `data:text/csv;charset=utf-8,${encodeURIComponent(
          "\uFEFF" + exampleCsv,
        )}`;

  const printHref =
    `/reports/print?ahu=${encodeURIComponent(ahuId)}` +
    `&window=${encodeURIComponent(windowName)}`;

  return (
    <section
      aria-labelledby="filter-example-heading"
      className="mt-6 rounded-2xl border border-violet-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="filter-example-heading"
            className="text-xl font-bold text-[#12294d]"
          >
            Example report filters
          </h2>

          <p className="mt-1 text-sm text-slate-600">
            Fictional room-temperature records and example units only.
            This is not stored AHU history.
          </p>
        </div>

        <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-800">
          SIMULATED
        </span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="report-example-ahu"
            className="block text-sm font-semibold text-slate-700"
          >
            Fictional unit
          </label>

          <select
            id="report-example-ahu"
            value={ahuId}
            onChange={(event) => {
              if (
                event.target.value === "AHU-01" ||
                event.target.value === "AHU-02"
              ) {
                setAhuId(event.target.value);
              }
            }}
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="AHU-01">AHU-01 example</option>
            <option value="AHU-02">AHU-02 example</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="report-example-window"
            className="block text-sm font-semibold text-slate-700"
          >
            Fictional time window (UTC)
          </label>

          <select
            id="report-example-window"
            value={windowName}
            onChange={(event) => {
              if (
                event.target.value === "ALL" ||
                event.target.value === "EARLY" ||
                event.target.value === "LATE"
              ) {
                setWindowName(event.target.value);
              }
            }}
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="ALL">09:00 to 15:00</option>
            <option value="EARLY">09:00 to 12:00</option>
            <option value="LATE">12:00 to 15:00</option>
          </select>
        </div>
      </div>

      <p className="mt-4 text-sm text-slate-600">
        Example date: 1 January 2026. Start is included; end is
        excluded. Source: SIMULATION.
      </p>

      <div aria-live="polite" className="mt-4">
        {selection.ok === false ? (
          <p className="text-sm text-slate-700">
            Example report unavailable.
          </p>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl bg-slate-50 p-4">
              <dt className="text-sm text-slate-600">Included</dt>
              <dd className="mt-2 text-xl font-bold text-[#12294d]">
                {summary?.count ?? 0}
              </dd>
            </div>

            <div className="rounded-xl bg-slate-50 p-4">
              <dt className="text-sm text-slate-600">Excluded</dt>
              <dd className="mt-2 text-xl font-bold text-[#12294d]">
                {selection.excluded}
              </dd>
            </div>

            <div className="rounded-xl bg-slate-50 p-4">
              <dt className="text-sm text-slate-600">
                Minimum / maximum
              </dt>
              <dd className="mt-2 text-xl font-bold text-[#12294d]">
                {summary
                  ? `${summary.min} / ${summary.max}`
                  : "Unavailable"}
              </dd>
            </div>

            <div className="rounded-xl bg-slate-50 p-4">
              <dt className="text-sm text-slate-600">Average</dt>
              <dd className="mt-2 text-xl font-bold text-[#12294d]">
                {summary
                  ? summary.average.toFixed(1)
                  : "Unavailable"}
              </dd>
            </div>
          </dl>
        )}
      </div>

      {selection.ok === true && (
        <ReportTrendExample
          points={selection.points}
          start={WINDOWS[windowName].start}
          end={WINDOWS[windowName].end}
        />
      )}

      {selection.ok === true && (
        <ReportIntervalsExample
          points={selection.points}
          start={WINDOWS[windowName].start}
          end={WINDOWS[windowName].end}
        />
      )}

      {selection.ok === true && (
        <div className="mt-5 rounded-xl border border-violet-200 bg-violet-50 p-4">
          <div className="flex flex-wrap gap-2">
            {exampleCsvHref === null ? (
              <p className="text-sm text-slate-700">
                Fictional CSV unavailable.
              </p>
            ) : (
              <a
                href={exampleCsvHref}
                download={`fictional-room-temperature-${ahuId}.csv`}
                className="inline-block rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-700"
              >
                Download fictional CSV
              </a>
            )}

            <a
              href={printHref}
              className="inline-block rounded-lg border border-violet-700 bg-white px-4 py-2 text-sm font-semibold text-violet-800 hover:bg-violet-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-700"
            >
              Open fictional print view
            </a>
          </div>

          <p className="mt-2 text-xs leading-5 text-slate-600">
            Fictional example only; the file contains no real AHU data.
            Excluded readings have blank values. The print view uses
            the current example filters.
          </p>
        </div>
      )}

      <p className="mt-4 text-xs leading-5 text-slate-500">
        Missing, estimated, and non-finite example values are excluded
        after filtering. Real reports need trusted source, sensor
        configuration, quality and authorization checks; this example
        does not provide them.
      </p>
    </section>
  );
}