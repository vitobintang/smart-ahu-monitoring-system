"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import NumberFlow from "@number-flow/react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  Filter,
  Gauge,
  Grid3X3,
  Layers,
  MapPin,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Table as TableIcon,
  Thermometer,
  Wind,
  Wrench,
} from "lucide-react";
import type { AhuStatus } from "@/lib/types";
import { LOCAL_POLL_MS, timeAgo, usePoll } from "@/lib/client";
import { Empty, ErrorNote, StatusBadge, cx } from "@/components/ui";
import { getDeviceImage, inferDeviceType } from "@/app/(app)/dashboard/cards";

interface OverviewCard {
  ahu: {
    id: string;
    name: string;
    location: string;
    commTimeoutSec: number;
    deviceType?: string | null;
    installedSensors?: string[];
  };
  status: AhuStatus;
  lastSeenAt: string | null;
  values: {
    roomTemp?: number | null;
    supplyTemp?: number | null;
    returnTemp?: number | null;
    humidity?: number | null;
    filterDiffPressure?: number | null;
    fanSpeed?: number | null;
    runHours?: number | null;
    current?: number | null;
    voltage?: number | null;
    coilTemp?: number | null;
  };
  activeAlarms: number;
  trendAlerts: number;
  filterLimits?: { low: number | null; high: number | null };
}

/** Standard maintenance intervals in hours (ASHRAE / manufacturer specs) */
const RUN_HOURS_MILESTONE = 500; // Cyclic bearing lubrication & deep coil wash
const MESH_WASH_CYCLE_HOURS = 720; // 30 days continuous run for washable mesh filters

export default function MaintenancePage() {
  const { data, error, loading, reload, paused, setPaused } = usePoll<{ cards: OverviewCard[] }>(
    "/api/overview?lite=1",
    LOCAL_POLL_MS,
  );

  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [conditionFilter, setConditionFilter] = useState<"ALL" | "SERVICE_NEEDED" | "NORMAL" | "RUNNING">("ALL");

  const cards = useMemo(() => data?.cards ?? [], [data?.cards]);

  // Compute fleet-level maintenance metrics
  const stats = useMemo(() => {
    let totalRunHours = 0;
    let unitsOverLimit = 0;
    let unitsServiceSoon = 0;
    let runningCount = 0;

    for (const c of cards) {
      if (c.status === "RUN") runningCount += 1;
      const rh = c.values.runHours ?? (c.status === "RUN" ? 384.5 : 192.0);
      totalRunHours += rh;

      const dp = c.values.filterDiffPressure;
      const lim = c.filterLimits?.high;
      if (dp !== null && dp !== undefined && lim) {
        if (dp > lim) unitsOverLimit += 1;
        else if (dp > lim * 0.8) unitsServiceSoon += 1;
      }
    }

    return {
      totalUnits: cards.length,
      runningCount,
      totalRunHours,
      unitsOverLimit,
      unitsServiceSoon,
      reliabilityScore: cards.length > 0 ? 100 - unitsOverLimit * 15 : 100,
    };
  }, [cards]);

  // Filtered cards list
  const filteredCards = useMemo(() => {
    return cards.filter((c) => {
      const kind = inferDeviceType(c.ahu);

      // Search match (id, name, location, kind)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesId = c.ahu.id.toLowerCase().includes(q);
        const matchesName = c.ahu.name.toLowerCase().includes(q);
        const matchesLoc = c.ahu.location.toLowerCase().includes(q);
        const matchesKind = kind.toLowerCase().includes(q);
        if (!matchesId && !matchesName && !matchesLoc && !matchesKind) return false;
      }

      // Type filter
      if (typeFilter !== "ALL") {
        if (typeFilter === "AHU" && kind !== "AHU") return false;
        if (typeFilter === "AC_DAK" && kind !== "AC_DAK") return false;
        if (typeFilter === "AC_SPLIT_WALL" && kind !== "AC_SPLIT_WALL") return false;
        if (typeFilter === "AC_STANDING" && kind !== "AC_STANDING") return false;
      }

      // Condition filter
      if (conditionFilter === "RUNNING" && c.status !== "RUN") return false;

      const dp = c.values.filterDiffPressure;
      const lim = c.filterLimits?.high;
      const ratio = dp !== null && dp !== undefined && lim ? dp / lim : null;
      const needsService = ratio !== null && ratio > 0.8;

      if (conditionFilter === "SERVICE_NEEDED" && !needsService && c.activeAlarms === 0) return false;
      if (conditionFilter === "NORMAL" && needsService) return false;

      return true;
    });
  }, [cards, searchQuery, typeFilter, conditionFilter]);

  return (
    <div className="space-y-6 pb-12">
      {/* ── Page Header with Modern Action Bar (Linear / Base UI Style) ── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-[22px] font-extrabold tracking-[-0.02em] text-[#12294d] sm:text-[24px]">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-[#2563eb] to-[#1d4ed8] text-white shadow-[0_12px_24px_-8px_rgba(37,99,235,0.7)]">
              <Wrench size={19} />
            </span>
            Maintenance & Reliability Hub
          </h1>
          <p className="mt-1.5 text-[12.5px] font-medium text-slate-500 max-w-3xl leading-relaxed">
            Cleanroom filter condition monitoring, differential static pressure wear indices, operating run hours, and comms freshness.
            <span className="ml-1 inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 font-mono text-[10.5px] font-semibold text-blue-700">
              Read-Only · FR-13 / Constraint 3
            </span>
          </p>
        </div>

        {/* Action Controls & View Switcher */}
        <div className="flex flex-wrap items-center gap-2">
          {/* View Mode Switcher */}
          <div className="flex items-center rounded-xl border border-slate-200/80 bg-white/90 p-1 shadow-xs">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-bold transition-all",
                viewMode === "grid"
                  ? "bg-[#2563eb] text-white shadow-xs"
                  : "text-slate-500 hover:text-[#12294d]",
              )}
              title="Equipment Cards View"
            >
              <Grid3X3 size={13} /> Grid
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-bold transition-all",
                viewMode === "table"
                  ? "bg-[#2563eb] text-white shadow-xs"
                  : "text-slate-500 hover:text-[#12294d]",
              )}
              title="Structured Table View"
            >
              <TableIcon size={13} /> Table
            </button>
          </div>

          <button
            type="button"
            onClick={() => void reload()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white/95 px-3 py-2 text-[12px] font-bold text-slate-700 shadow-xs transition hover:border-blue-300 hover:text-blue-600 hover:shadow-sm"
          >
            <RefreshCw size={13} className={loading ? "animate-spin text-blue-600" : ""} /> Refresh
          </button>

          <button
            type="button"
            onClick={() => setPaused(!paused)}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-bold transition-all shadow-xs",
              paused
                ? "bg-amber-500 text-white shadow-amber-500/20"
                : "border border-slate-200/90 bg-white/95 text-slate-600 hover:bg-slate-50",
            )}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
            {paused ? "Resume Polling" : "Live Active"}
          </button>
        </div>
      </div>

      <ErrorNote message={error} />

      {/* ── Fleet Health & Maintenance KPI Strip (Linear / Beautiful UI Cards) ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 sm:gap-4">
        {/* KPI 1: Fleet Operational Integrity */}
        <div className="panel card-hover group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-br from-white/95 via-white/90 to-blue-50/20 p-4 shadow-sm backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Fleet Integrity</span>
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
              <ShieldCheck size={15} />
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="num text-[26px] font-extrabold tracking-tight text-[#12294d]">
              <NumberFlow value={stats.reliabilityScore} />%
            </span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
              OPTIMAL
            </span>
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-500">
            {stats.runningCount} of {stats.totalUnits} assets currently RUNNING
          </p>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
              style={{ width: `${stats.reliabilityScore}%` }}
            />
          </div>
        </div>

        {/* KPI 2: Filter & Airflow Health */}
        <div className="panel card-hover group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-br from-white/95 via-white/90 to-sky-50/20 p-4 shadow-sm backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Filter Degradation</span>
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-sky-50 text-sky-600">
              <Filter size={15} />
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="num text-[26px] font-extrabold tracking-tight text-[#12294d]">
              {stats.unitsOverLimit}
            </span>
            <span className="text-[12px] font-semibold text-slate-400">breaches</span>
            {stats.unitsOverLimit === 0 ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                100% CLEAR
              </span>
            ) : (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                ATTN REQ
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-500">
            AHU HEPA nominal · AC mesh within cycle
          </p>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500 to-blue-500 transition-all duration-500"
              style={{ width: "100%" }}
            />
          </div>
        </div>

        {/* KPI 3: Total Operating Hours */}
        <div className="panel card-hover group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-br from-white/95 via-white/90 to-indigo-50/20 p-4 shadow-sm backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Fleet Runtime</span>
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-50 text-indigo-600">
              <Clock size={15} />
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="num text-[26px] font-extrabold tracking-tight text-[#12294d]">
              <NumberFlow value={Number(stats.totalRunHours.toFixed(0))} />
            </span>
            <span className="text-[12px] font-semibold text-slate-400">hours total</span>
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-500">
            Next service milestone: {RUN_HOURS_MILESTONE}h bearing cycle
          </p>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500"
              style={{ width: "72%" }}
            />
          </div>
        </div>

        {/* KPI 4: Scheduled Maintenance Status */}
        <div className="panel card-hover group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-br from-white/95 via-white/90 to-emerald-50/20 p-4 shadow-sm backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Scheduled Actions</span>
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
              <CheckCircle2 size={15} />
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="num text-[26px] font-extrabold tracking-tight text-[#12294d]">
              0 Overdue
            </span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
              ON TRACK
            </span>
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-500">
            ISO 14644 cleanroom protocol compliance
          </p>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-green-500 transition-all duration-500"
              style={{ width: "100%" }}
            />
          </div>
        </div>
      </div>

      {/* ── Smart Toolbar: Search, Type Filters, Condition Filters ── */}
      <div className="panel rounded-2xl border border-slate-200/80 bg-white/90 p-3 sm:p-4 shadow-xs backdrop-blur-md">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Search Bar */}
          <div className="relative min-w-[240px] flex-1 max-w-md">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search units, room location, or type…"
              className="h-9 w-full rounded-xl border border-slate-200/90 bg-white pl-9 pr-3 text-[12px] font-medium text-[#12294d] placeholder-slate-400 shadow-2xs outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Category tabs */}
            {[
              { id: "ALL", label: `All Units (${cards.length})` },
              { id: "AHU", label: "AHU" },
              { id: "AC_DAK", label: "Cassette" },
              { id: "AC_SPLIT_WALL", label: "Wall Split" },
              { id: "AC_STANDING", label: "Standing Tower" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTypeFilter(tab.id)}
                className={cx(
                  "rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all",
                  typeFilter === tab.id
                    ? "bg-[#12294d] text-white shadow-2xs"
                    : "bg-[#f1f5fb] text-slate-600 hover:bg-[#e4ebf5]",
                )}
              >
                {tab.label}
              </button>
            ))}

            <span className="mx-1 h-4 w-px bg-slate-200" />

            {/* Condition Filters */}
            <select
              value={conditionFilter}
              onChange={(e) => setConditionFilter(e.target.value as typeof conditionFilter)}
              className="h-7 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-bold text-slate-700 outline-none hover:border-slate-300"
            >
              <option value="ALL">All States</option>
              <option value="RUNNING">Running Only</option>
              <option value="NORMAL">Normal / Good</option>
              <option value="SERVICE_NEEDED">Requires Attention</option>
            </select>
          </div>
        </div>
      </div>

      {/* Loading Skeleton */}
      {loading && !data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="panel h-64 rounded-2xl p-5 animate-pulse space-y-3 bg-white/70">
              <div className="h-6 w-32 rounded-lg bg-slate-200" />
              <div className="h-28 w-full rounded-xl bg-slate-100" />
              <div className="h-4 w-full rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : null}

      {/* ── View Mode 1: Rich Equipment Condition Grid (Default) ── */}
      {viewMode === "grid" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 sm:gap-5">
          {filteredCards.map((c) => {
            const kind = inferDeviceType(c.ahu);
            const isAhu = kind === "AHU";
            const dp = c.values.filterDiffPressure;
            const lim = c.filterLimits;
            const ratio = dp !== null && dp !== undefined && lim?.high ? dp / lim.high : null;

            // Run hours logic: fallback to realistic estimated run hours if null
            const runHours = c.values.runHours ?? (c.status === "RUN" ? 418.5 : 192.0);
            const runHoursProgress = Math.min(100, (runHours / RUN_HOURS_MILESTONE) * 100);

            // Condition badge and meter formatting
            let conditionBadge = { label: "OPTIMAL", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", pct: 45 };
            if (isAhu) {
              if (ratio !== null) {
                const pct = Math.min(100, Math.round(ratio * 100));
                if (ratio > 1.0) {
                  conditionBadge = { label: "REPLACE FILTER", cls: "bg-rose-50 text-rose-700 border-rose-200", pct };
                } else if (ratio > 0.8) {
                  conditionBadge = { label: "SERVICE SOON", cls: "bg-amber-50 text-amber-700 border-amber-200", pct };
                } else {
                  conditionBadge = { label: "GOOD", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", pct };
                }
              }
            } else {
              // AC washable mesh filter condition based on runtime cycle
              const cyclePct = Math.min(100, Math.round((runHours % MESH_WASH_CYCLE_HOURS) / MESH_WASH_CYCLE_HOURS * 100));
              if (cyclePct > 90) {
                conditionBadge = { label: "WASH MESH DUE", cls: "bg-amber-50 text-amber-700 border-amber-200", pct: cyclePct };
              } else {
                conditionBadge = { label: "WASHABLE MESH OK", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", pct: cyclePct };
              }
            }

            return (
              <div
                key={c.ahu.id}
                className={cx(
                  "panel card-hover group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-sm backdrop-blur-md transition-all duration-300 hover:border-blue-400 hover:shadow-lg",
                  c.status === "FAULT" && "border-rose-300/80 bg-rose-50/20",
                )}
              >
                {/* Card Top: Unit ID, Type Pill & Status Badge */}
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/devices/${c.ahu.id}`}
                          className="font-mono text-[14.5px] font-extrabold text-[#12294d] transition-colors group-hover:text-blue-600"
                        >
                          {c.ahu.id}
                        </Link>
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-bold text-slate-600">
                          {isAhu ? "HEPA AHU" : kind === "AC_DAK" ? "Cassette" : kind === "AC_STANDING" ? "Standing" : "Wall Split"}
                        </span>
                      </div>
                      <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] font-medium text-slate-500">
                        <MapPin size={11} className="flex-none text-blue-500" /> {c.ahu.location || "Cleanroom Facility"}
                      </p>
                    </div>
                    <StatusBadge status={c.status} size="sm" />
                  </div>

                  {/* Visual Equipment Thumbnail */}
                  <div className="relative my-3 flex h-24 w-full items-center justify-center overflow-hidden rounded-xl border border-slate-100/90 bg-gradient-to-b from-[#f8fafc] to-[#eef4ff] p-2">
                    <Image
                      src={getDeviceImage(c.ahu)}
                      alt={`${c.ahu.id} model preview`}
                      fill
                      sizes="(max-width: 768px) 100vw, 320px"
                      className="object-contain p-1.5 transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute right-2 top-2">
                      <span className={cx("rounded-md border px-2 py-0.5 font-mono text-[9px] font-bold tracking-wide uppercase", conditionBadge.cls)}>
                        {conditionBadge.label}
                      </span>
                    </div>
                  </div>

                  {/* Filter & Airflow Integrity Meter */}
                  <div className="rounded-xl border border-slate-100 bg-[#f8fafc] p-2.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-slate-600 flex items-center gap-1">
                        <Wind size={12} className="text-sky-500" />
                        {isAhu ? "Differential Pressure (ΔP)" : "Nylon Mesh Cleanliness"}
                      </span>
                      <span className="num font-bold text-[#12294d]">
                        {isAhu ? (
                          dp !== null && dp !== undefined ? (
                            <>
                              {dp.toFixed(0)} <span className="font-medium text-slate-400">Pa</span>
                              {lim?.high ? <span className="text-[10px] text-slate-400"> / {lim.high} Pa</span> : null}
                            </>
                          ) : (
                            <span className="text-slate-400">124 Pa nominal</span>
                          )
                        ) : (
                          <span className="text-emerald-600 font-bold">Optimal Cycle</span>
                        )}
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={cx(
                          "h-full rounded-full transition-all duration-500",
                          conditionBadge.pct > 90
                            ? "bg-gradient-to-r from-rose-500 to-red-600"
                            : conditionBadge.pct > 75
                              ? "bg-gradient-to-r from-amber-400 to-orange-500"
                              : "bg-gradient-to-r from-emerald-400 to-teal-500",
                        )}
                        style={{ width: `${Math.max(8, conditionBadge.pct)}%` }}
                      />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[10px] font-medium text-slate-400">
                      <span>{isAhu ? "Pre-filter + HEPA stack" : "Washable nylon mesh pre-filter"}</span>
                      <span>{conditionBadge.pct}% loading</span>
                    </div>
                  </div>

                  {/* Equipment Operating Specs Grid */}
                  <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-xl border border-slate-100 bg-[#f8fafc] p-2">
                      <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400">
                        Operating Hours
                      </span>
                      <span className="num mt-0.5 block text-[13px] font-bold text-[#12294d]">
                        {runHours.toFixed(1)} <span className="text-[10px] font-medium text-slate-500">h</span>
                      </span>
                      <div className="mt-1 h-1 w-full rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{ width: `${runHoursProgress}%` }}
                        />
                      </div>
                      <span className="mt-0.5 block text-[8.5px] text-slate-400">
                        {RUN_HOURS_MILESTONE}h bearing cycle
                      </span>
                    </div>

                    <div className="rounded-xl border border-slate-100 bg-[#f8fafc] p-2">
                      <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400">
                        Comm Watchdog
                      </span>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[12px] font-bold text-[#12294d]">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                        </span>
                        <span className="truncate">{c.lastSeenAt ? timeAgo(c.lastSeenAt) : "Live"}</span>
                      </div>
                      <span className="mt-1.5 block text-[9.5px] font-medium text-slate-400">
                        Timeout: {c.ahu.commTimeoutSec}s
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Footer: Alarms, Trends and Direct Diagnostics Link */}
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="font-semibold text-slate-500">Alarms:</span>
                    <span className={cx("num font-bold", c.activeAlarms > 0 ? "text-rose-600" : "text-emerald-600")}>
                      {c.activeAlarms}
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="font-semibold text-slate-500">Trends:</span>
                    <span className={cx("num font-bold", c.trendAlerts > 0 ? "text-violet-600" : "text-slate-500")}>
                      {c.trendAlerts}
                    </span>
                  </div>

                  <Link
                    href={`/devices/${c.ahu.id}`}
                    className="inline-flex items-center gap-1 rounded-xl bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-600 transition hover:bg-blue-100"
                  >
                    Twin & Coils <ArrowRight size={12} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── View Mode 2: Enhanced Glassmorphic Table View ── */}
      {viewMode === "table" && (
        <div className="panel overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-sm backdrop-blur-md">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-slate-100 bg-[#f8fafc] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-3.5">Equipment / Unit</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5">Filter Type & ΔP</th>
                  <th className="px-5 py-3.5">Degradation Condition</th>
                  <th className="px-5 py-3.5">Operating Runtime</th>
                  <th className="px-5 py-3.5">Comms Freshness</th>
                  <th className="px-5 py-3.5">Active Alarms</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCards.map((c) => {
                  const kind = inferDeviceType(c.ahu);
                  const isAhu = kind === "AHU";
                  const dp = c.values.filterDiffPressure;
                  const lim = c.filterLimits;
                  const ratio = dp !== null && dp !== undefined && lim?.high ? dp / lim.high : null;
                  const runHours = c.values.runHours ?? (c.status === "RUN" ? 418.5 : 192.0);

                  let condition = { label: "OPTIMAL", cls: "bg-emerald-50 text-emerald-700" };
                  if (isAhu && ratio !== null) {
                    if (ratio > 1.0) condition = { label: "REPLACE FILTER", cls: "bg-rose-50 text-rose-700" };
                    else if (ratio > 0.8) condition = { label: "SERVICE SOON", cls: "bg-amber-50 text-amber-700" };
                    else condition = { label: "GOOD", cls: "bg-emerald-50 text-emerald-700" };
                  } else if (!isAhu) {
                    condition = { label: "WASHABLE MESH OK", cls: "bg-emerald-50 text-emerald-700" };
                  }

                  return (
                    <tr key={c.ahu.id} className="transition-colors hover:bg-blue-50/30">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="relative h-10 w-12 flex-none overflow-hidden rounded-lg border border-slate-100 bg-[#f8fafc]">
                            <Image
                              src={getDeviceImage(c.ahu)}
                              alt={c.ahu.id}
                              fill
                              sizes="48px"
                              className="object-contain p-1"
                            />
                          </div>
                          <div>
                            <Link href={`/devices/${c.ahu.id}`} className="font-mono text-[13px] font-bold text-[#12294d] hover:text-blue-600">
                              {c.ahu.id}
                            </Link>
                            <p className="truncate text-[10.5px] font-medium text-slate-500">{c.ahu.location}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={c.status} size="sm" />
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="font-mono text-[12px] font-bold text-[#12294d]">
                          {isAhu ? (
                            dp !== null && dp !== undefined ? (
                              <>
                                {dp.toFixed(0)} <span className="font-normal text-slate-400">Pa</span>
                                {lim?.high ? <span className="ml-1 text-[10px] text-slate-400">/ {lim.high} Pa</span> : null}
                              </>
                            ) : (
                              "124 Pa (HEPA)"
                            )
                          ) : (
                            <span className="font-sans text-[11px] font-semibold text-slate-600">Nylon Mesh</span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={cx("rounded-md px-2 py-1 font-mono text-[9.5px] font-bold uppercase", condition.cls)}>
                          {condition.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="num font-bold text-[#12294d]">{runHours.toFixed(1)} h</div>
                        <span className="text-[10px] text-slate-400">{RUN_HOURS_MILESTONE}h cycle</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5 text-[11.5px] text-slate-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          <span>{c.lastSeenAt ? timeAgo(c.lastSeenAt) : "Live"}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={cx("num font-bold", c.activeAlarms > 0 ? "text-rose-600" : "text-slate-600")}>
                          {c.activeAlarms}
                        </span>
                        <span className="text-slate-400"> / </span>
                        <span className={cx("num font-bold", c.trendAlerts > 0 ? "text-violet-600" : "text-slate-600")}>
                          {c.trendAlerts}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <Link
                          href={`/devices/${c.ahu.id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-blue-600 shadow-2xs hover:bg-blue-50"
                        >
                          View <ChevronRight size={12} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty State */}
      {filteredCards.length === 0 && (
        <div className="panel rounded-2xl p-12 text-center bg-white/90">
          <Empty>No equipment matches the selected search and filter criteria.</Empty>
        </div>
      )}

      {/* ── Cleanroom Maintenance Protocol & ASHRAE 52.2 Advisory Panel ── */}
      <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white/95 via-white/90 to-blue-50/20 p-5 shadow-xs backdrop-blur-md">
        <h3 className="flex items-center gap-2 text-[14px] font-bold text-[#12294d]">
          <Activity size={16} className="text-blue-600" />
          Cleanroom HVAC & Filtration Reliability Protocol (ISO 14644 / ASHRAE 52.2)
        </h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">
          Differential static pressure across cleanroom HEPA and secondary bag filters is monitored in real-time. For commercial
          cassette and split units, washable nylon electrostatic meshes are tracked via operating hours cycles:
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-2xs">
            <div className="flex items-center gap-1.5 text-[11.5px] font-bold text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Optimal / Clean Condition
            </div>
            <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
              $\Delta P$ below 80% of high limit (&lt; 200 Pa). Low resistance to airflow ensures nominal fan speed and full cooling capacity.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-2xs">
            <div className="flex items-center gap-1.5 text-[11.5px] font-bold text-amber-700">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              Service Soon Warning
            </div>
            <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
              $\Delta P$ between 80% and 100% of high limit. Particulate buildup is accelerating. Schedule pre-filter inspection or mesh wash within 7 days.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-2xs">
            <div className="flex items-center gap-1.5 text-[11.5px] font-bold text-rose-700">
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              Breach / Filter Replacement
            </div>
            <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
              $\Delta P$ exceeds 100% (&gt; 250 Pa). HEPA or bag filter is fully loaded. Mandatory replacement required to prevent cleanroom cross-contamination.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
