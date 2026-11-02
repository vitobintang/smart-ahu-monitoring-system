import React from "react";
import Link from "next/link";

import AlarmPreviewExample from "../../components/AlarmPreviewExample";

export default function AlarmsPage() {
  return (
    <main
      className="min-h-screen bg-[#eef3fa] px-4 py-6 text-slate-900 sm:px-8"
      style={{ colorScheme: "light" }}
    >
      <div className="mx-auto max-w-7xl">
        <Link
          href="/"
          className="inline-block rounded text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <span aria-hidden="true">&larr; </span>
          Back to dashboard
        </Link>

        <header className="mt-6 border-b border-slate-200 pb-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">
            Development preview
          </p>

          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#12294d] sm:text-4xl">
            Alarm center
          </h1>

          <p className="mt-2 text-sm text-slate-600">
            Explore a fictional alarm-list layout before backend integration.
          </p>
        </header>

        <section
          aria-label="Development notice"
          className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"
        >
          <strong>Not operational:</strong> This page is not protected by login
          and does not monitor or show real alarms. It cannot confirm equipment
          is safe. Do not use it to respond to alarms.
        </section>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-[#12294d]">
              Real alarm feed
            </h2>

            <p className="mt-2 text-lg font-bold text-slate-700">
              Unavailable
            </p>

            <p className="mt-1 text-sm leading-6 text-slate-600">
              Current alarm status is unknown; no alarm feed is connected.
            </p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-[#12294d]">
              Acknowledgment
            </h2>

            <p className="mt-2 text-lg font-bold text-slate-700">
              Unavailable
            </p>

            <p className="mt-1 text-sm leading-6 text-slate-600">
              This preview cannot acknowledge, clear or save alarms.
            </p>
          </section>
        </div>

        <AlarmPreviewExample />
      </div>
    </main>
  );
}