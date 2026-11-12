export default function AppRouteLoading() {
  return (
    <div className="space-y-4 sm:space-y-6 animate-pulse" aria-busy="true" aria-label="Loading page content">
      {/* Header Skeleton */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-1">
        <div className="space-y-2">
          <div className="h-8 w-56 sm:w-72 rounded-xl bg-slate-200/80" />
          <div className="h-4 w-40 sm:w-56 rounded-lg bg-slate-200/60" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-9 w-24 rounded-xl bg-slate-200/70" />
          <div className="h-9 w-28 rounded-xl bg-slate-200/70" />
        </div>
      </div>

      {/* KPI Tiles Skeleton */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm backdrop-blur-md"
          >
            <div className="flex items-center justify-between">
              <div className="h-4 w-20 rounded-md bg-slate-200/80" />
              <div className="h-8 w-8 rounded-xl bg-slate-200/60" />
            </div>
            <div className="mt-3 h-7 w-24 rounded-lg bg-slate-200/90" />
            <div className="mt-2 h-3.5 w-32 rounded-md bg-slate-200/50" />
          </div>
        ))}
      </div>

      {/* Main Content Skeleton */}
      <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-5 shadow-sm backdrop-blur-md">
        <div className="mb-4 flex items-center justify-between">
          <div className="h-5 w-40 rounded-lg bg-slate-200/80" />
          <div className="h-8 w-32 rounded-xl bg-slate-200/60" />
        </div>
        <div className="space-y-3">
          <div className="h-10 w-full rounded-xl bg-slate-100" />
          <div className="h-16 w-full rounded-xl bg-slate-50" />
          <div className="h-16 w-full rounded-xl bg-slate-50" />
          <div className="h-16 w-full rounded-xl bg-slate-50" />
        </div>
      </div>
    </div>
  );
}
