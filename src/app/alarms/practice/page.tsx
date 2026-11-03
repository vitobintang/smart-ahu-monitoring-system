import React from "react";
import Link from "next/link";

import FictionalAlarmPractice from "../../../components/FictionalAlarmPractice";

export default function AlarmPracticePage() {
  return (
    <main
      className="min-h-screen bg-[#eef3fa] px-4 py-6 text-slate-900 sm:px-8"
      style={{ colorScheme: "light" }}
    >
      <div className="mx-auto max-w-7xl">
        <Link
          href="/alarms"
          className="inline-block rounded text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <span aria-hidden="true">&larr; </span>
          Back to alarm center
        </Link>

        <header className="mt-6 border-b border-slate-200 pb-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">
            Development preview
          </p>

          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#12294d] sm:text-4xl">
            Alarm lifecycle practice
          </h1>

          <p className="mt-2 text-sm text-slate-600">
            A fictional, in-browser learning exercise.
          </p>
        </header>

        <FictionalAlarmPractice />
      </div>
    </main>
  );
}