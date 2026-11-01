import Link from "next/link";
import { notFound } from "next/navigation";

import { AHU_IDS, SENSOR_PARAMETERS } from "../../../lib/ahu";

export default async function AhuDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!AHU_IDS.some((ahuId) => ahuId === id)) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[#f2f6fc] px-5 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <Link href="/" className="text-sm font-semibold text-blue-700 hover:underline">
          ← Back to dashboard
        </Link>

        <header className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">
            AHU details
          </p>
          <h1 className="mt-2 text-3xl font-bold">{id}</h1>
          <p className="mt-2 text-sm text-slate-600">
            Status, location, and telemetry are not connected yet.
          </p>
        </header>

        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950">
          <strong>Development preview:</strong> This page does not show real
          equipment data.
        </div>

        <section
          className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          aria-labelledby="details-heading"
        >
          <h2 id="details-heading" className="text-xl font-bold">
            Unit information
          </h2>

          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-slate-600">Status</dt>
              <dd className="mt-1 font-semibold">Unavailable</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-600">Location</dt>
              <dd className="mt-1 font-semibold">Unavailable</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-600">Last update</dt>
              <dd className="mt-1 font-semibold">Unavailable</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-600">Data source</dt>
              <dd className="mt-1 font-semibold">Unavailable</dd>
            </div>
          </dl>
        </section>

        <section
          className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          aria-labelledby="sensors-heading"
        >
          <h2 id="sensors-heading" className="text-xl font-bold">
            Sensor parameters
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Supported sensor types are listed below. Installed sensor
            configuration is not connected.
          </p>

          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {SENSOR_PARAMETERS.map((sensor) => (
              <div
                key={sensor.key}
                className="flex items-center justify-between gap-4 rounded-lg bg-slate-50 px-4 py-3"
              >
                <dt className="text-sm text-slate-700">{sensor.label}</dt>
                <dd className="shrink-0 text-sm font-semibold text-slate-500">
                  — {sensor.unit}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <p className="mt-8 text-xs text-slate-500">
          This preview is not an operational monitoring or control system.
        </p>
      </div>
    </main>
  );
}