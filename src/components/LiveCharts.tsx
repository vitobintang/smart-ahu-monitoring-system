"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Pause, Play } from "lucide-react";
import { cx } from "@/components/ui";

export interface ChartPoint {
  t: number;
  current: number | null;
  supplyTemp: number | null;
  roomTemp: number | null;
  humidity: number | null;
  filterDiffPressure: number | null;
  fanSpeed: number | null;
  run: boolean;
  source: string;
}

const tooltipStyle = {
  backgroundColor: "#ffffff",
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  fontSize: 11,
  color: "#0f172a",
} as const;

const axis = { stroke: "#64748b", fontSize: 10, tickLine: false } as const;
const tickFmt = (t: number) =>
  new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function ChartFrame({
  title,
  unit,
  note,
  children,
}: {
  title: string;
  unit: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-ink-700/70 bg-ink-900/50 p-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">{title}</p>
        <p className="font-mono text-[10px] text-slate-500">{unit}</p>
      </div>
      <div className="h-40">{children}</div>
      {note ? <p className="mt-1 text-[10px] text-slate-500">{note}</p> : null}
    </div>
  );
}

/** FR-08 real-time telemetry charts with 5/15/30-minute windows and pause/resume. */
export default function LiveCharts({
  points,
  buckets,
  windowMin,
  onWindow,
  paused,
  onTogglePause,
  runProportion,
}: {
  points: ChartPoint[];
  buckets: { t: number; run: number; total: number }[];
  windowMin: number;
  onWindow: (m: number) => void;
  paused: boolean;
  onTogglePause: () => void;
  runProportion: number;
}) {
  const runSeries = useMemo(
    () => buckets.map((b) => ({ t: b.t, run: b.total === 0 ? 0 : Number(((b.run / b.total) * 100).toFixed(1)) })),
    [buckets],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-[#cbd5e1] bg-[#eef3fb] p-0.5">
          {[5, 15, 30].map((m) => (
            <button
              key={m}
              onClick={() => onWindow(m)}
              className={cx(
                "rounded-[6px] px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide transition",
                windowMin === m ? "bg-[#1d6ef2] text-white shadow-xs" : "text-[#334155] hover:text-[#0f172a]",
              )}
            >
              {m} min
            </button>
          ))}
        </div>

        <button
          onClick={onTogglePause}
          className={cx(
            "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide transition",
            paused
              ? "border-amber-300 bg-amber-50 text-amber-800"
              : "border-emerald-300 bg-emerald-50 text-emerald-800",
          )}
        >
          {paused ? <Play size={13} /> : <Pause size={13} />}
          {paused ? "Resume stream" : "Pause stream"}
        </button>

        <span className="inline-flex items-center gap-2 rounded-lg border border-[#e4eaf3] bg-white px-3 py-1.5 font-mono text-[11px] text-[#334155] sm:ml-auto">
          RUN proportion
          <span className="text-base font-bold text-emerald-700">{(runProportion * 100).toFixed(1)} %</span>
          <span className="text-[#475569]">({points.length} samples)</span>
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartFrame title="RUN sample proportion" unit="% of samples in RUN">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={runSeries} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
              <defs>
                <linearGradient id="runGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.65} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(30,58,85,0.45)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tickFmt} {...axis} />
              <YAxis domain={[0, 100]} {...axis} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => tickFmt(Number(v))} />
              <ReferenceLine y={50} stroke="#1e3a55" strokeDasharray="4 4" />
              <Area type="stepAfter" dataKey="run" stroke="#10b981" strokeWidth={2} fill="url(#runGrad)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame
          title="Current"
          unit="A"
          note="ESTIMATED_FALLBACK placeholder samples (1 A / 220 V sentinels) are excluded from the plot — NFR-06.5."
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
              <CartesianGrid stroke="rgba(30,58,85,0.45)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tickFmt} {...axis} />
              <YAxis {...axis} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => tickFmt(Number(v))} />
              <Line type="monotone" dataKey="current" name="Current (A)" stroke="#06b6d4" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame title="Temperature" unit="°C">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
              <CartesianGrid stroke="rgba(30,58,85,0.45)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tickFmt} {...axis} />
              <YAxis {...axis} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => tickFmt(Number(v))} />
              <Line type="monotone" dataKey="supplyTemp" name="Supply (°C)" stroke="#22d3ee" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="roomTemp" name="Room (°C)" stroke="#f59e0b" strokeWidth={1.6} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame title="Relative humidity" unit="%RH">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
              <CartesianGrid stroke="rgba(30,58,85,0.45)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tickFmt} {...axis} />
              <YAxis domain={[0, 100]} {...axis} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => tickFmt(Number(v))} />
              <Line type="monotone" dataKey="humidity" name="Humidity (%RH)" stroke="#a78bfa" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>
    </div>
  );
}