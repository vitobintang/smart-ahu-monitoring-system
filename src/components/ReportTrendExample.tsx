
import type { ReportTimelinePoint } from "../lib/report-selection";

type Props = {
  points: ReportTimelinePoint[];
  start: string;
  end: string;
};

// Fictional report example only—not operational telemetry.
export default function ReportTrendExample({
  points,
  start,
  end,
}: Props) {
  const usable = points.filter(
    (point): point is ReportTimelinePoint & { value: number } =>
      point.exclusion === null &&
      typeof point.value === "number" &&
      Number.isFinite(point.value),
  );

  const values = usable.map((point) => point.value);
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);

  const canPlot =
    min !== null &&
    max !== null &&
    Number.isFinite(startMs) &&
    Number.isFinite(endMs) &&
    endMs > startMs;

  function yPosition(value: number, low: number, high: number) {
    if (low === high) return 90;

    const difference = high - low;

    const ratio = Number.isFinite(difference)
      ? (value - low) / difference
      : (value / 2 - low / 2) / (high / 2 - low / 2);

    return 160 - ratio * 140;
  }

  return (
    <div
      aria-labelledby="report-trend-title"
      className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3
            id="report-trend-title"
            className="text-lg font-bold text-[#12294d]"
          >
            Example trend
          </h3>

          <p className="mt-1 text-sm text-slate-600">
            Fictional data only · room temperature · example units
          </p>
        </div>

        <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-800">
          SIMULATED
        </span>
      </div>

      <p className="mt-3 text-xs leading-5 text-slate-600">
        Dots show included values only. Missing and estimated values are
        omitted; dots are not connected.
      </p>

      {canPlot ? (
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white p-3">
          <svg
            viewBox="0 0 600 200"
            role="img"
            aria-label="Fictional example trend; details are in the table below"
            className="h-auto min-w-[320px] w-full"
          >
            <line
              x1="45"
              y1="20"
              x2="45"
              y2="160"
              stroke="#cbd5e1"
            />
            <line
              x1="45"
              y1="160"
              x2="580"
              y2="160"
              stroke="#cbd5e1"
            />

            <text
              x="40"
              y="24"
              textAnchor="end"
              fontSize="11"
              fill="#475569"
            >
              {max}
            </text>

            <text
              x="40"
              y="160"
              textAnchor="end"
              fontSize="11"
              fill="#475569"
            >
              {min}
            </text>

            {usable.map((point, index) => (
              <circle
                key={`${point.measuredAt}-${index}`}
                cx={
                  45 +
                  ((Date.parse(point.measuredAt) - startMs) /
                    (endMs - startMs)) *
                    535
                }
                cy={yPosition(point.value, min, max)}
                r="5"
                fill="#2563eb"
              >
                <title>
                  {`${point.measuredAt}: ${point.value} example units`}
                </title>
              </circle>
            ))}

            <text x="45" y="182" fontSize="11" fill="#475569">
              {start.slice(11, 16)} UTC
            </text>

            <text
              x="580"
              y="182"
              textAnchor="end"
              fontSize="11"
              fill="#475569"
            >
              {end.slice(11, 16)} UTC (excluded)
            </text>
          </svg>
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-600">
          No included example readings to plot.
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-sm">
          <caption className="pb-2 text-left text-xs text-slate-600">
            Fictional matched readings, ordered by reported measurement time
            (UTC).
          </caption>

          <thead>
            <tr className="border-b border-slate-200 text-slate-600">
              <th scope="col" className="py-2 pr-4">Time (UTC)</th>
              <th scope="col" className="py-2 pr-4">Example value</th>
              <th scope="col" className="py-2">Selection</th>
            </tr>
          </thead>

          <tbody>
            {points.map((point, index) => (
              <tr
                key={`${point.measuredAt}-${index}`}
                className="border-b border-slate-100"
              >
                <td className="py-2 pr-4 font-mono text-xs text-slate-700">
                  {point.measuredAt}
                </td>
                <td className="py-2 pr-4 text-slate-700">
                  {point.value ?? "Unavailable"}
                </td>
                <td className="py-2 text-slate-700">
                  {point.exclusion === null
                    ? "Included"
                    : `${point.exclusion} · excluded`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {points.length === 0 && (
          <p className="mt-2 text-sm text-slate-600">
            No fictional readings match these filters.
          </p>
        )}
      </div>
    </div>
  );
}