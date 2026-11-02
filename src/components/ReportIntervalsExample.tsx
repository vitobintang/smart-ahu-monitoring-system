import React from "react";

import type { ReportTimelinePoint } from "../lib/report-selection";
import { summarizeFictionalIntervals } from "../lib/fictional-intervals";

type Props = {
  points: readonly ReportTimelinePoint[];
  start: string;
  end: string;
};

export default function ReportIntervalsExample({
  points,
  start,
  end,
}: Props) {
  const intervals = summarizeFictionalIntervals(points, start, end);

  return (
    <section
      aria-labelledby="example-intervals-heading"
      className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3
            id="example-intervals-heading"
            className="text-lg font-bold text-[#12294d]"
          >
            Example hourly intervals
          </h3>

          <p className="mt-1 text-sm leading-6 text-slate-600">
            Fictional room-temperature records and example units only. Counts
            describe this sample, not real AHU history.
          </p>
        </div>

        <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-800">
          SIMULATED
        </span>
      </div>

      {intervals === null ? (
        <p className="mt-4 text-sm text-slate-700">
          Example intervals unavailable.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[760px] text-left text-sm">
            <caption className="px-4 py-3 text-left text-xs leading-5 text-slate-600">
              Fictional hourly intervals in UTC. Start is included and end is
              excluded; the final interval may be shorter. Empty intervals are
              not zero readings.
            </caption>

            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th scope="col" className="px-4 py-3">Start (UTC)</th>
                <th scope="col" className="px-4 py-3">End (UTC)</th>
                <th scope="col" className="px-4 py-3">Included</th>
                <th scope="col" className="px-4 py-3">Excluded</th>
                <th scope="col" className="px-4 py-3">Minimum / maximum</th>
                <th scope="col" className="px-4 py-3">Average</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {intervals.map((interval) => (
                <tr key={interval.start}>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    {interval.start}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    {interval.end}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {interval.summary?.count ?? 0}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {interval.excluded}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {interval.summary
                      ? `${interval.summary.min} / ${interval.summary.max}`
                      : "Unavailable"}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {interval.summary
                      ? interval.summary.average.toFixed(1)
                      : "Unavailable"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs leading-5 text-slate-500">
        No fictional records in an interval does not establish anything about
        real equipment or data completeness.
      </p>
    </section>
  );
}