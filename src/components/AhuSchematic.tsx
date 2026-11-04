"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Boxes, ImageIcon, Info, X } from "lucide-react";
import type { AhuStatus, DataSource } from "@/db/schema";
import { classifyQuality, type DataQuality, type ParamKey } from "@/lib/domain";
import { cx, QualityTag, Segmented, StatusBadge } from "@/components/ui";

interface ThresholdInfo {
  low: number | null;
  high: number | null;
  delaySec: number;
  priority: string;
}

interface Props {
  ahuId: string;
  hasHeater: boolean;
  installed: string[];
  status: AhuStatus;
  values: Record<string, number | null>;
  fallback: { current: boolean; voltage: boolean };
  source?: DataSource | string | null;
  stale?: boolean;
  limits?: { filterHigh?: number | null; filterLow?: number | null; coilHigh?: number | null; supplyHigh?: number | null };
  thresholdMap?: Record<string, ThresholdInfo>;
}

type Stage = "ok" | "warn" | "alarm" | "off" | "missing";

const TONE: Record<Stage, { stroke: string; fill: string; text: string; dot: string; pill: string }> = {
  ok: { stroke: "#10b981", fill: "rgba(16,185,129,0.13)", text: "#6ee7b7", dot: "bg-emerald-400", pill: "border-emerald-500/40 bg-emerald-500/12 text-emerald-100" },
  warn: { stroke: "#f59e0b", fill: "rgba(245,158,11,0.15)", text: "#fcd34d", dot: "bg-amber-400", pill: "border-amber-500/40 bg-amber-500/12 text-amber-100" },
  alarm: { stroke: "#ef4444", fill: "rgba(239,68,68,0.17)", text: "#fca5a5", dot: "bg-red-500", pill: "border-red-500/45 bg-red-500/14 text-red-100" },
  missing: { stroke: "#475569", fill: "rgba(51,65,85,0.14)", text: "#64748b", dot: "bg-slate-600", pill: "border-slate-600/50 bg-slate-800/30 text-slate-400" },
  off: { stroke: "#64748b", fill: "rgba(71,85,105,0.1)", text: "#94a3b8", dot: "bg-slate-500", pill: "border-slate-600/45 bg-slate-800/40 text-slate-300" },
};

const GEO: Record<string, { x: number; y: number; w: number; h: number; mx: number; my: number; cx?: number; cy?: number; r?: number }> = {
  damper: { x: 88, y: 224, w: 236, h: 456, mx: 12.9, my: 23.5 },
  filter: { x: 384, y: 228, w: 232, h: 448, mx: 31.3, my: 23.5 },
  coil: { x: 672, y: 232, w: 256, h: 542, mx: 50, my: 23.5 },
  heater: { x: 968, y: 228, w: 248, h: 448, mx: 68.3, my: 23.5 },
  fan: { x: 1273, y: 318, w: 264, h: 264, cx: 1405, cy: 450, r: 130, mx: 87.8, my: 29.5 },
};

const AIR_PATH =
  "M 16 464 L 928 464 " +
  "C 950 464 950 294 985 294 " +
  "L 1190 294 " +
  "C 1228 294 1228 464 1190 464 " +
  "L 985 464 " +
  "C 958 464 958 612 985 612 " +
  "L 1190 612 " +
  "C 1264 612 1324 548 1358 490 L 1380 464";

const WATER_PATH =
  "M 690 632 L 690 302 Q 690 284 708 284 L 722 284 Q 740 284 740 302 L 740 632 " +
  "Q 740 650 758 650 L 772 650 Q 790 650 790 632 L 790 302 Q 790 284 808 284 " +
  "L 822 284 Q 840 284 840 302 L 840 632 Q 840 650 858 650 L 872 650 " +
  "Q 890 650 890 632 L 890 302";

const FLOW_PATHS = { discharge: "M 1534 450 L 1592 450" } as const;
const FLOW_STOPS = { coilIn: 672, coilOut: 928, heaterOut: 1216, end: 1400 } as const;

const ASSESS: Record<Stage, string> = {
  ok: "Operating within configured limits.",
  warn: "Approaching a configured limit — watch the trend projection.",
  alarm: "Limit exceeded or controller fault — active alarm condition.",
  off: "Component idle: unit is not running or the sensor is not transmitting.",
  missing: "Sensor UNINSTALLED on this AHU — no live data for this stage (NFR-06).",
};

interface StageDef {
  key: ParamKey;
  label: string;
  sub: string;
  state: Stage;
  param: ParamKey;
}

export default function AhuSchematic({
  ahuId,
  hasHeater,
  installed,
  status,
  values,
  limits,
  source = null,
  stale = false,
  thresholdMap = {},
}: Props) {
  const [model, setModel] = useState<"realistic" | "schematic">(() => {
    if (typeof window === "undefined") return "realistic";
    try {
      return window.localStorage.getItem("ahu-schematic-model") === "schematic" ? "schematic" : "realistic";
    } catch {
      return "realistic";
    }
  });
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem("ahu-schematic-model", model);
    } catch {
      /* ignore */
    }
  }, [model]);

  const running = status === "RUN";
  const faulted = status === "FAULT";
  const offline = status === "OFFLINE";

  const damper = values.damperPosition ?? null;
  const filterDp = values.filterDiffPressure ?? null;
  const coil = values.coilTemp ?? null;
  const fan = values.fanSpeed ?? null;
  const heater = values.heaterOutput ?? null;
  const supply = values.supplyTemp ?? null;

  const has = (k: string) => installed.includes(k);
  const unavail = (k: string) => (has(k) ? "UNAVAILABLE" : "UNINSTALLED");

  const filterState: Stage = !has("filterDiffPressure")
    ? "missing"
    : filterDp === null
      ? "off"
      : limits?.filterHigh != null && filterDp > limits.filterHigh
        ? "alarm"
        : limits?.filterHigh != null && filterDp > limits.filterHigh * 0.8
          ? "warn"
          : "ok";
  const coilState: Stage = !has("coilTemp")
    ? "missing"
    : coil === null
      ? "off"
      : limits?.coilHigh != null && coil > limits.coilHigh
        ? "warn"
        : running
          ? "ok"
          : "off";
  const fanState: Stage = !has("fanSpeed") ? "missing" : faulted ? "alarm" : offline ? "missing" : running ? "ok" : "off";
  const damperState: Stage = !has("damperPosition") ? "missing" : damper === null ? "off" : damper > 5 ? "ok" : "off";
  const heaterState: Stage = !hasHeater ? "missing" : heater === null ? "off" : heater > 3 ? "warn" : "off";

  const stages: StageDef[] = [
    { key: "damperPosition", param: "damperPosition", label: "Intake Damper", sub: damper === null ? unavail("damperPosition") : `${damper.toFixed(0)} % open`, state: damperState },
    { key: "filterDiffPressure", param: "filterDiffPressure", label: "Filter Stage", sub: filterDp === null ? unavail("filterDiffPressure") : `ΔP ${filterDp.toFixed(0)} Pa`, state: filterState },
    { key: "coilTemp", param: "coilTemp", label: "Cooling Coil", sub: coil === null ? unavail("coilTemp") : `${coil.toFixed(1)} °C`, state: coilState },
  ];

  if (hasHeater) {
    stages.push({
      key: "heaterOutput",
      param: "heaterOutput",
      label: "Heating Coil",
      sub: heater === null ? unavail("heaterOutput") : `${heater.toFixed(0)} % output`,
      state: heaterState,
    });
  }
  stages.push({
    key: "fanSpeed",
    param: "fanSpeed",
    label: "Supply Fan",
    sub: fan === null ? unavail("fanSpeed") : `${fan.toFixed(0)} % speed`,
    state: fanState,
  });

  const stageByKey = useMemo(() => new Map(stages.map((s) => [s.key as string, s])), [stages]);
  const fanPct = fan ?? 0;
  const flowDur = Math.max(0.7, 3.4 - (fanPct / 100) * 2.6);
  const spinDur = fanPct > 0 ? Math.max(0.5, 2.4 - (fanPct / 100) * 1.9) : 0;
  const damperOpen = damper === null ? 0 : damper;
  const heaterActive = (heater ?? 0) > 3;

  const qualityOf = (s: StageDef): DataQuality =>
    classifyQuality({
      param: s.param,
      installed,
      value: values[s.param],
      fallbackFlag: s.param === "current" ? false : s.param === "voltage" ? false : undefined,
      stale,
      source: (source as DataSource | null) ?? null,
    });

  const sel = selected ? stageByKey.get(selected) : null;
  const selTh = selected ? thresholdMap[selected] : null;

  return (
    <div className="rounded-xl border border-ink-700/70 bg-ink-950/40 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{ahuId} · airflow path · FR-07</p>
          <p className="mt-0.5 text-[11.5px] text-slate-500">
            Intake damper → filter → cooling coil{hasHeater ? " → heating coil" : ""} → supply fan · supply air{" "}
            <span className="num text-brand-300">{supply === null ? "—" : `${supply.toFixed(1)} °C`}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={status} size="sm" />
          <Segmented
            size="sm"
            value={model}
            onChange={(v) => setModel(v)}
            options={[
              { value: "realistic", label: <span className="inline-flex items-center gap-1.5"><ImageIcon size={12} /> Realistic machine</span> },
              { value: "schematic", label: <span className="inline-flex items-center gap-1.5"><Boxes size={12} /> Schematic</span> },
            ]}
          />
        </div>
      </div>

      {model === "realistic" ? (
        <div className="animate-fade">
          <div className="relative overflow-hidden rounded-xl border border-ink-700 bg-ink-950 ring-1 ring-inset ring-white/5">
            <Image
              src="/ahu/side-elevation.jpg"
              alt="Flat orthographic side elevation of the air handling unit: intake damper, filter stage, cooling coil, heating coil and supply fan scroll"
              width={2000}
              height={1125}
              className={cx(
                "h-auto w-full select-none object-cover transition-[filter] duration-500",
                offline && "brightness-[0.62] saturate-[0.35]",
              )}
              sizes="(max-width: 1024px) 100vw, 940px"
              priority
              draggable={false}
            />
            {faulted ? (
              <div className="pointer-events-none absolute inset-0 animate-blink bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(239,68,68,0.28)_100%)]" />
            ) : null}
            <svg viewBox="0 0 1600 900" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
              <defs>
                <linearGradient id="bladeGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#e5edf5" />
                  <stop offset="45%" stopColor="#9fb2c4" />
                  <stop offset="100%" stopColor="#5c7186" />
                </linearGradient>
                <radialGradient id="hubGrad" cx="0.35" cy="0.35" r="0.9">
                  <stop offset="0%" stopColor="#f2f7fb" />
                  <stop offset="60%" stopColor="#8fa3b6" />
                  <stop offset="100%" stopColor="#42566b" />
                </radialGradient>
                <radialGradient id="boreGrad" cx="0.5" cy="0.5" r="0.75">
                  <stop offset="0%" stopColor="#04070c" />
                  <stop offset="78%" stopColor="#070d16" />
                  <stop offset="100%" stopColor="#0d1622" />
                </radialGradient>
                {(["cool", "heat"] as const).map((variant) => (
                  <linearGradient
                    key={variant}
                    id={`flowGrad-${variant}`}
                    gradientUnits="userSpaceOnUse"
                    x1={16}
                    y1={0}
                    x2={FLOW_STOPS.end}
                    y2={0}
                  >
                    <stop offset={0} stopColor="#9fb2c4" />
                    <stop offset={(FLOW_STOPS.coilIn - 16) / (FLOW_STOPS.end - 16)} stopColor="#9fb2c4" />
                    <stop offset={(FLOW_STOPS.coilIn - 16) / (FLOW_STOPS.end - 16)} stopColor="#22d3ee" />
                    <stop offset={(FLOW_STOPS.coilOut - 16) / (FLOW_STOPS.end - 16)} stopColor="#22d3ee" />
                    <stop offset={(FLOW_STOPS.coilOut - 16) / (FLOW_STOPS.end - 16)} stopColor={variant === "heat" ? "#fbbf24" : "#22d3ee"} />
                    <stop offset={(FLOW_STOPS.heaterOut - 16) / (FLOW_STOPS.end - 16)} stopColor={variant === "heat" ? "#fbbf24" : "#22d3ee"} />
                    <stop offset={(FLOW_STOPS.heaterOut - 16) / (FLOW_STOPS.end - 16)} stopColor="#67e8f9" />
                    <stop offset={1} stopColor="#67e8f9" />
                  </linearGradient>
                ))}
              </defs>
              <g className={cx(!running && "flow-line-paused")} style={{ pointerEvents: "none" }}>
                <path
                  d={AIR_PATH}
                  fill="none"
                  stroke={`url(#flowGrad-${heaterActive ? "heat" : "cool"})`}
                  strokeWidth={15}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={running ? 0.1 + 0.1 * (damperOpen / 100) : 0.05}
                />
                <path
                  d="M 6 455 L 18 464 L 6 473"
                  fill="none"
                  stroke="#9fb2c4"
                  strokeWidth={3}
                  opacity={running ? 0.4 + 0.6 * (damperOpen / 100) : 0.25}
                />
                <path
                  d={AIR_PATH}
                  fill="none"
                  stroke={`url(#flowGrad-${heaterActive ? "heat" : "cool"})`}
                  strokeWidth={4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="flow-line"
                  style={{
                    strokeDasharray: "18 14",
                    animationDuration: `${flowDur.toFixed(2)}s`,
                    opacity: running ? 0.55 + 0.45 * (damperOpen / 100) : undefined,
                    filter: "drop-shadow(0 0 6px rgba(103,232,249,0.55))",
                  }}
                />
                <path
                  d={WATER_PATH}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  className="flow-line"
                  style={{
                    strokeDasharray: "7 11",
                    animationDuration: `${(flowDur * 2.4).toFixed(2)}s`,
                    opacity: running ? 0.75 : 0.3,
                  }}
                />
                <path
                  d={FLOW_PATHS.discharge}
                  fill="none"
                  stroke="#67e8f9"
                  strokeWidth={4}
                  strokeLinecap="round"
                  className="flow-line"
                  style={{ strokeDasharray: "14 10", animationDuration: `${(flowDur * 0.6).toFixed(2)}s` }}
                />
                <path d="M1580 434 L1599 450 L1580 466 Z" fill="#67e8f9" opacity={running ? 0.95 : 0.25} />
              </g>
              {fanState !== "missing" ? (
                <g style={{ pointerEvents: "none" }}>
                  <circle cx={1405} cy={450} r={128} fill="url(#boreGrad)" opacity={0.94} />
                  <g
                    style={{
                      transformOrigin: "1405px 450px",
                      animation: running && spinDur ? `spin ${spinDur}s linear infinite` : undefined,
                      opacity: running ? 0.97 : 0.8,
                    }}
                  >
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                      <path
                        key={i}
                        d="M 16 -22 Q 68 -70 116 -44 Q 86 -4 22 10 Z"
                        fill="url(#bladeGrad)"
                        stroke="#2b3d50"
                        strokeWidth={1.5}
                        transform={`translate(1405 450) rotate(${i * 40})`}
                      />
                    ))}
                    <circle cx={1405} cy={450} r={26} fill="url(#hubGrad)" stroke="#22303f" strokeWidth={2} />
                    <circle cx={1405} cy={450} r={8} fill="#16202c" />
                  </g>
                  <circle cx={1405} cy={450} r={130} fill="none" stroke="#cbd5e1" strokeWidth={3} opacity={0.35} />
                </g>
              ) : (
                <g style={{ pointerEvents: "none" }}>
                  <circle cx={1405} cy={450} r={128} fill="none" stroke="#475569" strokeWidth={3} strokeDasharray="10 8" />
                </g>
              )}
              {stages.map((s) => {
                const g = GEO[s.key as string];
                if (!g) return null;
                const t = TONE[s.state];
                const isHover = hover === s.key;
                const isSel = selected === s.key;
                const shape =
                  s.key === "fanSpeed" ? (
                    <circle cx={g.cx} cy={g.cy} r={g.r} fill="transparent" />
                  ) : (
                    <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={10} fill="transparent" />
                  );
                return (
                  <g key={s.key}>
                    <g style={{ pointerEvents: "none" }} className={cx(s.state === "alarm" && "animate-blink")}>
                      {s.key === "fanSpeed" ? (
                        <circle cx={g.cx} cy={g.cy} r={g.r} fill={t.stroke} opacity={s.state === "ok" ? 0.05 : 0.12} />
                      ) : (
                        <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={10} fill={t.stroke} opacity={s.state === "ok" ? 0.05 : 0.12} />
                      )}
                    </g>
                    <g
                      className={cx(isSel && s.state === "alarm" && "animate-blink")}
                      style={{
                        pointerEvents: "none",
                        opacity: isSel ? 1 : isHover ? 0.9 : s.state === "alarm" ? 0.85 : 0,
                        transition: "opacity 140ms ease",
                      }}
                      stroke={isSel ? "#67e8f9" : t.stroke}
                      strokeWidth={isSel ? 4 : 3}
                      fill="none"
                    >
                      {s.key === "fanSpeed" ? (
                        <circle cx={g.cx} cy={g.cy} r={g.r} />
                      ) : (
                        <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={10} />
                      )}
                    </g>
                    <g
                      style={{ pointerEvents: "all", cursor: "pointer" }}
                      onMouseEnter={() => setHover(s.key as string)}
                      onMouseLeave={() => setHover((h) => (h === s.key ? null : h))}
                      onClick={() => setSelected((cur) => (cur === s.key ? null : (s.key as string)))}
                    >
                      {shape}
                      <title>{`${s.label} — ${s.sub}. Click for live detail.`}</title>
                    </g>
                  </g>
                );
              })}
            </svg>
            {stages.map((s, i) => {
              const g = GEO[s.key as string];
              if (!g) return null;
              const t = TONE[s.state];
              const na = s.state === "missing";
              const isSel = selected === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSelected((cur) => (cur === s.key ? null : (s.key as string)))}
                  className={cx(
                    "absolute grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 font-mono text-[11px] font-bold backdrop-blur-md transition-transform hover:scale-110",
                    na ? "border-dashed bg-ink-950/75 text-slate-400" : "bg-ink-950/82 text-white",
                    isSel && "ring-2 ring-brand-400/70",
                  )}
                  style={{
                    left: `${g.mx}%`,
                    top: `${g.my}%`,
                    ...(na ? { borderColor: "#475569" } : { borderColor: t.stroke, boxShadow: `0 0 16px -2px ${t.stroke}` }),
                  }}
                  title={`${i + 1} · ${s.label} — ${s.sub}`}
                >
                  {s.state === "alarm" ? (
                    <span className="absolute inset-0 animate-ping-slow rounded-full" style={{ background: `${t.stroke}66` }} />
                  ) : null}
                  <span className="relative">{i + 1}</span>
                </button>
              );
            })}
            <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-white/12 bg-ink-950/75 px-2 py-1 backdrop-blur-md">
              <p className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-brand-200">
                AI side-elevation model · live telemetry overlay
              </p>
            </div>
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-white/10 bg-ink-950/72 px-2 py-1 backdrop-blur-md">
              <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-400">
                {running ? `airflow → · fan ${fanPct.toFixed(0)} % · ${(1 / Math.max(spinDur, 0.01)).toFixed(1)} rev/s` : "airflow stopped"}
              </p>
            </div>
          </div>
          {sel ? (
            <div className="animate-rise mt-3 rounded-lg border border-brand-500/35 bg-brand-500/8 p-3">
              <div className="flex items-center gap-2">
                <Info size={13} className="flex-none text-brand-300" />
                <p className="text-[12px] font-semibold text-brand-100">{sel.label}</p>
                <span className={cx("h-1.5 w-1.5 rounded-full", TONE[sel.state].dot)} />
                <span className="text-[11px] text-slate-400">{sel.sub}</span>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="ml-auto rounded p-1 text-slate-500 transition hover:bg-ink-800 hover:text-slate-200"
                  aria-label="Close component detail"
                >
                  <X size={13} />
                </button>
              </div>
              <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-2 lg:grid-cols-5">
                <div>
                  <p className="eyebrow">Limits</p>
                  <p className="num mt-0.5 text-slate-200">
                    {selTh ? `${selTh.low ?? "—"} … ${selTh.high ?? "—"} ${sel.param === "filterDiffPressure" ? "Pa" : sel.param === "fanSpeed" || sel.param === "heaterOutput" || sel.param === "damperPosition" ? "%" : "°C"}` : "not configured"}
                  </p>
                </div>
                <div>
                  <p className="eyebrow">Activation delay</p>
                  <p className="num mt-0.5 text-slate-200">{selTh ? `${selTh.delaySec} s` : "—"}</p>
                </div>
                <div>
                  <p className="eyebrow">Alarm priority</p>
                  <p className="num mt-0.5 text-slate-200">{selTh?.priority ?? "—"}</p>
                </div>
                <div>
                  <p className="eyebrow">Data quality</p>
                  <p className="mt-0.5"><QualityTag quality={qualityOf(sel)} /></p>
                </div>
                <div className="sm:col-span-2 lg:col-span-1">
                  <p className="eyebrow">Assessment</p>
                  <p className="mt-0.5 leading-snug text-slate-300">{ASSESS[sel.state]}</p>
                </div>
              </div>
            </div>
          ) : null}
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {stages.map((s, i) => {
              const t = TONE[s.state];
              const isSel = selected === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSelected((cur) => (cur === s.key ? null : (s.key as string)))}
                  onMouseEnter={() => setHover(s.key as string)}
                  onMouseLeave={() => setHover((h) => (h === s.key ? null : h))}
                  className={cx(
                    "relative overflow-hidden rounded-lg border px-2.5 py-2 text-left transition-all",
                    t.pill,
                    isSel ? "ring-2 ring-brand-400/60" : "hover:brightness-125",
                    s.state === "alarm" && "animate-blink",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="num grid h-4 w-4 flex-none place-items-center rounded-full bg-ink-950/50 text-[9px] font-bold opacity-80">{i + 1}</span>
                    <span className={cx("h-1.5 w-1.5 flex-none rounded-full", t.dot)} />
                    <p className="truncate text-[11px] font-semibold">{s.label}</p>
                  </div>
                  <p className="num mt-1 text-[12.5px] font-semibold">{s.sub}</p>
                </button>
              );
            })}
          </div>

          <p className="mt-2.5 text-[10px] leading-relaxed text-slate-500">
            Strict side elevation (no perspective). One continuous air ribbon follows the machine&rsquo;s real path:
            intake → damper louvers → filter media → straight across the cooling-coil fin pack →{" "}
            <span className="text-slate-300">serpentine with U-turns through the three heating-coil bundles</span> →
            a long sweep into the circular fan bore → discharge jet at the rim. A second, slower stream traces the{" "}
            <span className="text-slate-300">chilled-water circuit along the cooling coil&rsquo;s copper U-bends</span>.
            Ribbon colour tracks the zone (grey ambient, cyan chilled, amber when the heater is active, bright cyan
            into the fan); speed tracks the measured fan speed and the ribbon fades as the damper closes.{" "}
            <span className="text-slate-300">Hover</span> a component to highlight it,{" "}
            <span className="text-slate-300">click</span> for live limits, delay, priority and data quality. Colours:{" "}
            <span className="text-emerald-400">green</span> normal · <span className="text-amber-400">amber</span>{" "}
            near-limit / heating · <span className="text-red-400">red, pulsing</span> alarm ·{" "}
            <span className="text-slate-500">grey dashed</span> UNINSTALLED / OFFLINE. Values come from stored
            telemetry, never from the image.
          </p>
        </div>
      ) : (
        <SchematicBranch
          stages={stages}
          running={running}
          hasHeater={hasHeater}
          damper={damper}
          heater={heater}
          fanSpeed={fan}
          flowDur={flowDur}
          selected={selected}
          onSelect={setSelected}
        />
      )}

      {!hasHeater ? (
        <p className="mt-2 text-[10px] text-slate-600">
          Heating coil stage omitted for this unit — <span className="num">hasHeater = false</span> (FR-07).
        </p>
      ) : null}
    </div>
  );
}

function SchematicBranch({
  stages,
  running,
  hasHeater,
  damper,
  heater,
  fanSpeed,
  selected,
  onSelect,
  flowDur,
}: {
  stages: StageDef[];
  running: boolean;
  hasHeater: boolean;
  damper: number | null;
  heater: number | null;
  fanSpeed: number | null;
  selected: string | null;
  onSelect: (k: string | null) => void;
  flowDur: number;
}) {
  const byKey = new Map(stages.map((s) => [s.key as string, s]));
  const open = Math.max(6, Math.min(94, damper ?? 0));
  const heaterOn = (heater ?? 0) > 3;
  const spinDur = (fanSpeed ?? 0) > 0 ? Math.max(0.5, 2.4 - ((fanSpeed ?? 0) / 100) * 1.9) : 0;

  const AREAS: Record<string, { x: number; y: number; w: number; h: number }> = {
    damperPosition: { x: 40, y: 52, w: 154, h: 208 },
    filterDiffPressure: { x: 206, y: 52, w: 144, h: 208 },
    coilTemp: { x: 366, y: 52, w: 204, h: 224 },
    heaterOutput: { x: 586, y: 52, w: 144, h: 208 },
    fanSpeed: { x: 746, y: 52, w: 264, h: 208 },
  };

  return (
    <div className="animate-fade">
      <div className="overflow-x-auto rounded-xl border border-[#e4eaf3] bg-gradient-to-b from-[#fbfdff] to-[#eef3fa] p-2">
        <svg viewBox="0 0 1040 336" className="min-w-[760px] w-full">
          <defs>
            <linearGradient id="sch-casing" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fdfeff" />
              <stop offset="55%" stopColor="#e8edf4" />
              <stop offset="100%" stopColor="#cfd8e3" />
            </linearGradient>
            <linearGradient id="sch-metal" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#f4f7fa" />
              <stop offset="50%" stopColor="#b9c4d2" />
              <stop offset="100%" stopColor="#8494a7" />
            </linearGradient>
            <linearGradient id="sch-copper" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d98e5f" />
              <stop offset="50%" stopColor="#b4653a" />
              <stop offset="100%" stopColor="#8c4a26" />
            </linearGradient>
            <linearGradient id="sch-pan" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#dfe6ee" />
              <stop offset="100%" stopColor="#aeb9c8" />
            </linearGradient>
            <filter id="sch-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <rect x={20} y={288} width={1000} height={14} rx={3} fill="url(#sch-metal)" stroke="#8494a7" strokeWidth={1} />
          {[60, 340, 620, 940].map((x) => (
            <rect key={x} x={x} y={302} width={26} height={10} rx={2} fill="#94a3b8" />
          ))}
          <rect x={24} y={36} width={992} height={252} rx={12} fill="url(#sch-casing)" stroke="#94a3b8" strokeWidth={1.6} />
          <line x1={44} y1={50} x2={996} y2={50} stroke="#22d3ee" strokeWidth={2.5} opacity={0.55} filter="url(#sch-glow)" />
          {[198, 358, 578, 738].map((x) => (
            <line key={x} x1={x} y1={40} x2={x} y2={284} stroke="#b6c2d1" strokeWidth={1.4} strokeDasharray="6 5" />
          ))}
          <g>
            <rect x={48} y={60} width={138} height={192} rx={6} fill="#f2f6fb" stroke="#8494a7" strokeWidth={1.4} />
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <rect
                key={i}
                x={56}
                y={72 + i * 25}
                width={122}
                height={7}
                rx={3.5}
                fill="url(#sch-metal)"
                stroke="#64748b"
                strokeWidth={0.7}
                transform={`rotate(${-(open / 100) * 62} 117 ${75 + i * 25})`}
              />
            ))}
            <line x1={180} y1={70} x2={180} y2={248} stroke="#64748b" strokeWidth={2} opacity={0.7} />
          </g>
          <g>
            <rect x={214} y={60} width={128} height={192} rx={6} fill="#f7f4ec" stroke="#8494a7" strokeWidth={1.4} />
            {Array.from({ length: 11 }, (_, i) => (
              <path
                key={i}
                d={`M${220 + i * 11} 66 L${226 + i * 11} 156 L${220 + i * 11} 246`}
                fill="none"
                stroke="#c9b896"
                strokeWidth={2.2}
              />
            ))}
            <rect x={214} y={60} width={128} height={192} rx={6} fill="#a16207" opacity={Math.min(0.3, ((byKey.get("filterDiffPressure")?.sub.match(/\d+/)?.[0] ?? 0) as number) / 900)} />
          </g>
          <g>
            <rect x={376} y={60} width={184} height={172} rx={4} fill="#e6edf5" stroke="#8494a7" strokeWidth={1.2} />
            {Array.from({ length: 30 }, (_, i) => (
              <line key={i} x1={380 + i * 6} y1={64} x2={380 + i * 6} y2={228} stroke="#9fb0c2" strokeWidth={1} opacity={0.75} />
            ))}
            <rect x={370} y={60} width={7} height={172} rx={3} fill="url(#sch-copper)" />
            <rect x={559} y={60} width={7} height={172} rx={3} fill="url(#sch-copper)" />
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <path key={i} d={`M370 ${74 + i * 30} q -12 9 0 18`} fill="none" stroke="url(#sch-copper)" strokeWidth={3.4} />
            ))}
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <path key={`r${i}`} d={`M566 ${89 + i * 30} q 12 9 0 18`} fill="none" stroke="url(#sch-copper)" strokeWidth={3.4} />
            ))}
            <rect x={386} y={240} width={164} height={26} rx={5} fill="url(#sch-pan)" stroke="#8494a7" strokeWidth={1.2} />
            <line x1={392} y1={250} x2={544} y2={250} stroke="#7dd3fc" strokeWidth={2.5} opacity={0.8} />
            <rect x={462} y={266} width={12} height={14} rx={2} fill="#94a3b8" />
          </g>
          {hasHeater ? (
            <g>
              {[0, 1, 2].map((r) => (
                <g key={r}>
                  <path
                    d={`M596 ${96 + r * 58} q 10 -9 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0`}
                    fill="none"
                    stroke="#94a3b8"
                    strokeWidth={6}
                    strokeLinecap="round"
                  />
                  <path
                    d={`M596 ${96 + r * 58} q 10 -9 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0`}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth={6}
                    strokeLinecap="round"
                    opacity={heaterOn ? 0.9 : 0.08}
                    filter="url(#sch-glow)"
                  />
                </g>
              ))}
              <rect x={590} y={60} width={6} height={192} rx={3} fill="#8494a7" />
              <rect x={722} y={60} width={6} height={192} rx={3} fill="#8494a7" />
            </g>
          ) : (
            <g opacity={0.5}>
              <rect x={596} y={70} width={126} height={172} rx={6} fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="8 6" />
              <text x={659} y={160} textAnchor="middle" fontSize={11} fill="#94a3b8">
                not installed
              </text>
            </g>
          )}
          <g>
            <circle cx={866} cy={152} r={88} fill="#eef3f9" stroke="#8494a7" strokeWidth={2} />
            <circle cx={866} cy={152} r={80} fill="#dfe7f0" stroke="#b6c2d1" strokeWidth={1} />
            <g
              style={{
                transformOrigin: "866px 152px",
                animation: running && spinDur ? `spin ${spinDur}s linear infinite` : undefined,
              }}
            >
              {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <path
                  key={i}
                  d="M 10 -14 Q 42 -44 72 -27 Q 52 -2 13 6 Z"
                  fill="url(#sch-metal)"
                  stroke="#64748b"
                  strokeWidth={1}
                  transform={`translate(866 152) rotate(${i * 40})`}
                />
              ))}
              <circle cx={866} cy={152} r={16} fill="url(#sch-metal)" stroke="#64748b" strokeWidth={1.4} />
              <circle cx={866} cy={152} r={5} fill="#475569" />
            </g>
            <rect x={952} y={112} width={56} height={80} rx={6} fill="url(#sch-casing)" stroke="#8494a7" strokeWidth={1.4} />
            <rect x={944} y={204} width={62} height={34} rx={7} fill="url(#sch-metal)" stroke="#64748b" strokeWidth={1.2} />
            {[0, 1, 2, 3].map((i) => (
              <line key={i} x1={952 + i * 14} y1={208} x2={952 + i * 14} y2={234} stroke="#64748b" strokeWidth={1.4} opacity={0.6} />
            ))}
          </g>
          <g className={cx(!running && "flow-line-paused")} style={{ pointerEvents: "none" }}>
            <path d="M 30 156 L 742 156" fill="none" stroke="#38bdf8" strokeWidth={3} className="flow-line" style={{ strokeDasharray: "14 12", animationDuration: `${flowDur}s`, opacity: running ? 0.85 : undefined }} />
            {[198, 358, 578, 738].map((x) => (
              <path key={x} d={`M ${x - 7} 148 L ${x + 5} 156 L ${x - 7} 164 Z`} fill="#38bdf8" opacity={running ? 0.9 : 0.3} />
            ))}
            <path d="M 986 152 L 1024 152" fill="none" stroke="#38bdf8" strokeWidth={3.4} className="flow-line" style={{ strokeDasharray: "12 10", animationDuration: `${(flowDur * 0.6).toFixed(2)}s` }} />
            <path d="M 1016 144 L 1032 152 L 1016 160 Z" fill="#38bdf8" opacity={running ? 0.95 : 0.3} />
          </g>
          {stages.map((s) => {
            const a = AREAS[s.key as string];
            if (!a) return null;
            const c = TONE[s.state];
            const isSel = selected === s.key;
            return (
              <g key={s.key}>
                <rect x={a.x} y={a.y} width={a.w} height={a.h} rx={9} fill={c.stroke} opacity={s.state === "ok" ? 0.04 : 0.1} className={cx(s.state === "alarm" && "animate-blink")} style={{ pointerEvents: "none" }} />
                <rect
                  x={a.x}
                  y={a.y}
                  width={a.w}
                  height={a.h}
                  rx={9}
                  fill="none"
                  stroke={isSel ? "#2563eb" : c.stroke}
                  strokeWidth={isSel ? 3 : 2}
                  opacity={isSel ? 1 : s.state === "alarm" ? 0.85 : 0.35}
                  className={cx(s.state === "alarm" && "animate-blink")}
                  style={{ pointerEvents: "none", transition: "opacity 140ms ease" }}
                />
                <rect
                  x={a.x}
                  y={a.y}
                  width={a.w}
                  height={a.h}
                  rx={9}
                  fill="transparent"
                  style={{ cursor: "pointer" }}
                  onClick={() => onSelect(isSel ? null : (s.key as string))}
                >
                  <title>{`${s.label} — ${s.sub}`}</title>
                </rect>
                <text x={a.x + a.w / 2} y={306} textAnchor="middle" fontSize={11} fontWeight={700} fill="#475569">
                  {s.label}
                </text>
                <text x={a.x + a.w / 2} y={322} textAnchor="middle" fontSize={10.5} fill={c.stroke} fontWeight={600} fontFamily="ui-monospace, monospace">
                  {s.sub}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="mt-2.5 text-[10px] leading-relaxed text-slate-500">
        Engineering cross-section: louver angle, impeller rotation, heater glow and condensate level follow live
        telemetry; click a section for its limits, delay, priority and data quality. Direct low-level actuator control
        of the coil / heater / damper is out of scope (constraint 3).
      </p>
    </div>
  );
}