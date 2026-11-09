"use client";

import { CheckCircle2 } from "lucide-react";
import { PARAMETERS, type DataQuality, type ParamKey } from "@/lib/domain";
import { cx } from "@/components/ui";

export interface ReportStats {
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

export interface Report {
  ahuId: string;
  ahuName: string;
  ahuLocation?: string;
  controlMode?: string;
  setpoint?: number;
  commTimeoutSec?: number;
  installedSensorCount?: number;
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

export type PaperSize = "A4" | "Letter" | "Legal" | "A3" | "Auto";
export type Orientation = "portrait" | "landscape";

export const THERMAL_AIR_PARAMS: ParamKey[] = [
  "supplyTemp",
  "returnTemp",
  "roomTemp",
  "coilTemp",
  "humidity",
  "fanSpeed",
];

export const MECH_ELEC_PARAMS: ParamKey[] = [
  "filterDiffPressure",
  "damperPosition",
  "heaterOutput",
  "current",
  "voltage",
  "runHours",
];

export const PARAM_SHORT_HEADER: Record<ParamKey, string> = {
  supplyTemp: "Sup °C",
  returnTemp: "Ret °C",
  roomTemp: "Room °C",
  coilTemp: "Coil °C",
  humidity: "RH %",
  filterDiffPressure: "ΔP Pa",
  fanSpeed: "Fan %",
  damperPosition: "Dmp %",
  heaterOutput: "Htr %",
  current: "Curr A",
  voltage: "Volt V",
  runHours: "Run h",
};

export function fmtCompactTs(ts: string | number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function fmtBucketTs(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
export function sampleFlags(row: Record<string, unknown>): DataQuality[] {
  const flags: DataQuality[] = [];
  if (row.isCurrentFallback || row.isVoltageFallback) flags.push("ESTIMATED_FALLBACK");
  if (row.source === "SIMULATION") flags.push("SIMULATED");
  const missing = PARAMETERS.filter((p) => row[p.key] === null || row[p.key] === undefined).length;
  if (missing > 0) flags.push("NULL_UNAVAILABLE");
  return flags;
}

export function SectionHeading({ number, title, right }: { number: string; title: string; right?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#cbd5e1] pb-1.5">
      <div className="flex items-center gap-2">
        <span className="rounded bg-[#0b1f3f] px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
          SEC {number}
        </span>
        <h3 className="text-[12.5px] font-extrabold uppercase tracking-[0.04em] text-[#0b1f3f]">{title}</h3>
      </div>
      {right ? <span className="font-mono text-[10px] font-medium text-[#475569]">{right}</span> : null}
    </div>
  );
}

export function SpecCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-white px-3 py-2">
      <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#64748b]">{label}</p>
      <p className={cx("mt-0.5 truncate text-[11px] font-semibold text-[#0f172a]", mono && "font-mono")}>{value}</p>
    </div>
  );
}

export function FormalKpi({
  label,
  value,
  sub,
  tone,
  className,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "navy" | "emerald" | "blue" | "violet" | "amber" | "slate";
  className?: string;
}) {
  const accents = {
    navy: "border-t-[#0b1f3f] text-[#0b1f3f]",
    emerald: "border-t-[#059669] text-[#047857]",
    blue: "border-t-[#1d6ef2] text-[#1d4ed8]",
    violet: "border-t-[#7c3aed] text-[#6d28d9]",
    amber: "border-t-[#d97706] text-[#b45309]",
    slate: "border-t-[#64748b] text-[#334155]",
  } as const;
  return (
    <div
      className={cx(
        "rounded-lg border border-[#cbd5e1] border-t-[3px] bg-[#fbfdff] px-3 py-2.5",
        accents[tone],
        className,
      )}
    >
      <p className="text-[9.5px] font-bold uppercase tracking-wider text-[#475569]">{label}</p>
      <p className="mt-1 font-mono text-[20px] font-extrabold leading-none tabular-nums">{value}</p>
      <p className="mt-1 truncate text-[10px] text-[#64748b]">{sub}</p>
    </div>
  );
}

export function SignatureBox({
  roleTitle,
  name,
  subRole,
  dateText,
  verified,
}: {
  roleTitle: string;
  name: string;
  subRole: string;
  dateText: string;
  verified?: boolean;
}) {
  return (
    <div className="flex flex-col justify-between rounded-lg border border-[#cbd5e1] bg-[#fbfdff] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[9.5px] font-bold uppercase tracking-wider text-[#475569]">{roleTitle}</span>
        {verified ? (
          <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-300">
            <CheckCircle2 size={10} /> SIGNED
          </span>
        ) : (
          <span className="font-mono text-[9px] uppercase text-[#94a3b8]">Sign / Stamp</span>
        )}
      </div>

      <div className="my-4 h-7 border-b border-dashed border-[#94a3b8]">
        {verified ? (
          <p className="pt-1 font-serif text-[13px] italic text-[#12294d]">{name}</p>
        ) : null}
      </div>

      <div>
        <p className="truncate text-[11px] font-bold text-[#0f172a]">{name}</p>
        <p className="truncate text-[10px] text-[#475569]">{subRole}</p>
        <p className="mt-1 font-mono text-[9.5px] text-[#64748b]">{dateText}</p>
      </div>
    </div>
  );
}

/**
 * Pure Vector Print-Safe Multi-Series Line Chart.
 * Scales cleanly via SVG viewBox across A4/Letter/Legal/A3 Portrait & Landscape
 * with zero Recharts JS width clipping during window.print().
 */
export function VectorTrendChart({
  figure,
  title,
  subtitle,
  rows,
  series,
}: {
  figure: string;
  title: string;
  subtitle: string;
  rows: Array<Record<string, number | null>>;
  series: Array<{ key: string; label: string; color: string }>;
}) {
  const W = 680;
  const H = 196;
  const padL = 44;
  const padR = 16;
  const padT = 14;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const allValues: number[] = [];
  for (const r of rows) {
    for (const s of series) {
      const v = r[s.key];
      if (typeof v === "number" && Number.isFinite(v)) allValues.push(v);
    }
  }

  const rawMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const rawMax = allValues.length > 0 ? Math.max(...allValues) : 100;
  const padRange = rawMax === rawMin ? Math.max(1, Math.abs(rawMax) * 0.1) : (rawMax - rawMin) * 0.1;
  const yMin = rawMin - padRange;
  const yMax = rawMax + padRange;

  const tMin = rows.length > 0 ? Number(rows[0].t ?? 0) : 0;
  const tMax = rows.length > 1 ? Number(rows[rows.length - 1].t ?? tMin + 1) : tMin + 1;

  const xOf = (t: number, idx: number) => {
    if (rows.length <= 1 || tMax <= tMin) return padL + plotW / 2;
    const ratio = (t - tMin) / (tMax - tMin);
    return padL + (Number.isFinite(ratio) ? ratio : idx / Math.max(1, rows.length - 1)) * plotW;
  };
  const yOf = (v: number) => padT + plotH - ((v - yMin) / Math.max(1e-6, yMax - yMin)) * plotH;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: padT + plotH * (1 - f),
    val: yMin + (yMax - yMin) * f,
  }));

  const xTickIndices =
    rows.length <= 1
      ? rows.map((_, i) => i)
      : Array.from(new Set([0, Math.floor((rows.length - 1) * 0.33), Math.floor((rows.length - 1) * 0.66), rows.length - 1]));

  return (
    <div className="avoid-break rounded-lg border border-[#cbd5e1] bg-white p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-mono text-[9.5px] font-bold uppercase tracking-wider text-[#1d6ef2]">{figure}</span>
          <h4 className="text-[12px] font-bold text-[#0b1f3f]">{title}</h4>
          <p className="text-[10px] text-[#64748b]">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#334155]">
              <span className="h-2 w-2.5 rounded-xs" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {allValues.length === 0 ? (
        <div className="grid h-36 place-items-center rounded border border-dashed border-[#e2e8f0] text-[11px] text-[#64748b]">
          Insufficient interval data in selected window
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full select-none overflow-visible">
          {/* Plot background */}
          <rect x={padL} y={padT} width={plotW} height={plotH} fill="#fbfdff" stroke="#e2e8f0" strokeWidth={1} />

          {/* Horizontal gridlines & Y ticks */}
          {yTicks.map((tk, i) => (
            <g key={i}>
              <line
                x1={padL}
                x2={padL + plotW}
                y1={tk.y}
                y2={tk.y}
                stroke="#e2e8f0"
                strokeDasharray={i === 0 || i === yTicks.length - 1 ? undefined : "3 3"}
                strokeWidth={0.9}
              />
              <text
                x={padL - 6}
                y={tk.y + 3}
                textAnchor="end"
                fontSize={9}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fill="#475569"
              >
                {tk.val.toFixed(Math.abs(tk.val) >= 100 ? 0 : 1)}
              </text>
            </g>
          ))}

          {/* X-axis time ticks */}
          {xTickIndices.map((idx) => {
            const row = rows[idx];
            if (!row || typeof row.t !== "number") return null;
            const x = xOf(row.t, idx);
            return (
              <g key={idx}>
                <line x1={x} x2={x} y1={padT + plotH} y2={padT + plotH + 4} stroke="#94a3b8" strokeWidth={1} />
                <text
                  x={x}
                  y={H - 6}
                  textAnchor={idx === 0 ? "start" : idx === rows.length - 1 ? "end" : "middle"}
                  fontSize={9}
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fill="#475569"
                >
                  {fmtBucketTs(row.t)}
                </text>
              </g>
            );
          })}

          {/* Series polylines */}
          {series.map((s) => {
            const segments: string[] = [];
            let open = false;
            rows.forEach((r, idx) => {
              const v = r[s.key];
              const t = r.t;
              if (typeof v === "number" && Number.isFinite(v) && typeof t === "number") {
                const cmd = open ? "L" : "M";
                segments.push(`${cmd}${xOf(t, idx).toFixed(1)},${yOf(v).toFixed(1)}`);
                open = true;
              } else {
                open = false;
              }
            });
            if (segments.length === 0) return null;
            return (
              <g key={s.key}>
                <path
                  d={segments.join(" ")}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {rows.length === 1 && typeof rows[0][s.key] === "number" && typeof rows[0].t === "number" ? (
                  <circle cx={xOf(rows[0].t, 0)} cy={yOf(rows[0][s.key] as number)} r={3.5} fill={s.color} />
                ) : null}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

