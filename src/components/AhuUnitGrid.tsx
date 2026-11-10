"use client";

import { useState } from "react";
import Link from "next/link";

import { AHU_IDS } from "../lib/ahu";

export function filterPlannedUnits(query: string): string[] {
  const needle = query.trim().toLowerCase();

  return AHU_IDS.filter((id) =>
    id.toLowerCase().includes(needle),
  );
}

export default function AhuUnitGrid() {
  const [query, setQuery] = useState("");
  const visible = filterPlannedUnits(query);

  return (
    <section aria-labelledby="units-heading" className="mt-9">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">
            Planned equipment
          </p>

          <h2
            id="units-heading"
            className="mt-2 text-xl font-bold text-[#12294d]"
          >
            Air-handling units
          </h2>

          <p className="mt-1 text-sm text-slate-600">
            Search the unit identifiers and open a unit preview.
          </p>
        </div>

        <p
          aria-live="polite"
          className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800"
        >
          {visible.length} of {AHU_IDS.length} planned units
        </p>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <label
          htmlFor="unit-search"
          className="block text-sm font-semibold text-slate-700"
        >
          Search by AHU identifier
        </label>

        <div className="mt-2 flex flex-wrap gap-2">
          <input
            id="unit-search"
            type="text"
            role="searchbox"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="For example, GTM-DAIKIN-001"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          />

          <button
            type="button"
            onClick={() => setQuery("")}
            disabled={!query}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            Clear search
          </button>
        </div>

        <p className="mt-2 text-xs leading-5 text-slate-500">
          Search uses planned IDs only. It does not check configured names,
          live data, or equipment status.
        </p>
      </div>

      {visible.length === 0 ? (
        <p
          role="status"
          className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600"
        >
          No planned identifiers match. Try a different search.
        </p>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((id) => (
            <Link
              key={id}
              href={`/devices/${id}`}
              prefetch={false}
              className="group block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-400 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 motion-reduce:transition-none"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="grid h-11 w-11 place-items-center rounded-xl bg-blue-50 text-xs font-bold tracking-wide text-blue-700"
                  >
                    AHU
                  </span>

                  <div>
                    <p className="text-xs font-medium text-slate-500">
                      Planned unit
                    </p>
                    <h3 className="mt-1 text-lg font-bold text-[#12294d]">
                      {id}
                    </h3>
                  </div>
                </div>

                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
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

              <p className="mt-5 text-sm font-semibold text-blue-700 group-hover:underline">
                View unit preview <span aria-hidden="true">&rarr;</span>
              </p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}