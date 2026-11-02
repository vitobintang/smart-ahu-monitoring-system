const components = [
  { kind: "filter", label: "Filter" },
  { kind: "coil", label: "Cooling coil" },
  { kind: "fan", label: "Fan" },
  { kind: "heater", label: "Heater (optional)" },
] as const;

export default function AhuSchematicPreview() {
  return (
    <section
      aria-labelledby="equipment-heading"
      className="mt-9 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <h2
        id="equipment-heading"
        className="text-xl font-bold text-[#12294d]"
      >
        Equipment visualization preview
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Illustration only. This is not the actual equipment layout or an
        indication of installed components. No live data or controls are
        connected.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {components.map((item) => (
          <div
            key={item.kind}
            className="rounded-xl border border-slate-200 bg-slate-50 p-4"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-blue-100 text-blue-700">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 48 48"
                  className="h-8 w-8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {item.kind === "filter" && (
                    <>
                      <rect x="9" y="9" width="30" height="30" rx="3" />
                      <path d="M15 11v26M21 11v26M27 11v26M33 11v26" />
                    </>
                  )}

                  {item.kind === "coil" && (
                    <>
                      <rect x="8" y="8" width="32" height="32" rx="3" />
                      <path d="M13 15h22v6H13v6h22v6H13" />
                    </>
                  )}

                  {item.kind === "fan" && (
                    <>
                      <circle cx="24" cy="24" r="16" />
                      <circle cx="24" cy="24" r="3" />
                      <path d="M24 21c-3-6-1-9 2-10 3-1 5 2 4 5l-3 5M27 25c6-2 9 0 9 3s-3 5-6 3l-4-4M22 27c-2 6-5 7-8 5-2-2-1-5 2-6l5-1" />
                    </>
                  )}

                  {item.kind === "heater" && (
                    <>
                      <rect x="8" y="8" width="32" height="32" rx="3" />
                      <path d="M15 32c-4-4 4-6 0-10s4-6 0-9M24 32c-4-4 4-6 0-10s4-6 0-9M33 32c-4-4 4-6 0-10s4-6 0-9" />
                    </>
                  )}
                </svg>
              </span>

              <div>
                <h3 className="text-sm font-bold text-[#12294d]">
                  {item.label}
                </h3>
                <p className="mt-1 text-xs text-slate-600">
                  Installation unknown
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}