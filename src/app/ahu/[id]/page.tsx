import Link from "next/link";
import { notFound } from "next/navigation";

import { AHU_IDS, SENSOR_PARAMETERS } from "../../../lib/ahu";

import AhuSchematicPreview from "../../../components/AhuSchematicPreview";
import HistoricalObservationsPanel from "../../../components/HistoricalObservationsPanel";

const unitInformation = [
  { label: "Status", value: "Unavailable" },
  { label: "Location", value: "Unavailable" },
  { label: "Last update", value: "Unavailable" },
  { label: "Data source", value: "Unavailable" },
];

export default async function AhuDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!AHU_IDS.some ( (ahuId) => ahuId === id)) {
    notFound();
  }

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

        <header className="mt-6 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">
              Air-handling unit
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#12294d] sm:text-4xl">
              {id}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Unit information and sensor preview
            </p>
          </div>
          <span className="rounded-full bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700">
            Status unavailable
          </span>
        </header>

        <section
          aria-label="Development notice"
          className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"
        >
          <strong>Not operational:</strong> Live equipment data and alarms
          are not connected. This page is not protected by login yet.
          Do not use it to monitor or control equipment.
        </section>

        <section aria-labelledby="details-heading" className="mt-8">
          <h2
            id="details-heading"
            className="text-xl font-bold text-[#12294d]"
          >
            Unit information
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Details will appear when the unit is connected.
          </p>

          <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {unitInformation.map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <dt className="text-sm font-medium text-slate-600">
                  {item.label}
                </dt>
                <dd className="mt-3 text-lg font-bold text-[#12294d]">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <AhuSchematicPreview />
        <HistoricalObservationsPanel key={id} ahuId={id} />
        <section aria-labelledby="sensors-heading" className="mt-9">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2
                id="sensors-heading"
                className="text-xl font-bold text-[#12294d]"
              >
                Sensor parameters
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Sensor installation and readings are not connected. Units
                shown are preliminary and need equipment confirmation.
              </p>
            </div>
            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
              {SENSOR_PARAMETERS.length} planned types
            </span>
          </div>

          <dl className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {SENSOR_PARAMETERS.map((sensor) => (
              <div
                key={sensor.key}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <dt className="text-sm font-medium text-slate-600">
                  {sensor.label}
                  <span className="ml-1 text-xs text-slate-500">
                    ({sensor.unit})
                  </span>
                </dt>
                <dd className="mt-3 text-lg font-bold text-slate-700">
                  Unavailable
                </dd>
                <p className="mt-2 text-xs text-slate-500">
                  Installation and data unknown
                </p>
              </div>
            ))}
          </dl>
        </section>

        <section
          aria-labelledby="future-heading"
          className="mt-9 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2
            id="future-heading"
            className="text-xl font-bold text-[#12294d]"
          >
            Alarms and controls
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            The alarm feed is not connected. No controls or commands are
            available in this preview.
          </p>
        </section>

        <p className="mt-8 text-xs text-slate-500">
          This preview is not an operational monitoring or control system.
        </p>
      </div>
    </main>
  );
}