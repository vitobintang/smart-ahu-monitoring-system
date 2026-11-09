"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import { Boxes, ImageIcon, Info, X } from "lucide-react";

const NextImage =
  typeof Image === "function"
    ? Image
    : ((Image as unknown as { default: typeof Image }).default ?? Image);
import type { AhuStatus, DataSource } from "@/db/schema";
import { classifyQuality, type DataQuality } from "@/lib/domain";
import { cx, QualityTag, Segmented, StatusBadge } from "@/components/ui";
import { TONE, type Stage, type StageDef } from "./schematic-meta";
import SchematicBranch from "./SchematicBranch";

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

const GEO: Record<string, { x: number; y: number; w: number; h: number; mx: number; my: number; cx?: number; cy?: number; r?: number }> = {
  damperPosition: { x: 88, y: 224, w: 236, h: 456, mx: 12.9, my: 23.5 },
  filterDiffPressure: { x: 384, y: 228, w: 232, h: 448, mx: 31.3, my: 23.5 },
  coilTemp: { x: 672, y: 232, w: 256, h: 420, mx: 50, my: 23.5 },
  heaterOutput: { x: 968, y: 228, w: 248, h: 448, mx: 68.3, my: 23.5 },
  fanSpeed: { x: 1273, y: 318, w: 264, h: 264, cx: 1405, cy: 450, r: 130, mx: 87.8, my: 29.5 },
};

const AIR_PATH_WITH_HEATER =
  "M 16 450 L 948 450 " +
  "C 976 450 970 272 998 272 " +
  "L 1188 272 " +
  "C 1222 272 1222 450 1188 450 " +
  "L 998 450 " +
  "C 964 450 964 596 998 596 " +
  "L 1188 596 " +
  "C 1256 596 1268 450 1340 450 L 1425 450";

const AIR_PATH_NO_HEATER = "M 16 450 L 1425 450";

/**
 * Chilled-water serpentine aligned with the horizontal copper tubes and side
 * U-bend elbows in `public/ahu/side-elevation.jpg` (1600×900 viewBox), staying
 * above the stainless condensate drain pan.
 */
const WATER_PATH =
  "M 884 646 L 884 616 C 884 606 876 606 866 606 L 694 606 " +
  "C 672 606 672 569 694 569 L 904 569 " +
  "C 926 569 926 530 904 530 L 694 530 " +
  "C 672 530 672 491 694 491 L 904 491 " +
  "C 926 491 926 448 904 448 L 694 448 " +
  "C 672 448 672 406 694 406 L 904 406 " +
  "C 926 406 926 366 904 366 L 694 366 " +
  "C 672 366 672 327 694 327 L 904 327 " +
  "C 926 327 926 287 904 287 L 694 287 " +
  "C 672 287 672 248 694 248 L 902 248";

const FLOW_PATHS = { discharge: "M 1534 450 L 1592 450" } as const;
const FLOW_STOPS = { coilIn: 672, coilOut: 956, heaterOut: 1236, end: 1425 } as const;

const ASSESS: Record<Stage, string> = {
  ok: "Operating within configured limits.",
  warn: "Approaching a configured limit — watch the trend projection.",
  alarm: "Limit exceeded or controller fault — active alarm condition.",
  off: "Component idle: unit is not running or the sensor is not transmitting.",
  missing: "Sensor UNINSTALLED on this AHU — no live data for this stage (NFR-06).",
};

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
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Keep effective fan speed steady while status === "RUN" even if a single telemetry sample omits fanSpeed
  const effectiveFanPct = running ? (fan !== null && fan > 0 ? fan : 75) : 0;
  const playbackRate = running ? Math.max(0.55, 0.55 + (effectiveFanPct / 100) * 1.45) : 1;
  const damperOpen = damper === null ? (running ? 70 : 0) : damper;
  const heaterActive = (heater ?? 0) > 3;

  // Adjust animation speed via Web Animations playbackRate instead of mutating CSS animationDuration,
  // so 5-second telemetry polls never reset or snap the keyframe phase.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof el.getAnimations !== "function") return;
    for (const anim of el.getAnimations({ subtree: true })) {
      const cssAnim = anim as Animation & { animationName?: string };
      if (cssAnim.animationName === "flowmove" || cssAnim.animationName === "spin") {
        if (Math.abs(anim.playbackRate - playbackRate) > 0.04) {
          if (typeof anim.updatePlaybackRate === "function") {
            anim.updatePlaybackRate(playbackRate);
          } else {
            anim.playbackRate = playbackRate;
          }
        }
      }
    }
  }, [playbackRate, model, running]);

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
    <div ref={rootRef} className="rounded-xl border border-ink-700/70 bg-ink-950/40 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{ahuId} · airflow path · FR-07</p>
          <p className="mt-0.5 text-[11.5px] text-slate-500">
            Intake damper → filter → cooling coil{hasHeater ? " → heating coil" : ""} → supply fan · supply air{" "}
            <span className="num text-brand-300">{supply === null ? "—" : `${supply.toFixed(1)} °C`}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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
        <div className="animate-fade overflow-x-auto pb-1">
          <div className="relative min-w-[540px] overflow-hidden rounded-xl border border-ink-700 bg-ink-950 ring-1 ring-inset ring-white/5 sm:min-w-0">
            <NextImage
              src="/ahu/side-elevation.jpg"
              alt="Flat orthographic side elevation of the air handling unit: intake damper, filter stage, cooling coil, heating coil and supply fan scroll"
              width={1600}
              height={900}
              className={cx(
                "h-auto w-full select-none object-cover transition-[filter] duration-500",
                offline && "brightness-[0.62] saturate-[0.35]",
              )}
              sizes="(max-width: 1024px) 100vw, 940px"
              loading="eager"
              fetchPriority="high"
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
                  d={hasHeater ? AIR_PATH_WITH_HEATER : AIR_PATH_NO_HEATER}
                  fill="none"
                  stroke={`url(#flowGrad-${heaterActive ? "heat" : "cool"})`}
                  strokeWidth={15}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={running ? 0.1 + 0.1 * (damperOpen / 100) : 0.05}
                />
                <path
                  d="M 6 441 L 18 450 L 6 459"
                  fill="none"
                  stroke="#9fb2c4"
                  strokeWidth={3}
                  opacity={running ? 0.4 + 0.6 * (damperOpen / 100) : 0.25}
                />
                <path
                  d={hasHeater ? AIR_PATH_WITH_HEATER : AIR_PATH_NO_HEATER}
                  fill="none"
                  stroke={`url(#flowGrad-${heaterActive ? "heat" : "cool"})`}
                  strokeWidth={4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="flow-line"
                  style={
                    {
                      "--flow-offset": "-256",
                      strokeDasharray: "18 14",
                      animationDuration: "3.2s",
                      opacity: running ? 0.55 + 0.45 * (damperOpen / 100) : undefined,
                      filter: "drop-shadow(0 0 6px rgba(103,232,249,0.55))",
                    } as CSSProperties
                  }
                />
                {coilState !== "missing" ? (
                  <path
                    d={WATER_PATH}
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="flow-line"
                    style={
                      {
                        "--flow-offset": "-160",
                        strokeDasharray: "9 11",
                        animationDuration: "5.6s",
                        opacity: running ? 0.85 : 0.32,
                        filter: "drop-shadow(0 0 4px rgba(56,189,248,0.45))",
                      } as CSSProperties
                    }
                  />
                ) : null}
                <path
                  d={FLOW_PATHS.discharge}
                  fill="none"
                  stroke="#67e8f9"
                  strokeWidth={4}
                  strokeLinecap="round"
                  className="flow-line"
                  style={
                    {
                      "--flow-offset": "-192",
                      strokeDasharray: "14 10",
                      animationDuration: "2.2s",
                    } as CSSProperties
                  }
                />
                <path d="M1580 434 L1599 450 L1580 466 Z" fill="#67e8f9" opacity={running ? 0.95 : 0.25} />
              </g>
              {fanState !== "missing" ? (
                <g style={{ pointerEvents: "none" }}>
                  <circle cx={1405} cy={450} r={128} fill="url(#boreGrad)" opacity={0.94} />
                  <g
                    style={{
                      transformOrigin: "1405px 450px",
                      animation: running ? "spin 1.15s linear infinite" : undefined,
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
                    na ? "border-dashed bg-[#0b1f3f]/80 text-[#cbd5e1]" : "bg-[#0b1f3f]/90 text-white",
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
            <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-white/15 bg-[#0b1f3f]/88 px-2 py-1 backdrop-blur-md">
              <p className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-[#93c5fd]">
                AI side-elevation model · live telemetry overlay
              </p>
            </div>
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-white/15 bg-[#0b1f3f]/88 px-2 py-1 backdrop-blur-md">
              <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#e2e8f0]">
                {running
                  ? `airflow → · fan ${effectiveFanPct.toFixed(0)} % · ${(playbackRate / 1.15).toFixed(1)} rev/s`
                  : "airflow stopped"}
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
