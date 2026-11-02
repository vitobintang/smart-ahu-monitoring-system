import { summarizeReadings } from "../lib/report-summary";

const exampleReadings = [20, 22, null, 24];

export default function ReportExample() {
  const summary = summarizeReadings(exampleReadings);

  return (
    <section
      aria-labelledby="example-heading"
      className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="example-heading"
            className="text-xl font-bold text-[#12294d]"
          >
            Example summary
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Fictional values in example units; no AHU is assigned.
          </p>
        </div>
        <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-800">
          SIMULATED
        </span>
      </div>

      <p className="mt-5 text-sm text-slate-600">
        Example values: 20, 22, unavailable, 24
      </p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-4">
          <dt className="text-sm text-slate-600">Valid samples</dt>
          <dd className="mt-2 text-xl font-bold text-[#12294d]">
            {summary?.count ?? "Unavailable"}
          </dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <dt className="text-sm text-slate-600">Minimum</dt>
          <dd className="mt-2 text-xl font-bold text-[#12294d]">
            {summary?.min ?? "Unavailable"}
          </dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <dt className="text-sm text-slate-600">Maximum</dt>
          <dd className="mt-2 text-xl font-bold text-[#12294d]">
            {summary?.max ?? "Unavailable"}
          </dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <dt className="text-sm text-slate-600">Average</dt>
          <dd className="mt-2 text-xl font-bold text-[#12294d]">
            {summary ? summary.average.toFixed(1) : "Unavailable"}
          </dd>
        </div>
      </dl>

      <p className="mt-5 text-xs leading-5 text-slate-500">
        This is not real history. Missing values are excluded; actual reports
        will require data-quality and source filtering.
      </p>
    </section>
  );
}