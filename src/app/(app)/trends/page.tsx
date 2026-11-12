"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  Clock,
  Compass,
  Eye,
  Filter,
  Info,
  LayoutGrid,
  Layers,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { api, fmtDateTime, LOCAL_POLL_MS, timeAgo, usePoll } from "@/lib/client";
import { PARAM_MAP, type ParamKey } from "@/lib/domain";
import { Btn, Empty, ErrorNote, Spinner, cx } from "@/components/ui";

interface Analysis {
  parameter: ParamKey;
  label: string;
  unit: string;
  limitType: "HIGH" | "LOW" | null;
  limit: number | null;
  direction: "RISING" | "FALLING" | "FLAT";
  sampleCount: number;
  spanMin: number;
  sufficient: boolean;
  isReliable: boolean;
  unreliabilityReason: string | null;
  slopePerMin: number;
  r2: number;
  residualStd: number;
  currentValue: number | null;
  projectedValue: number | null;
  minutesToBreach: number | null;
  horizon: 15 | 30 | null;
  series?: { t: number; v: number }[];
  projection?: { t: number; v: number }[];
}

interface TrendRow {
  id: string;
  ahuId: string;
  parameter: string;
  estimatedMin: number;
  direction: string;
  isReliable: boolean;
  unreliabilityReason: string | null;
  sampleCount: number;
  slopePerMin: number | null;
  currentValue: number | null;
  projectedValue: number | null;
  thresholdValue: number | null;
  minutesToBreach: number | null;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  createdAt: string;
}

/** Formats ETA to limit breach realistically so 100,000+ min numbers don't look broken. */
function formatEtaBreach(min: number | null, horizon: 15 | 30 | null) {
  if (min === null || min <= 0) {
    return {
      label: "Safe · Steady trajectory",
      sub: "No breach projected",
      badgeCls: "bg-emerald-50 text-emerald-700 border-emerald-200/90",
      isImminent: false,
    };
  }
  if (horizon === 15) {
    return {
      label: `${min.toFixed(1)} min`,
      sub: "Critical horizon (≤ 15m)",
      badgeCls: "bg-rose-50 text-rose-700 border-rose-300 font-bold animate-pulse ring-1 ring-rose-300/40",
      isImminent: true,
    };
  }
  if (horizon === 30) {
    return {
      label: `${min.toFixed(1)} min`,
      sub: "Warning horizon (≤ 30m)",
      badgeCls: "bg-amber-50 text-amber-700 border-amber-300 font-bold ring-1 ring-amber-300/40",
      isImminent: true,
    };
  }
  if (min <= 60) {
    return {
      label: `~${Math.round(min)} min`,
      sub: "Under 1 hr margin",
      badgeCls: "bg-amber-50/70 text-amber-800 border-amber-200",
      isImminent: false,
    };
  }
  if (min <= 1440) {
    const hrs = (min / 60).toFixed(1);
    return {
      label: `~${hrs} hrs`,
      sub: "Adequate lead time",
      badgeCls: "bg-slate-100 text-slate-700 border-slate-200",
      isImminent: false,
    };
  }
  return {
    label: "> 24h",
    sub: "Stable trajectory",
    badgeCls: "bg-emerald-50 text-emerald-700 border-emerald-200/90 font-medium",
    isImminent: false,
  };
}

/** Resolves device kind badge & label based on unit ID naming convention. */
function getDeviceKind(id: string) {
  const upper = id.toUpperCase();
  if (upper.includes("DAK")) return { label: "Ceiling Cassette", color: "text-sky-700 bg-sky-50 border-sky-200" };
  if (upper.includes("SPLIT") || upper.includes("WALL"))
    return { label: "Split Wall", color: "text-indigo-700 bg-indigo-50 border-indigo-200" };
  if (upper.includes("STD") || upper.includes("STAND"))
    return { label: "Standing AC", color: "text-purple-700 bg-purple-50 border-purple-200" };
  return { label: "Air Handling Unit", color: "text-blue-700 bg-blue-50 border-blue-200" };
}

/** Sleek pure SVG sparkline showing historical trend curve, gradient area, and threshold line. */
function TrendSparkline({
  series,
  limit,
  unit,
  direction,
  horizon,
}: {
  series?: { t: number; v: number }[];
  limit: number | null;
  unit: string;
  direction: "RISING" | "FALLING" | "FLAT";
  horizon: 15 | 30 | null;
}) {
  if (!series || series.length < 2) {
    return (
      <div className="flex h-[52px] w-full items-center justify-center rounded-xl bg-slate-50/70 border border-slate-100 text-[10px] text-slate-400">
        Accumulating statistical samples…
      </div>
    );
  }

  const values = series.map((s) => s.v);
  const minVal = Math.min(...values, limit ?? Infinity);
  const maxVal = Math.max(...values, limit ?? -Infinity);
  const span = Math.max(0.4, maxVal - minVal);
  const pad = span * 0.15;
  const yMin = minVal - pad;
  const yMax = maxVal + pad;

  const w = 300;
  const h = 52;
  const tMin = series[0].t;
  const tMax = series[series.length - 1].t;
  const tSpan = Math.max(1, tMax - tMin);

  const getX = (t: number) => ((t - tMin) / tSpan) * (w - 24) + 12;
  const getY = (v: number) => h - ((v - yMin) / (yMax - yMin)) * (h - 16) - 8;

  const points = series.map((s) => `${getX(s.t).toFixed(1)},${getY(s.v).toFixed(1)}`).join(" ");
  const firstX = getX(series[0].t).toFixed(1);
  const lastX = getX(series[series.length - 1].t).toFixed(1);
  const areaPoints = `${firstX},${h} ${points} ${lastX},${h}`;

  const limitY = limit !== null ? getY(limit) : null;
  const strokeColor =
    horizon === 15 ? "#ef4444" : horizon === 30 ? "#f59e0b" : direction === "RISING" ? "#f97316" : "#0284c7";
  const gradId = `spark-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <div className="relative h-[52px] w-full overflow-hidden rounded-xl bg-slate-50/80 border border-slate-100 p-1">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full overflow-visible" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.2" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Safety limit threshold dashed line */}
        {limitY !== null && limitY >= 0 && limitY <= h ? (
          <g>
            <line
              x1="0"
              y1={limitY}
              x2={w}
              y2={limitY}
              stroke="#f43f5e"
              strokeWidth="1.2"
              strokeDasharray="3 3"
              opacity="0.8"
            />
            <text x={w - 6} y={Math.max(10, limitY - 3)} fill="#e11d48" fontSize="8" fontWeight="700" textAnchor="end">
              Limit {limit}
              {unit}
            </text>
          </g>
        ) : null}

        {/* Shaded Area */}
        <polygon points={areaPoints} fill={`url(#${gradId})`} />

        {/* Trend Polyline */}
        <polyline
          fill="none"
          stroke={strokeColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />

        {/* Latest Reading Dot */}
        {series.length > 0 ? (
          <circle
            cx={getX(series[series.length - 1].t)}
            cy={getY(series[series.length - 1].v)}
            r="3.5"
            fill={strokeColor}
            stroke="#ffffff"
            strokeWidth="1.5"
          />
        ) : null}
      </svg>
    </div>
  );
}

export default function TrendsPage() {
  const { data, error, loading, reload, paused, setPaused } = usePoll<{
    analyses: Record<string, Analysis[]>;
    history: TrendRow[];
  }>("/api/trends", LOCAL_POLL_MS * 2);

  const { data: fleetData } = usePoll<{ ahus: Array<{ id: string; name: string; location: string }> }>("/api/ahu", 60000);
  const { data: session } = usePoll<{ user: { role: string } | null }>("/api/auth/session", 60000);
  const canAck = session?.user ? ["Admin", "Engineering", "Operator"].includes(session.user.role) : false;

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "BREACHES" | "STABLE">("ALL");
  const [viewMode, setViewMode] = useState<"grid" | "grouped" | "history">("grid");
  const [showInfoBanner, setShowInfoBanner] = useState(false);

  const ahuMap = useMemo(() => {
    const map = new Map<string, { name: string; location: string }>();
    for (const a of fleetData?.ahus ?? []) {
      map.set(a.id, { name: a.name, location: a.location });
    }
    return map;
  }, [fleetData]);

  async function ack(id: string) {
    setBusy(id);
    try {
      await api("/api/trends", { method: "POST", body: JSON.stringify({ trendId: id }) });
      setNotice("Trend warning acknowledged and recorded in audit trail (FR-18).");
      await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Acknowledge failed");
    } finally {
      setBusy(null);
    }
  }

  const rawEntries = Object.entries(data?.analyses ?? {});

  // Flattened channel list for the responsive grid (fills 100% of the room)
  const allChannels = useMemo(() => {
    const list: Array<{
      ahuId: string;
      deviceInfo?: { name: string; location: string };
      analysis: Analysis;
    }> = [];
    for (const [ahuId, analyses] of rawEntries) {
      const dev = ahuMap.get(ahuId);
      for (const a of analyses) {
        list.push({ ahuId, deviceInfo: dev, analysis: a });
      }
    }
    return list;
  }, [rawEntries, ahuMap]);

  // Filter channels according to search query and breach status
  const filteredChannels = useMemo(() => {
    return allChannels.filter(({ ahuId, analysis }) => {
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        ahuId.toLowerCase().includes(q) ||
        analysis.label.toLowerCase().includes(q) ||
        analysis.parameter.toLowerCase().includes(q);

      if (!matchesSearch) return false;

      if (statusFilter === "BREACHES") return Boolean(analysis.horizon);
      if (statusFilter === "STABLE") return !analysis.horizon;
      return true;
    });
  }, [allChannels, search, statusFilter]);

  // Aggregate KPI summary metrics
  const totalChannels = allChannels.length;
  const imminentBreaches = allChannels.filter((c) => Boolean(c.analysis.horizon)).length;
  const stableChannels = allChannels.filter((c) => !c.analysis.horizon).length;
  const reliableChannels = allChannels.filter((c) => c.analysis.isReliable).length;
  const reliabilityPct = totalChannels > 0 ? Math.round((reliableChannels / totalChannels) * 100) : 100;

  return (
    <div className="space-y-5">
      {/* ── Page Header ── */}
      <div className="flex flex-wrap items-end justify-between gap-3 pb-1">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Smart Detection · Trend Center
            </h1>
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50/80 px-2 py-0.5 text-[10px] font-bold text-blue-700">
              <Sparkles size={11} /> FR-16 AI Model
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Real-time linear proximity estimation (FR-16), statistical regression quality (FR-17), and warning audit (FR-18)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowInfoBanner((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition"
          >
            <Info size={14} className="text-slate-500" />
            {showInfoBanner ? "Hide Methodology" : "Methodology"}
          </button>

          <Btn
            variant={paused ? "danger" : "default"}
            onClick={() => setPaused(!paused)}
            className="shadow-2xs text-xs"
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
            {paused ? "Resume Live" : "Pause Polling"}
          </Btn>
        </div>
      </div>

      {/* ── Optional Methodology / FR-16 Disclaimer Card ── */}
      {showInfoBanner ? (
        <div className="relative rounded-2xl border border-violet-200/90 bg-linear-to-r from-violet-50/95 via-purple-50/80 to-sky-50/95 p-4 text-[12px] leading-relaxed text-violet-950 shadow-xs">
          <button
            type="button"
            onClick={() => setShowInfoBanner(false)}
            aria-label="Close banner"
            className="absolute top-3 right-3 text-violet-400 hover:text-violet-700"
          >
            <X size={15} />
          </button>
          <strong className="inline-flex items-center gap-1.5 font-bold uppercase tracking-wider text-violet-900 text-[11px]">
            <Activity size={14} className="text-violet-700" /> Statistical Proximity Projection Framework
          </strong>
          <p className="mt-1.5 text-violet-900/90">
            This module performs a continuous ordinary least squares (OLS) linear projection of telemetry samples over a
            sliding window. It calculates proximity to lower and upper thresholds at 15-minute and 30-minute horizons.
            Per standard cleanroom instrumentation guidelines, this provides early operational lead-time and is explicitly{" "}
            <strong>not</strong> a physical failure diagnosis. Every projection includes sample sufficiency and R² correlation tests.
          </p>
        </div>
      ) : null}

      {/* ── Fleet KPI Summary Strip (Fills horizontal space prominently) ── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {/* KPI 1 */}
        <div className="group rounded-2xl border border-slate-200/90 bg-white/95 p-4 shadow-2xs backdrop-blur-md transition hover:shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-bold text-slate-500 uppercase tracking-wider">Tracked Channels</span>
            <span className="grid h-8 w-8 place-items-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600">
              <Activity size={16} />
            </span>
          </div>
          <p className="mt-2 font-mono text-2xl font-black tracking-tight text-slate-900">{totalChannels}</p>
          <p className="mt-1 text-[11px] text-slate-500">Live linear regression channels</p>
        </div>

        {/* KPI 2 */}
        <div className={cx(
          "group rounded-2xl border p-4 shadow-2xs backdrop-blur-md transition hover:shadow-xs",
          imminentBreaches > 0 ? "border-rose-300 bg-rose-50/60" : "border-slate-200/90 bg-white/95"
        )}>
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-bold text-slate-500 uppercase tracking-wider">Imminent Breaches</span>
            <span className={cx(
              "grid h-8 w-8 place-items-center rounded-xl border",
              imminentBreaches > 0 ? "border-rose-200 bg-rose-100 text-rose-600" : "border-slate-100 bg-slate-50 text-slate-400"
            )}>
              <AlertTriangle size={16} />
            </span>
          </div>
          <p className={cx("mt-2 font-mono text-2xl font-black tracking-tight", imminentBreaches > 0 ? "text-rose-700 animate-pulse" : "text-slate-900")}>
            {imminentBreaches}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Projected breach within ≤ 30 min</p>
        </div>

        {/* KPI 3 */}
        <div className="group rounded-2xl border border-slate-200/90 bg-white/95 p-4 shadow-2xs backdrop-blur-md transition hover:shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-bold text-slate-500 uppercase tracking-wider">Stable Trajectories</span>
            <span className="grid h-8 w-8 place-items-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600">
              <Check size={16} />
            </span>
          </div>
          <p className="mt-2 font-mono text-2xl font-black tracking-tight text-slate-900">{stableChannels}</p>
          <p className="mt-1 text-[11px] text-slate-500">Safe lead time (&gt; 24h margin)</p>
        </div>

        {/* KPI 4 */}
        <div className="group rounded-2xl border border-slate-200/90 bg-white/95 p-4 shadow-2xs backdrop-blur-md transition hover:shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-bold text-slate-500 uppercase tracking-wider">Statistical Quality</span>
            <span className="grid h-8 w-8 place-items-center rounded-xl border border-violet-100 bg-violet-50 text-violet-600">
              <ShieldCheck size={16} />
            </span>
          </div>
          <p className="mt-2 font-mono text-2xl font-black tracking-tight text-slate-900">{reliabilityPct}%</p>
          <p className="mt-1 text-[11px] text-slate-500">{reliableChannels}/{totalChannels} models meet R² &ge; 0.35</p>
        </div>
      </div>

      {/* ── Search, Status Filter & Layout Toggle Toolbar ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200/90 bg-white/95 p-3.5 shadow-2xs backdrop-blur-md">
        {/* Search Input */}
        <div className="relative min-w-[240px] flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by device ID, parameter name, or location…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-2 pl-9 pr-8 text-xs font-medium text-slate-800 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setStatusFilter("ALL")}
            className={cx(
              "rounded-xl px-3 py-1.5 text-xs font-bold transition",
              statusFilter === "ALL"
                ? "bg-slate-900 text-white shadow-2xs"
                : "bg-slate-100/90 text-slate-600 hover:bg-slate-200/80"
            )}
          >
            All Channels ({totalChannels})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("BREACHES")}
            className={cx(
              "rounded-xl px-3 py-1.5 text-xs font-bold transition",
              statusFilter === "BREACHES"
                ? "bg-rose-600 text-white shadow-2xs"
                : "bg-rose-50 text-rose-700 hover:bg-rose-100"
            )}
          >
            Breaches Only ({imminentBreaches})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("STABLE")}
            className={cx(
              "rounded-xl px-3 py-1.5 text-xs font-bold transition",
              statusFilter === "STABLE"
                ? "bg-emerald-600 text-white shadow-2xs"
                : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            )}
          >
            Stable ({stableChannels})
          </button>
        </div>

        {/* View Mode Switcher */}
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1">
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            title="Unified Responsive Grid"
            className={cx(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition",
              viewMode === "grid" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-500 hover:text-slate-900"
            )}
          >
            <LayoutGrid size={13} />
            <span className="hidden sm:inline">Grid</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode("grouped")}
            title="Grouped by Device"
            className={cx(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition",
              viewMode === "grouped" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-500 hover:text-slate-900"
            )}
          >
            <Layers size={13} />
            <span className="hidden sm:inline">By Unit</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode("history")}
            title="Historical Warning Log"
            className={cx(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition",
              viewMode === "history" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-500 hover:text-slate-900"
            )}
          >
            <Clock size={13} />
            <span className="hidden sm:inline">Log</span>
          </button>
        </div>
      </div>

      {notice ? (
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900 shadow-2xs">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-emerald-600 hover:text-emerald-800">
            <X size={14} />
          </button>
        </div>
      ) : null}

      <ErrorNote message={error} />

      {/* ── Loading Skeleton ── */}
      {loading && !data ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 animate-pulse">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-64 rounded-2xl border border-slate-200/90 bg-white/95 p-4 shadow-sm backdrop-blur-md">
              <div className="flex justify-between">
                <div className="h-5 w-24 rounded bg-slate-200/80" />
                <div className="h-5 w-20 rounded bg-slate-200/60" />
              </div>
              <div className="mt-4 h-12 w-full rounded-xl bg-slate-100" />
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="h-10 rounded-lg bg-slate-50" />
                <div className="h-10 rounded-lg bg-slate-50" />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* ── Mode 1: Unified Responsive Grid (Default — Fills 100% of the Room with No Blank Whitespace) ── */}
      {viewMode === "grid" ? (
        filteredChannels.length === 0 ? (
          <div className="rounded-2xl border border-slate-200/90 bg-white/95 p-12 text-center shadow-sm">
            <Empty icon={<Check size={28} className="text-emerald-500" />}>
              No telemetry channels match your current search or filter criteria.
            </Empty>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4">
            {filteredChannels.map(({ ahuId, deviceInfo, analysis: a }) => {
              const eta = formatEtaBreach(a.minutesToBreach, a.horizon);
              const devKind = getDeviceKind(ahuId);

              return (
                <div
                  key={`${ahuId}-${a.parameter}`}
                  className={cx(
                    "group relative flex flex-col justify-between overflow-hidden rounded-2xl border bg-white/95 p-4 shadow-2xs backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
                    a.horizon === 15
                      ? "border-rose-300 ring-1 ring-rose-200 bg-linear-to-b from-rose-50/40 to-white"
                      : a.horizon === 30
                        ? "border-amber-300 ring-1 ring-amber-200 bg-linear-to-b from-amber-50/30 to-white"
                        : "border-slate-200/90 hover:border-blue-300"
                  )}
                >
                  {/* Top Line: Device ID + Type Badge */}
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Link
                          href={`/devices/${ahuId}`}
                          className="font-mono text-[13px] font-black tracking-tight text-blue-600 hover:text-blue-800 hover:underline truncate"
                        >
                          {ahuId}
                        </Link>
                        <span className={cx("rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase", devKind.color)}>
                          {devKind.label}
                        </span>
                      </div>

                      {/* Direction Tag */}
                      {a.direction === "RISING" ? (
                        <span className="inline-flex items-center gap-0.5 rounded-md border border-orange-200 bg-orange-50 px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase text-orange-700">
                          <TrendingUp size={11} /> Rising
                        </span>
                      ) : a.direction === "FALLING" ? (
                        <span className="inline-flex items-center gap-0.5 rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase text-sky-700">
                          <TrendingDown size={11} /> Falling
                        </span>
                      ) : (
                        <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase text-slate-500">
                          Flat
                        </span>
                      )}
                    </div>

                    {/* Parameter Title + Location */}
                    <div className="mt-2">
                      <div className="flex items-baseline justify-between gap-1">
                        <h3 className="text-sm font-bold text-slate-900 leading-snug">{a.label}</h3>
                        <span className="font-mono text-[10px] text-slate-400 truncate">
                          {PARAM_MAP[a.parameter]?.localLabel.toLowerCase()}
                        </span>
                      </div>
                      {deviceInfo?.location ? (
                        <p className="mt-0.5 text-[10.5px] text-slate-400 truncate">{deviceInfo.location}</p>
                      ) : null}
                    </div>

                    {/* Live SVG Sparkline Chart */}
                    <div className="mt-3">
                      <TrendSparkline
                        series={a.series}
                        limit={a.limit}
                        unit={a.unit}
                        direction={a.direction}
                        horizon={a.horizon}
                      />
                    </div>

                    {/* 4-Cell Telemetry Metric Grid */}
                    <div className="mt-3 grid grid-cols-2 gap-1.5">
                      {/* Current Value */}
                      <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-2">
                        <span className="block text-[9.5px] font-bold uppercase tracking-wider text-slate-400">Current</span>
                        <span className="font-mono text-sm font-black text-slate-900 leading-tight">
                          {a.currentValue === null ? "—" : `${a.currentValue} ${a.unit}`}
                        </span>
                      </div>

                      {/* Safety Limit */}
                      <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-2">
                        <span className="block text-[9.5px] font-bold uppercase tracking-wider text-slate-400">
                          Limit ({a.limitType ?? "BOUND"})
                        </span>
                        <span className="font-mono text-sm font-black text-slate-900 leading-tight">
                          {a.limit === null ? "—" : `${a.limit} ${a.unit}`}
                        </span>
                      </div>

                      {/* Slope Rate */}
                      <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-2">
                        <span className="block text-[9.5px] font-bold uppercase tracking-wider text-slate-400">Slope / min</span>
                        <span className="font-mono text-[11.5px] font-bold text-slate-700 leading-tight">
                          {a.slopePerMin >= 0 ? `+${a.slopePerMin.toFixed(3)}` : a.slopePerMin.toFixed(3)} {a.unit}
                        </span>
                      </div>

                      {/* ETA Breach */}
                      <div className={cx("rounded-xl border p-2", eta.badgeCls)}>
                        <span className="block text-[9.5px] font-bold uppercase tracking-wider opacity-80">ETA Breach</span>
                        <span className="font-mono text-[11.5px] font-black leading-tight block truncate">
                          {eta.label}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Statistical Confidence Footer */}
                  <div className="mt-3 border-t border-slate-100 pt-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-1 text-[9.5px]">
                      <span className={cx(
                        "rounded-md border px-1.5 py-0.5 font-mono uppercase font-bold",
                        a.sufficient ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"
                      )}>
                        {a.sampleCount}/8 samples · {a.spanMin}m
                      </span>
                      <span className={cx(
                        "rounded-md border px-1.5 py-0.5 font-mono uppercase font-bold",
                        a.isReliable ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"
                      )}>
                        R² {a.r2.toFixed(2)} · {a.isReliable ? "Reliable" : "Unreliable"}
                      </span>
                    </div>

                    {a.unreliabilityReason ? (
                      <p className="mt-2 flex items-start gap-1 text-[10px] text-amber-700 font-medium leading-tight">
                        <AlertTriangle size={12} className="shrink-0 mt-0.5 text-amber-500" />
                        <span>{a.unreliabilityReason}</span>
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : null}

      {/* ── Mode 2: Grouped by Device (Multi-Column Unit Containers) ── */}
      {viewMode === "grouped" ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
          {rawEntries.map(([ahuId, analyses]) => {
            const shown = analyses.filter((a) => (statusFilter === "BREACHES" ? Boolean(a.horizon) : true));
            if (shown.length === 0 && statusFilter === "BREACHES") return null;
            const devInfo = ahuMap.get(ahuId);
            const devKind = getDeviceKind(ahuId);

            return (
              <div
                key={ahuId}
                className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white/95 p-5 shadow-2xs backdrop-blur-md"
              >
                <div>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/devices/${ahuId}`}
                          className="font-mono text-base font-black text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {ahuId}
                        </Link>
                        <span className={cx("rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase", devKind.color)}>
                          {devKind.label}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">{devInfo?.location || devInfo?.name || "Cleanroom Facility"}</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600">
                      {analyses.length} channel{analyses.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="mt-3.5 space-y-3">
                    {analyses.map((a) => {
                      const eta = formatEtaBreach(a.minutesToBreach, a.horizon);
                      return (
                        <div
                          key={a.parameter}
                          className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 hover:bg-slate-50 transition"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-800">{a.label}</span>
                            <span className={cx("rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold", eta.badgeCls)}>
                              {eta.label}
                            </span>
                          </div>
                          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                            <div className="rounded-lg bg-white p-1.5 border border-slate-200/60">
                              <span className="block text-[9px] uppercase font-bold text-slate-400">Current</span>
                              <span className="font-mono font-bold text-slate-800">{a.currentValue ?? "—"} {a.unit}</span>
                            </div>
                            <div className="rounded-lg bg-white p-1.5 border border-slate-200/60">
                              <span className="block text-[9px] uppercase font-bold text-slate-400">Limit</span>
                              <span className="font-mono font-bold text-slate-800">{a.limit ?? "—"} {a.unit}</span>
                            </div>
                            <div className="rounded-lg bg-white p-1.5 border border-slate-200/60">
                              <span className="block text-[9px] uppercase font-bold text-slate-400">Slope</span>
                              <span className="font-mono font-bold text-slate-800">{a.slopePerMin.toFixed(3)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-4 border-t border-slate-100 pt-3 text-right">
                  <Link
                    href={`/devices/${ahuId}`}
                    className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800"
                  >
                    Open Device SCADA <ArrowUpRight size={13} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* ── Mode 3 / Persistent History: Trend Warning Audit Trail (FR-18) ── */}
      <div className={cx(viewMode === "history" ? "block" : "block pt-2")}>
        <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 shadow-2xs backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 px-5 py-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                Historical Proximity Warning Trail (FR-18)
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Immutable audit log of all generated statistical breach warnings broadcast to operators
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs font-bold text-slate-600">
              {(data?.history ?? []).length} Recorded Warnings
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-xs">
              <thead className="border-b border-slate-200/80 bg-slate-50/80 text-[10.5px] uppercase tracking-wider text-slate-500 font-bold">
                <tr>
                  <th className="px-4 py-3">Logged</th>
                  <th className="px-4 py-3">Unit</th>
                  <th className="px-4 py-3">Parameter</th>
                  <th className="px-4 py-3">Direction</th>
                  <th className="px-4 py-3">Horizon</th>
                  <th className="px-4 py-3">ETA Breach</th>
                  <th className="px-4 py-3">Trajectory (Limit)</th>
                  <th className="px-4 py-3">Model Quality</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {(data?.history ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center">
                      <Empty icon={<Check size={24} className="text-emerald-500" />}>
                        No proximity warnings recorded yet. The system is operating with optimal margins.
                      </Empty>
                    </td>
                  </tr>
                ) : null}

                {(data?.history ?? []).map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/60 transition">
                    <td className="px-4 py-3 font-mono text-[11.5px] text-slate-500" title={fmtDateTime(t.createdAt)}>
                      {timeAgo(t.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-blue-600">
                      <Link href={`/devices/${t.ahuId}`} className="hover:underline">
                        {t.ahuId}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">{t.parameter}</td>
                    <td className="px-4 py-3 font-mono text-[11px] font-bold">
                      {t.direction === "RISING" ? (
                        <span className="text-orange-600">↑ RISING</span>
                      ) : t.direction === "FALLING" ? (
                        <span className="text-sky-600">↓ FALLING</span>
                      ) : (
                        <span className="text-slate-500">→ FLAT</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-violet-700">≤ {t.estimatedMin} min</td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-900">
                      {t.minutesToBreach === null ? "—" : `${t.minutesToBreach.toFixed(1)} min`}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-600">
                      {t.currentValue ?? "—"} → {t.projectedValue ?? "—"}{" "}
                      <span className="text-rose-600 font-bold">(limit {t.thresholdValue ?? "—"})</span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cx(
                          "rounded-md border px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase",
                          t.isReliable
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-rose-200 bg-rose-50 text-rose-700"
                        )}
                      >
                        {t.isReliable ? "Reliable" : "Unreliable"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[11px]">
                      {t.acknowledged ? (
                        <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                          <CheckCheck size={13} /> Ack
                        </span>
                      ) : (
                        <span className="font-bold text-amber-600">Active</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!t.acknowledged ? (
                        <Btn
                          variant="primary"
                          onClick={() => void ack(t.id)}
                          disabled={busy === t.id || !canAck}
                          className="h-7 px-2.5 text-[11px]"
                        >
                          <Check size={12} /> Acknowledge
                        </Btn>
                      ) : (
                        <span className="font-mono text-[11px] text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
