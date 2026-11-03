import React from "react";
import Link from "next/link";

import FictionalControl from "../../../components/FictionalControl";

export default function CommandPracticePage() {
  return (
    <main
      className="min-h-screen bg-[#eef3fa] px-4 py-6 text-slate-900 sm:px-8"
      style={{ colorScheme: "light" }}
    >
      <div className="mx-auto max-w-4xl">
        <Link
          href="/simulator"
          className="inline-block rounded text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <span aria-hidden="true">← </span>
          Back to simulator
        </Link>

        <header className="mt-6 border-b border-slate-200 pb-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">
            Development preview
          </p>

          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#12294d]">
            Command practice
          </h1>

          <p className="mt-2 text-sm text-slate-600">
            Explore a fictional command lifecycle in this browser.
          </p>
        </header>

        <section
          aria-label="Safety notice"
          className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"
        >
          <strong>Not operational:</strong> This page is not protected
          by login and cannot control an AHU. All roles, statuses,
          feedback and timings are fictional. STOP is not an emergency
          stop.
        </section>

        <FictionalControl />
      </div>
    </main>
  );
}