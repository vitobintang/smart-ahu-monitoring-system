"use client";

import Link from "next/link";
import { RefreshCw, Wrench } from "lucide-react";
import type { AhuStatus } from "@/lib/types";
import { LOCAL_POLL_MS, timeAgo, usePoll } from "@/lib/client";
import { Empty, ErrorNote, Spinner, StatusBadge, cx } from "@/components/ui";

interface OverviewCard {
  ahu: { id: string; name: string; location: string; commTimeoutSec: number };
  status: AhuStatus;
  lastSeenAt: string | null;
  values: Record<string, number | null>;
  activeAlarms: number;
  trendAlerts: number;
  filterLimits?: { low: number | null; high: number | null };
}

/** Read-only maintenance indicators: filter loading, runtime, comms freshness. */
export default function MaintenancePage() {
  const { data, error, loading, reload, paused, setPaused } = usePoll<{ cards: OverviewCard[] }>(
    "/api/overview?lite=1",
    LOCAL_POLL_MS,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-[22px] font-bold tracking-[-0.02em] text-[#12294d]">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#3b82f6] to-[#1d4ed8] text-white shadow-[0_10px_22px_-8px_rgba(37,99,235,0.8)]">
              <Wrench size={17} />
            </span>
            Maintenance
          </h1>
          <p className="mt-1 text-[12px] text-slate-500">
            Condition indicators per unit — filter loading against configured limits, runtime, communication freshness
            and open alarms. Read-only: no protection resets or actuator commands are exposed here (constraint 3).
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void reload()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e6ecf5] bg-white px-3 py-2 text-[11px] font-bold text-slate-500 transition hover:border-[#bfdbfe] hover:text-[#2563eb]"
          >
            <RefreshCw size={13} /> Refresh
          </button>
          <button
            onClick={() => setPaused(!paused)}
            className={cx(
              "rounded-lg px-3 py-2 text-[11px] font-bold transition",
              paused ? "bg-red-50 text-red-500" : "bg-[#f1f5fb] text-slate-500 hover:bg-[#e6edf7]",
            )}
          >
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
      </div>

      <ErrorNote message={error} />
      {loading && !data ? <Spinner label="Loading maintenance indicators…" /> : null}

      <div className="panel overflow-hidden rounded-2xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-[12px]">
            <thead>
              <tr>
                <th className="px-5 py-3">Unit</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Filter ΔP</th>
                <th className="px-5 py-3">Condition</th>
                <th className="px-5 py-3">Run hours</th>
                <th className="px-5 py-3">Comm timeout</th>
                <th className="px-5 py-3">Last seen</th>
                <th className="px-5 py-3">Alarms / Trends</th>
              </tr>
            </thead>
            <tbody>
              {(data?.cards ?? []).map((c) => {
                const dp = c.values.filterDiffPressure ?? null;
                const lim = c.filterLimits;
                const ratio = dp !== null && lim?.high ? dp / lim.high : null;
                const cond =
                  dp === null
                    ? { label: "NO DATA", cls: "bg-slate-100 text-slate-500" }
                    : ratio === null
                      ? { label: "UNCONFIGURED", cls: "bg-slate-100 text-slate-500" }
                      : ratio > 1
                        ? { label: "REPLACE FILTER", cls: "bg-red-50 text-red-500" }
                        : ratio > 0.8
                          ? { label: "SERVICE SOON", cls: "bg-amber-50 text-amber-600" }
                          : { label: "GOOD", cls: "bg-emerald-50 text-emerald-600" };
                return (
                  <tr key={c.ahu.id} className="border-t border-[#eef2f7] transition hover:bg-[#f8fafc]">
                    <td className="px-5 py-3.5">
                      <Link href={`/ahu/${c.ahu.id}`} className="font-mono text-[12.5px] font-bold text-[#12294d] hover:text-[#2563eb]">
                        {c.ahu.id}
                      </Link>
                      <p className="mt-0.5 truncate text-[10.5px] text-slate-400">{c.ahu.location}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={c.status} size="sm" />
                    </td>
                    <td className="num px-5 py-3.5 font-bold text-[#12294d]">
                      {dp === null ? "--" : dp.toFixed(0)} <span className="font-semibold text-slate-400">Pa</span>
                      {lim?.high ? <span className="ml-1 text-[10px] font-semibold text-slate-400">/ {lim.high} Pa</span> : null}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={cx("rounded-md px-2 py-1 font-mono text-[9.5px] font-bold uppercase", cond.cls)}>{cond.label}</span>
                    </td>
                    <td className="num px-5 py-3.5 text-slate-600">{c.values.runHours === null ? "--" : c.values.runHours.toFixed(1)} h</td>
                    <td className="num px-5 py-3.5 text-slate-600">{c.ahu.commTimeoutSec} s</td>
                    <td className="px-5 py-3.5 text-slate-500">{c.lastSeenAt ? timeAgo(c.lastSeenAt) : "never"}</td>
                    <td className="px-5 py-3.5">
                      <span className={cx("num font-bold", c.activeAlarms > 0 ? "text-red-500" : "text-slate-600")}>{c.activeAlarms}</span>
                      <span className="text-slate-400"> / </span>
                      <span className={cx("num font-bold", c.trendAlerts > 0 ? "text-violet-500" : "text-slate-600")}>{c.trendAlerts}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(data?.cards ?? []).length === 0 ? (
          <div className="p-6"><Empty>No units registered.</Empty></div>
        ) : null}
      </div>

      <p className="text-[11px] leading-relaxed text-slate-400">
        Filter condition compares the live differential pressure against the configured high limit (FR-13): GOOD below
        80 %, SERVICE SOON above 80 %, REPLACE FILTER above 100 %. Alarms and trend warnings remain authoritative in
        the Alarm Center and Trend Analysis views.
      </p>
    </div>
  );
}
