import React from "react";
import Link from "next/link";
import { AHU_IDS } from "../lib/ahu";

import ProtectedUnitList from "../components/ProtectedUnitList";
import AhuUnitGrid from "../components/AhuUnitGrid";

const summary = [
  {
    label: "Planned units",
    value: String(AHU_IDS.length),
    note: "Identifiers in this preview",
  },
  {
    label: "Units running",
    value: "Unavailable",
    note: "No live dashboard feed",
  },
  {
    label: "Active alarms",
    value: "Unavailable",
    note: "No alarm feed connected",
  },
  {
    label: "Last update",
    value: "Unavailable",
    note: "No live dashboard feed",
  },
] as const;

const shortcuts = [
  {
    href: "/alarms",
    title: "Alarm center",
    description: "Explore the fictional alarm list.",
  },
  {
    href: "/reports",
    title: "Reports",
    description: "Explore fictional reports and exports.",
  },
  {
    href: "/trends",
    title: "Trend analysis",
    description: "See a fictional trend example.",
  },
  {
    href: "/config",
    title: "Configuration",
    description: "Practice an unsaved settings draft.",
  },
] as const;

export default function HomePage() {
  return (
    <main
      className="min-h-screen bg-[#eef3fa] text-slate-900"
      style={{ colorScheme: "light" }}
    >
      <div className="min-w-0 px-4 py-6 sm:px-8 lg:px-10">
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
            <strong>Not operational:</strong> Live telemetry and alarms
            are not connected to this dashboard. Status and readings
            are unavailable. This page is not protected by login. Do
            not use it to assess or control equipment.
          </section>

          <section aria-labelledby="overview-heading" className="mt-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">
                  System overview
                </p>

                <h2
                  id="overview-heading"
                  className="mt-2 text-xl font-bold text-[#12294d]"
                >
                  At a glance
                </h2>
              </div>

              <p className="text-xs text-slate-500">
                Only planned identifiers are known here.
              </p>
            </div>

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

                  <p className="mt-2 text-xs text-slate-500">
                    {item.note}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby="workspace-heading" className="mt-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">
                  Explore the interface
                </p>

                <h2
                  id="workspace-heading"
                  className="mt-2 text-xl font-bold text-[#12294d]"
                >
                  Preview workspace
                </h2>
              </div>

              <p className="text-xs text-slate-500">
                Examples are not live equipment data.
              </p>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {shortcuts.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-400 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 motion-reduce:transition-none"
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                    Preview
                  </p>

                  <h3 className="mt-2 font-bold text-[#12294d]">
                    {item.title}
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {item.description}
                  </p>

                  <p className="mt-4 text-sm font-semibold text-blue-700 group-hover:underline">
                    Open preview <span aria-hidden="true">→</span>
                  </p>
                </Link>
              ))}
            </div>
          </section>

          <AhuUnitGrid />

          <ProtectedUnitList />

          <p className="mt-8 text-xs text-slate-500">
            Preview only. Do not use this page to monitor or control
            equipment.
          </p>
        </div>
      </div>
    </main>
  );
}