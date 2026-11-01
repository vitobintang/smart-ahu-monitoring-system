import { AHU_IDS } from "../lib/ahu";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#f2f6fc] text-slate-900 lg:flex">
      <aside className="bg-[#0b1f3f] px-6 py-6 text-white lg:min-h-screen lg:w-64 lg:shrink-0">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-200">
          Smart facilities
        </p>
        <p className="mt-2 text-xl font-bold">Smart AHU</p>
        <p className="mt-1 text-sm text-blue-200">Monitoring system</p>

        <div className="mt-8 rounded-lg bg-blue-500/20 px-4 py-3 text-sm font-semibold text-white">
          Dashboard
        </div>

        <p className="mt-6 text-xs leading-5 text-blue-200">
          More pages will be added as the application is built.
        </p>
      </aside>

      <div className="min-w-0 flex-1 px-5 py-8 sm:px-8 lg:px-10">
        <header className="mx-auto max-w-7xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">
            Monitoring overview
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            AHU Dashboard
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            A starting point for monitoring seven air-handling units.
          </p>
        </header>

        <section
          className="mx-auto mt-6 max-w-7xl rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950"
          aria-label="Development notice"
        >
          <strong>Development preview:</strong> No backend or real AHU data is
          connected. Values and status are unavailable.
        </section>

        <section
          className="mx-auto mt-8 max-w-7xl"
          aria-labelledby="units-heading"
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="units-heading" className="text-xl font-bold">
                Air-handling units
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Seven planned identifiers; device configuration is not connected yet.
              </p>
            </div>

            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
              {AHU_IDS.length} planned units
            </span>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {AHU_IDS.map((id) => (
              <article
                key={id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-bold">{id}</h3>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                    Status unavailable
                  </span>
                </div>

                <dl className="mt-5 space-y-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-600">Room temperature</dt>
                    <dd className="font-semibold text-slate-500">—</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-600">Humidity</dt>
                    <dd className="font-semibold text-slate-500">—</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-600">Data source</dt>
                    <dd className="font-semibold text-slate-500">Unavailable</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>

        <p className="mx-auto mt-8 max-w-7xl text-xs text-slate-500">
          This preview is not an operational monitoring or control system.
        </p>
      </div>
    </main>
  );
}