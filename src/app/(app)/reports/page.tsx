"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, FileBarChart, Printer, Search } from "lucide-react";
import { api, fmtDateTime } from "@/lib/client";
import { AHU_IDS, MAX_REPORT_RANGE_DAYS, PARAMETERS, type DataQuality, type ParamKey } from "@/lib/domain";
import { Btn, Empty, ErrorNote, Field, PrintFooter, PrintHeader, QualityTag, SourceTag, Spinner, cx, inputClass } from "@/components/ui";

interface ReportStats {
  parameter: ParamKey;
  label: string;
  unit: string;
  count: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  fallbackCount: number;
  installed: boolean;
}

interface Report {
  ahuId: string;
  ahuName: string;
  from: string;
  to: string;
  source: string;
  totalRows: number;
  physicalRows: number;
  simulationRows: number;
  runSamples: number;
  runProportion: number;
  stats: ReportStats[];
  buckets: { bucket: number; count: number; runCount: number; values: Record<string, number | null> }[];
  bucketLabel: string;
  samples: Array<Record<string, unknown> & { timestamp: string }>;
  sampleLimit: number;
}

const PRINT_HIDE = new Set(["returnTemp", "coilTemp", "damperPosition", "voltage", "runHours", "heaterOutput"]);

const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function ReportsPage() {
  const [ahuId, setAhuId] = useState<string>(AHU_IDS[0]);
  const [from, setFrom] = useState(() => toLocalInput(new Date(Date.now() - 6 * 3600 * 1000)));
  const [to, setTo] = useState(() => toLocalInput(new Date()));
  const [source, setSource] = useState<"ALL" | "PHYSICAL" | "SIMULATION">("ALL");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const rangeDays = useMemo(() => {
    const f = new Date(from).getTime();
    const t = new Date(to).getTime();
    return Number.isFinite(f) && Number.isFinite(t) ? (t - f) / 86_400_000 : 0;
  }, [from, to]);
  const rangeInvalid = rangeDays <= 0 || rangeDays > MAX_REPORT_RANGE_DAYS;

  const query = `ahuId=${ahuId}&from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(
    new Date(to).toISOString(),
  )}&source=${source}`;

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<Report>(`/api/reports?${query}`);
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report generation failed");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  const chartRows = useMemo(
    () =>
      (report?.buckets ?? []).map((b) => ({
        t: b.bucket,
        supplyTemp: b.values.supplyTemp,
        roomTemp: b.values.roomTemp,
        humidity: b.values.humidity,
        current: b.values.current,
        filterDiffPressure: b.values.filterDiffPressure,
        runPct: b.count === 0 ? 0 : Number(((b.runCount / b.count) * 100).toFixed(1)),
      })),
    [report],
  );

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-50 sm:text-2xl">Data Logger Report</h1>
          <p className="text-xs text-slate-500">
            FR-10 query by AHU, time range (max {MAX_REPORT_RANGE_DAYS} days) and data source · FR-11 summary
            statistics + interval breakdown · FR-12 CSV and Print/PDF export
          </p>
        </div>
      </div>

      <div className="panel no-print rounded-2xl p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Field label="AHU unit">
            <select value={ahuId} onChange={(e) => setAhuId(e.target.value)} className={inputClass}>
              {AHU_IDS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From">
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </Field>
          <Field label="To">
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Data source" hint="FR-09 source identifier">
            <select value={source} onChange={(e) => setSource(e.target.value as typeof source)} className={inputClass}>
              <option value="ALL">ALL</option>
              <option value="PHYSICAL">PHYSICAL</option>
              <option value="SIMULATION">SIMULATION</option>
            </select>
          </Field>
          <div className="flex items-end">
            <Btn variant="primary" onClick={() => void generate()} disabled={loading || rangeInvalid} className="w-full">
              <Search size={13} /> {loading ? "Querying…" : "Generate report"}
            </Btn>
          </div>
        </div>
        <p className={cx("mt-2 text-[11px]", rangeInvalid ? "text-amber-300" : "text-slate-500")}>
          Selected range: <span className="font-mono">{rangeDays.toFixed(2)} days</span>
          {rangeDays > MAX_REPORT_RANGE_DAYS
            ? ` — exceeds the ${MAX_REPORT_RANGE_DAYS}-day maximum, reduce the range (FR-10).`
            : rangeDays <= 0
              ? " — `to` must be later than `from`.`"
              : " — within the 31-day limit."}
        </p>
        {report ? (
          <div className="no-print mt-3 flex flex-wrap gap-2 border-t border-ink-700/70 pt-3">
            <a href={`/api/reports?${query}&format=csv`} download>
              <Btn variant="success">
                <Download size={13} /> Download CSV
              </Btn>
            </a>
            <Btn variant="default" onClick={() => window.print()}>
              <Printer size={13} /> Print / Save to PDF
            </Btn>
          </div>
        ) : null}
      </div>

      <ErrorNote message={error} />
      {loading ? <Spinner label="Aggregating telemetry…" /> : null}

      {!report && !loading && !error ? (
        <Empty>Select a range and generate the data-logger report.</Empty>
      ) : null}

      {report ? (
        <>
          <PrintHeader
            title="Data Logger Report"
            subtitle="Telemetry history, summary statistics and interval analysis per FR-10 / FR-11 / FR-12"
            meta={[
              ["AHU", `${report.ahuId} — ${report.ahuName}`],
              ["Range", `${fmtDateTime(report.from)} → ${fmtDateTime(report.to)}`],
              ["Data source", report.source],
              ["Valid samples", String(report.totalRows)],
              ["Physical / Simulated", `${report.physicalRows} / ${report.simulationRows}`],
              ["RUN proportion", `${(report.runProportion * 100).toFixed(1)} %`],
              ["Interval", report.bucketLabel],
              ["Generated", fmtDateTime(new Date())],
              ["Document", "FR-10/11/12 controlled output"],
              ["Quality policy", "NFR-06 tags applied"],
            ]}
          />

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile label="Valid samples" value={String(report.totalRows)} sub={`${report.bucketLabel} breakdown`} />
            <StatTile label="Physical rows" value={String(report.physicalRows)} sub="source = PHYSICAL" tone="cyan" />
            <StatTile label="Simulated rows" value={String(report.simulationRows)} sub="source = SIMULATION" tone="violet" />
            <StatTile label="RUN proportion" value={`${(report.runProportion * 100).toFixed(1)} %`} sub={`${report.runSamples} RUN samples`} tone="emerald" />
            <StatTile
              label="Fallback flags"
              value={String(
                (report.stats.find((s) => s.parameter === "current")?.fallbackCount ?? 0) +
                  (report.stats.find((s) => s.parameter === "voltage")?.fallbackCount ?? 0),
              )}
              sub="ESTIMATED_FALLBACK (NFR-06.5)"
              tone="amber"
            />
          </div>

          <div className="panel overflow-hidden rounded-2xl">
            <header className="border-b border-ink-700/70 px-5 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-100">1 · Report summary statistics</h2>
              <p className="text-[11px] text-slate-500">Average · Minimum · Maximum · Valid sample count per parameter</p>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-xs">
                <thead className="bg-ink-900/60 text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Parameter</th>
                    <th className="px-4 py-2.5">Unit</th>
                    <th className="px-4 py-2.5 text-right">Average</th>
                    <th className="px-4 py-2.5 text-right">Minimum</th>
                    <th className="px-4 py-2.5 text-right">Maximum</th>
                    <th className="px-4 py-2.5 text-right">Valid samples</th>
                    <th className="px-4 py-2.5">Data clarity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-800/70">
                  {report.stats.map((s) => {
                    const meta = PARAMETERS.find((p) => p.key === s.parameter)!;
                    return (
                      <tr key={s.parameter} className={cx(!s.installed && "opacity-50")}>
                        <td className="px-4 py-2.5">
                          <span className="text-slate-200">{s.label}</span>
                          <span className="ml-2 font-mono text-[10px] text-slate-500">{meta.localLabel.toLowerCase()}</span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-400">{s.unit}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-cyan-300">
                          {s.avg === null ? "—" : s.avg.toFixed(meta.decimals)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-300">
                          {s.min === null ? "—" : s.min.toFixed(meta.decimals)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-300">
                          {s.max === null ? "—" : s.max.toFixed(meta.decimals)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-300">
                          {s.count}
                          {s.fallbackCount > 0 ? <span className="ml-1 text-[10px] text-fuchsia-300">({s.fallbackCount} fallback)</span> : null}
                        </td>
                        <td className="px-4 py-2.5">
                          {!s.installed ? (
                            <QualityTag quality="UNINSTALLED" />
                          ) : s.count === 0 ? (
                            <QualityTag quality="NULL_UNAVAILABLE" />
                          ) : s.fallbackCount > 0 ? (
                            <QualityTag quality="ESTIMATED_FALLBACK" />
                          ) : report.simulationRows > 0 && report.physicalRows === 0 ? (
                            <QualityTag quality="SIMULATED" />
                          ) : (
                            <QualityTag quality="OK" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel rounded-2xl p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-100">
              <FileBarChart size={14} className="text-cyan-300" /> Trend charts ({report.bucketLabel})
            </h2>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="print-chart h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartRows} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
                    <CartesianGrid stroke="rgba(30,58,85,0.45)" vertical={false} />
                    <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => new Date(t).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} stroke="#334155" fontSize={9} tickLine={false} />
                    <YAxis stroke="#334155" fontSize={9} tickLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: "rgba(5,11,20,0.96)", border: "1px solid rgba(30,58,85,0.9)", borderRadius: 8, fontSize: 11 }} labelFormatter={(v) => fmtDateTime(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line type="monotone" dataKey="supplyTemp" name="Supply temp (°C)" stroke="#22d3ee" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="roomTemp" name="Room temp (°C)" stroke="#f59e0b" strokeWidth={1.6} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="humidity" name="Humidity (%RH)" stroke="#a78bfa" strokeWidth={1.6} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="print-chart h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartRows} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
                    <CartesianGrid stroke="rgba(30,58,85,0.45)" vertical={false} />
                    <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => new Date(t).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} stroke="#334155" fontSize={9} tickLine={false} />
                    <YAxis stroke="#334155" fontSize={9} tickLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: "rgba(5,11,20,0.96)", border: "1px solid rgba(30,58,85,0.9)", borderRadius: 8, fontSize: 11 }} labelFormatter={(v) => fmtDateTime(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line type="monotone" dataKey="current" name="Current (A)" stroke="#06b6d4" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="filterDiffPressure" name="Filter ΔP (Pa)" stroke="#f472b6" strokeWidth={1.6} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="runPct" name="RUN proportion (%)" stroke="#10b981" strokeWidth={1.6} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="panel overflow-hidden rounded-2xl">
            <header className="border-b border-ink-700/70 px-5 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-100">3 · Interval breakdown</h2>
              <p className="text-[11px] text-slate-500">
                {report.bucketLabel} · {report.buckets.length} intervals
              </p>
            </header>
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full min-w-[900px] text-left text-xs">
                <thead className="sticky top-0 bg-ink-900/95 text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Interval start</th>
                    <th className="px-3 py-2 text-right">Samples</th>
                    <th className="px-3 py-2 text-right">RUN %</th>
                    <th className="px-3 py-2 text-right">Supply °C</th>
                    <th className="px-3 py-2 text-right print-hide">Room °C</th>
                    <th className="px-3 py-2 text-right">%RH</th>
                    <th className="px-3 py-2 text-right">Filter ΔP</th>
                    <th className="px-3 py-2 text-right">Current A</th>
                    <th className="px-3 py-2 text-right print-hide">Voltage V</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-800/70">
                  {report.buckets.map((b) => (
                    <tr key={b.bucket}>
                      <td className="px-3 py-1.5 font-mono text-[11px] text-slate-400">{fmtDateTime(b.bucket)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-300">{b.count}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-emerald-300">
                        {b.count === 0 ? "—" : ((b.runCount / b.count) * 100).toFixed(0)}
                      </td>
                      {(["supplyTemp", "roomTemp", "humidity", "filterDiffPressure", "current", "voltage"] as ParamKey[]).map((p) => (
                        <td key={p} className={cx("px-3 py-1.5 text-right font-mono text-slate-300", (p === "roomTemp" || p === "voltage") && "print-hide")}>
                          {b.values[p] === null || b.values[p] === undefined ? "—" : Number(b.values[p]).toFixed(PARAMETERS.find((x) => x.key === p)!.decimals)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel overflow-hidden rounded-2xl">
            <header className="border-b border-ink-700/70 px-5 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-100">
                4 · Logged samples <span className="font-mono text-[10px] text-slate-500">latest {report.samples.length} of {report.totalRows}</span>
              </h2>
              <p className="text-[11px] text-slate-500">
                Visual tags mark SIMULATED, ESTIMATED_FALLBACK and NULL / UNAVAILABLE values so they are never confused
                with real physical measurements.
              </p>
            </header>
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full min-w-[1200px] text-left text-[11px]">
                <thead className="sticky top-0 bg-ink-900/95 text-[9px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Timestamp</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Run</th>
                    {PARAMETERS.map((p) => (
                      <th key={p.key} className={cx("px-2 py-2 text-right", PRINT_HIDE.has(p.key) && "print-hide")}>
                        {p.key}
                      </th>
                    ))}
                    <th className="px-3 py-2">Quality</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-800/70">
                  {report.samples.map((row, i) => {
                    const flags: DataQuality[] = [];
                    if (row.source === "SIMULATION") flags.push("SIMULATED");
                    if (row.isCurrentFallback || row.isVoltageFallback) flags.push("ESTIMATED_FALLBACK");
                    if (row.runState === "STOP") flags.push("STALE");
                    const missing = PARAMETERS.filter((p) => row[p.key] === null || row[p.key] === undefined).length;
                    if (missing > 0) flags.push("NULL_UNAVAILABLE");
                    return (
                      <tr key={String(row.id ?? i)}>
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono text-slate-400">{fmtDateTime(row.timestamp)}</td>
                        <td className="px-3 py-1.5">
                          <SourceTag source={(row.source as string) ?? null} />
                        </td>
                        <td className="px-3 py-1.5 font-mono text-slate-300">{String(row.runState ?? "—")}</td>
                        {PARAMETERS.map((p) => (
                          <td key={p.key} className={cx("px-2 py-1.5 text-right font-mono text-slate-300", PRINT_HIDE.has(p.key) && "print-hide")}>
                            {row[p.key] === null || row[p.key] === undefined ? <span className="text-slate-600">NULL</span> : Number(row[p.key]).toFixed(p.decimals)}
                          </td>
                        ))}
                        <td className="px-3 py-1.5">
                          <div className="flex flex-wrap gap-1">
                            {flags.length === 0 ? <QualityTag quality="OK" /> : null}
                            {flags.slice(0, 2).map((f) => (
                              <QualityTag key={f} quality={f} />
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {report.samples.length === 0 ? <div className="p-6"><Empty>No samples in this range.</Empty></div> : null}
          </div>

          <PrintFooter
            note={`End of report · Smart Monitoring AHU v1.1.0 · Source filter: ${report.source} · ${report.totalRows} valid samples · Data-quality flags per NFR-06 · Generated ${fmtDateTime(new Date())}`}
          />
        </>
      ) : null}
    </div>
  );
}

function StatTile({ label, value, sub, tone = "slate" }: { label: string; value: string; sub?: string; tone?: "slate" | "cyan" | "violet" | "emerald" | "amber" }) {
  const tones = {
    slate: "text-slate-200",
    cyan: "text-cyan-300",
    violet: "text-violet-300",
    emerald: "text-emerald-300",
    amber: "text-amber-300",
  } as const;
  return (
    <div className="panel rounded-2xl p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={cx("mt-1 font-mono text-2xl font-bold tabular-nums", tones[tone])}>{value}</p>
      {sub ? <p className="mt-0.5 text-[10px] text-slate-500">{sub}</p> : null}
    </div>
  );
}