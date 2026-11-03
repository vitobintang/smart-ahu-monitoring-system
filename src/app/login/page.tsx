import Link from "next/link";

import SessionStatusPanel from "../../components/SessionStatusPanel";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f2f6fc] px-5 py-10 text-slate-900">
      <section
        className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg lg:grid-cols-2"
        aria-labelledby="login-heading"
      >
        <div className="bg-[#0b1f3f] p-7 text-white sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-200">
            Smart facilities
          </p>

          <h1 className="mt-3 text-2xl font-bold">
            Smart AHU Monitoring
          </h1>

          <p className="mt-4 text-sm leading-6 text-blue-100">
            Monitoring and control for seven air-handling units.
          </p>

          <div className="mt-8 rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">
            This application is under development. Physical control is
            not available. A web STOP button is not an emergency stop.
          </div>
        </div>

        <div className="p-7 sm:p-10">
          <h2 id="login-heading" className="text-2xl font-bold">
            Sign in
          </h2>

          <p className="mt-2 text-sm leading-6 text-slate-600">
            Login is not connected yet. Please do not enter real
            credentials.
          </p>

          <div className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-semibold"
              >
                Email address
              </label>

              <input
                id="email"
                type="email"
                disabled
                placeholder="Not available yet"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-semibold"
              >
                Password
              </label>

              <input
                id="password"
                type="password"
                disabled
                placeholder="Not available yet"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500"
              />
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
              <strong>Separate browser authorization:</strong> An
              Admin-issued token is intended to authorize each user’s
              browser. Browser authorization is not connected yet. The
              first Admin’s bootstrap is also unfinished. Telemetry
              device credentials are separate.
            </div>

            <button
              type="button"
              disabled
              className="w-full cursor-not-allowed rounded-lg bg-slate-300 px-4 py-3 text-sm font-semibold text-slate-600"
            >
              Sign in unavailable
            </button>
          </div>

          <SessionStatusPanel />

          <Link
            href="/"
            className="mt-6 inline-block text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            Back to dashboard preview
          </Link>
        </div>
      </section>
    </main>
  );
}