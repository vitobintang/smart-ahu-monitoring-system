import React from "react";
import Link from "next/link";

import FictionalPrintButton from "../../../components/FictionalPrintButton";
import ReportTrendExample from "../../../components/ReportTrendExample";
import ReportIntervalsExample from "../../../components/ReportIntervalsExample";

import {
  EXAMPLE_READINGS,
  WINDOWS,
  type WindowName,
} from "../../../lib/fictional-report-example";
import { selectReportTimeline } from "../../../lib/report-selection";
import { summarizeReadings } from "../../../lib/report-summary";

type Params = {
  ahu?: string | string[];
  window?: string | string[];
};

export default async function FictionalReportPrintPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const query = await searchParams;

  const ahuId =
    query.ahu === "AHU-01" || query.ahu === "AHU-02"
      ? query.ahu
      : null;

  const windowName: WindowName | null =
    query.window === "ALL" ||
    query.window === "EARLY" ||
    query.window === "LATE"
      ? query.window
      : null;

  const dates = windowName ? WINDOWS[windowName] : null;

  const selection =
    ahuId && dates
      ? selectReportTimeline(EXAMPLE_READINGS, {
          ahuId,
          source: "SIMULATION",
          parameter: "roomTemp",
          ...dates,
        })
      : null;

  const summary =
    selection && selection.ok === true
      ? summarizeReadings(selection.values)
      : null;

  return (
    <main
      className="fictional-report-print min-h-screen bg-[#eef3fa] px-4 py-6 text-slate-900 sm:px-8 print:min-h-0 print:bg-white print:p-0"
      style={{ colorScheme: "light" }}
    >
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
          <Link
            href="/reports"
            className="rounded text-sm font-semibold text-blue-700 hover:underline"
          >
            ← Back to report filters
          </Link>

          {selection?.ok === true && <FictionalPrintButton />}
        </div>

        <header className="border-b border-slate-300 pb-4">
          <p className="text-xs font-bold uppercase tracking-widest text-violet-800">
            Fictional example · not operational
          </p>

          <h1 className="mt-2 text-3xl font-bold text-[#12294d]">
            Room-temperature example report
          </h1>

          <p className="mt-2 text-sm text-slate-700">
            Invented data only; this is not stored AHU history, a real
            report or a safety assessment. This page is not protected
            by login.
          </p>
        </header>

        {selection?.ok === true && dates && ahuId ? (
          <>
            <section
              aria-label="Fictional report selection"
              className="mt-5 rounded-xl border border-slate-200 bg-white p-4"
            >
              <h2 className="text-lg font-bold text-[#12294d]">
                Selected example filters
              </h2>

              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-semibold">Fictional unit</dt>
                  <dd>{ahuId}</dd>
                </div>

                <div>
                  <dt className="font-semibold">
                    Source / parameter
                  </dt>
                  <dd>
                    SIMULATION / room temperature (example units)
                  </dd>
                </div>

                <div>
                  <dt className="font-semibold">
                    Start (included, UTC)
                  </dt>
                  <dd>{dates.start}</dd>
                </div>

                <div>
                  <dt className="font-semibold">
                    End (excluded, UTC)
                  </dt>
                  <dd>{dates.end}</dd>
                </div>
              </dl>
            </section>

            <section
              aria-label="Fictional report summary"
              className="mt-5 rounded-xl border border-slate-200 bg-white p-4"
            >
              <h2 className="text-lg font-bold text-[#12294d]">
                Example summary
              </h2>

              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-semibold">Included</dt>
                  <dd>{summary?.count ?? 0}</dd>
                </div>

                <div>
                  <dt className="font-semibold">Excluded</dt>
                  <dd>{selection.excluded}</dd>
                </div>

                <div>
                  <dt className="font-semibold">
                    Minimum / maximum
                  </dt>

                  <dd>
                    {summary
                      ? `${summary.min} / ${summary.max}`
                      : "Unavailable"}
                  </dd>
                </div>

                <div>
                  <dt className="font-semibold">Average</dt>
                  <dd>
                    {summary
                      ? summary.average.toFixed(1)
                      : "Unavailable"}
                  </dd>
                </div>
              </dl>
            </section>

            <ReportTrendExample
              points={selection.points}
              start={dates.start}
              end={dates.end}
            />

            <ReportIntervalsExample
              points={selection.points}
              start={dates.start}
              end={dates.end}
            />

            <p className="mt-5 text-xs text-slate-600">
              Fictional data only. Missing, estimated and non-finite
              examples are excluded; their values are not shown. No
              claim of real data completeness is made.
            </p>
          </>
        ) : (
          <section
            role="alert"
            className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
          >
            Fictional report unavailable. Return to the report filters
            and select an example.
          </section>
        )}
      </div>
    </main>
  );
}