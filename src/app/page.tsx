import Link from "next/link";
import { AHU_IDS } from "../lib/ahu";

import ProtectedUnitList from "../components/ProtectedUnitList";

const summary = [
  {
    label: "Planned units",
    value: String(AHU_IDS.length),
    note: "Identifiers in preview",
  },
  {
    label: "Units running",
    value: "Unavailable",
    note: "Waiting for live data",
  },
  {
    label: "Active alarms",
    value: "Unavailable",
    note: "Alarm feed not connected",
  },
  {
    label: "Last update",
    value: "Unavailable",
    note: "Telemetry not connected",
  },
];

export default function HomePage() {
  return (
    <main
      className="min-h-screen bg-[#eef3fa] text-slate-900"
      style={{ colorScheme: "light" }}
    >
      <div className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">
                Monitoring overview
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#12294d] sm:text-4xl">
                AHU Dashboard
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                A single view of your planned air-handling units.
              </p>
            </div>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900">
              Development preview
            </span>
          </header>

          <section
            aria-label="Development notice"
            className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"
          >
            <strong>Not operational:</strong> Live telemetry and alarms are
            not connected. Status and readings are unavailable. This page
            is not protected by login yet.
          </section>
          <ProtectedUnitList />
          <section aria-labelledby="overview-heading" className="mt-8">
            <h2
              id="overview-heading"
              className="text-lg font-bold text-[#12294d]"
            >
              Overview
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {summary.map((item) => (
                <article
                  key={item.label}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <h3 className="text-sm font-medium text-slate-600">
                    {item.label}
                  </h3>
                  <p className="mt-3 text-xl font-bold text-[#12294d]">
                    {item.value}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">{item.note}</p>
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby="units-heading" className="mt-9">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2
                  id="units-heading"
                  className="text-xl font-bold text-[#12294d]"
                >
                  Air-handling units
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Select a unit to view its preview.
                </p>
              </div>
              <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
                {AHU_IDS.length} planned units
              </span>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {AHU_IDS.map((id) => (
                <Link
                  key={id}
                  href={`/ahu/${id}`}
                  className="block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-400 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-slate-500">
                        Air-handling unit
                      </p>
                      <h3 className="mt-1 text-lg font-bold text-[#12294d]">
                        {id}
                      </h3>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                      Status unavailable
                    </span>
                  </div>

                  <dl className="mt-5 space-y-3 border-t border-slate-100 pt-4 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-600">Room temperature</dt>
                      <dd className="font-medium text-slate-600">
                        Unavailable
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-600">Humidity</dt>
                      <dd className="font-medium text-slate-600">
                        Unavailable
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-600">Data source</dt>
                      <dd className="font-medium text-slate-600">
                        Unavailable
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-5 text-sm font-semibold text-blue-700">
                    View unit <span aria-hidden="true">&rarr;</span>
                  </p>
                </Link>
              ))}
            </div>
          </section>

          <p className="mt-8 text-xs text-slate-500">
            Preview only. Do not use this page to monitor or control equipment.
          </p>
        </div>
      </div>
    </main>
  );
}