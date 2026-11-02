import Link from "next/link";
import ReportExample from "../../components/ReportExample";

export default function ReportsPage() {
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
            Reports and data logger
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            A preview of report summary calculations.
          </p>
        </header>

        <section
          aria-label="Development notice"
          className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"
        >
          <strong>Not operational:</strong> This page is not protected by
          login and is not connected to stored history. AHU, time and source
          filters, charts and exports are not available yet. The example is
          simulated.
        </section>

        <ReportExample />

        <p className="mt-8 text-xs text-slate-500">
          Preview only. Do not use these values for equipment decisions.
        </p>
      </div>
    </main>
  );
}