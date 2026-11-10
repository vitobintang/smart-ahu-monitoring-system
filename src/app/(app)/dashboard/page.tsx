"use client";

import Link from "next/link";
import { memo, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Box,
  CheckCircle2,
  Cloud,
  Cpu,
  Database,
  LayoutGrid,
  MemoryStick,
  Plus,
  Search,
  Send,
  Sun,
  Thermometer,
  TriangleAlert,
  Users,
  Wifi,
} from "lucide-react";
import type { AhuStatus } from "@/lib/types";
import { LOCAL_POLL_MS, timeAgo, usePoll } from "@/lib/client";
import { useSessionUser } from "@/components/AppShell";
import { PARAM_MAP, type ParamKey } from "@/lib/domain";
import { Empty, ErrorNote, Spinner, cx } from "@/components/ui";
import { Bars, HealthRow, Progress, Tile, UnitCard, type Card } from "./cards";

interface Overview {
  cards: Card[];
  totals: { ahus: number; online: number; run: number; fault: number; offline: number; activeAlarms: number; unackedAlarms: number; trendAlerts: number };
  liveSource?: "rtdb";
  sync: { mode: "CLOUD" | "LOCAL"; pollingIntervalSec: number; queuedItems: number; lastSuccessAt: string | null };
  recentAlarms: { id: string; ahuId: string; parameter: string; priority: string; message: string; triggeredAt: string; acknowledged: boolean; observedValue: number | null }[];
  recentTrends: { id: string; ahuId: string; parameter: string; estimatedMin: number; direction: string; createdAt: string }[];
  fleetSeries: Record<string, { t: number; v: number }[]>;
  windowMin: number;
  serverTime: string;
}

const SERIES_COLORS = ["#2563eb", "#0ea5e9", "#f59e0b", "#22c55e", "#ef4444", "#475569", "#a855f7"];

const HeroClock = memo(function HeroClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="text-center" suppressHydrationWarning>
      <span className="block text-[11px] font-medium text-slate-500">
        {now
          ? now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "2-digit", year: "numeric" })
          : "\u00A0"}
      </span>
      <span className="num block text-[17px] font-bold leading-tight text-[#12294d]">
        {now ? now.toLocaleTimeString("en-GB", { hour12: false }) : "--:--:--"}
      </span>
      <span className="block text-[9.5px] text-slate-400">(GMT+7)</span>
    </span>
  );
});

export default function DashboardPage() {
  const sessionUser = useSessionUser();
  const [win, setWin] = useState(15);
  const [filter, setFilter] = useState<"ALL" | AhuStatus>("ALL");
  const [query, setQuery] = useState("");
  const [dense, setDense] = useState(false);
  const { data, error, loading, paused, setPaused } = usePoll<Overview>(`/api/overview?window=${win}`, LOCAL_POLL_MS);
  const health = usePoll<{ ok: boolean; database: string; memPct?: number }>("/api/health", 20000);

  const name = useMemo(() => {
    const base =
      sessionUser?.fullName?.trim() ||
      (sessionUser?.email.split("@")[0] ?? "operator").replace(/^system$/, "admin");
    return base.charAt(0).toUpperCase() + base.slice(1);
  }, [sessionUser]);

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const cards = data?.cards ?? [];
  const counts = useMemo(
    () => ({
      ALL: cards.length,
      RUN: cards.filter((c) => c.status === "RUN").length,
      STOP: cards.filter((c) => c.status === "STOP").length,
      FAULT: cards.filter((c) => c.status === "FAULT").length,
      OFFLINE: cards.filter((c) => c.status === "OFFLINE").length,
    }),
    [cards],
  );
  const shown = (filter === "ALL" ? cards : cards.filter((c) => c.status === filter)).filter(
    (c) => !query || c.ahu.id.toLowerCase().includes(query.toLowerCase()) || c.ahu.name.toLowerCase().includes(query.toLowerCase()),
  );

  const trendRows = useMemo(() => {
    const series = data?.fleetSeries ?? {};
    const ts = new Set<number>();
    Object.values(series).forEach((pts) => pts.forEach((p) => ts.add(p.t)));
    return [...ts]
      .sort((a, b) => a - b)
      .map((t) => {
        const row: Record<string, number | null> = { t };
        for (const [ahuId, pts] of Object.entries(series)) row[ahuId] = pts.find((x) => x.t === t)?.v ?? null;
        return row;
      });
  }, [data?.fleetSeries]);

  const bars = useMemo(() => {
    const per = new Map<number, number>();
    Object.values(data?.fleetSeries ?? {}).forEach((pts) => pts.forEach((p) => per.set(p.t, (per.get(p.t) ?? 0) + 1)));
    const arr = [...per.entries()].sort((a, b) => a[0] - b[0]).slice(-12);
    const max = Math.max(1, ...arr.map(([, n]) => n));
    return arr.map(([, n]) => n / max);
  }, [data?.fleetSeries]);

  const activity = useMemo(() => {
    const items: { id: string; icon: React.ReactNode; tint: string; title: string; sub: string; at: string }[] = [];
    items.push({
      id: "login",
      icon: <Users size={15} />,
      tint: "bg-[#e8f0fe] text-[#2563eb]",
      title: "User login",
      sub: "active session",
      at: new Date().toISOString(),
    });
    for (const a of data?.recentAlarms ?? [])
      items.push({
        id: `al-${a.id}`,
        icon: <TriangleAlert size={15} />,
        tint: "bg-red-50 text-red-500",
        title: a.acknowledged ? "Alarm acknowledged" : "Alarm triggered",
        sub: `${a.ahuId} · ${a.parameter}`,
        at: a.triggeredAt,
      });
    for (const card of cards) {
      if (!card.activeCommand) continue;
      items.push({
        id: `cm-${card.activeCommand.id}`,
        icon: <Send size={15} />,
        tint: "bg-emerald-50 text-emerald-600",
        title: "Control command sent",
        sub: `${card.ahu.id} · ${card.activeCommand.commandType}`,
        at: card.activeCommand.expiresAt,
      });
    }
    if (cards[0]?.lastSeenAt)
      items.push({
        id: "telemetry",
        icon: <Wifi size={15} />,
        tint: "bg-[#e8f0fe] text-[#2563eb]",
        title: "Telemetry received",
        sub: `${cards[0].ahu.id} (${cards[0].source ?? "SIMULATION"})`,
        at: cards[0].lastSeenAt,
      });
    for (const t of data?.recentTrends ?? [])
      items.push({
        id: `tr-${t.id}`,
        icon: <Activity size={15} />,
        tint: "bg-violet-50 text-violet-500",
        title: "Trend alert generated",
        sub: `${t.ahuId} · ${t.parameter} (${t.estimatedMin} min)`,
        at: t.createdAt,
      });
    return items.sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 5);
  }, [data?.recentAlarms, data?.recentTrends, cards]);

  const simFresh = cards[0]?.lastSeenAt ? Date.now() - +new Date(cards[0].lastSeenAt) < 20000 : false;
  const activeCmds = cards.filter((c) => c.activeCommand).length;
  const onlinePct = data ? Math.round((data.totals.online / Math.max(1, data.totals.ahus)) * 100) : 0;
  const statusRows = [
    { name: "Running", value: counts.RUN, color: "#22c55e" },
    { name: "Stopped", value: counts.STOP, color: "#cbd5e1" },
    { name: "Fault", value: counts.FAULT, color: "#ef4444" },
    { name: "Offline", value: counts.OFFLINE, color: "#64748b" },
  ];
  const pieData = statusRows.filter((d) => d.value > 0);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="relative">
        <div className="relative flex flex-wrap items-end justify-between gap-2.5 pb-1 pt-0.5 sm:gap-4 sm:pb-2 sm:pt-1">
          <div>
            <h1 suppressHydrationWarning className="text-[21px] font-bold tracking-[-0.02em] text-[#12294d] sm:text-[34px]">
              {greet}, {name} <span aria-hidden>👋</span>
            </h1>
            <p className="mt-0.5 text-[12px] text-slate-500 sm:mt-1 sm:text-[13.5px]">
              Real-time status of your Air Handling Units.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-2.5 sm:flex">
              <Sun size={26} className="text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.7)]" />
              <span>
                <span className="block text-[17px] font-bold leading-tight text-[#12294d]">28°C</span>
                <span className="block text-[10.5px] text-slate-500">Partly cloudy</span>
              </span>
            </div>
            <span className="hidden h-8 w-px bg-slate-300/70 sm:inline-block" />
            <div className="hidden sm:block">
              <HeroClock />
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[10.5px] font-bold text-emerald-600 sm:px-3 sm:py-2 sm:text-[11px]">
              <span className={cx("h-1.5 w-1.5 rounded-full bg-emerald-500", !paused && "animate-pulse")} />
              {paused ? "Paused" : "Live Data"}
            </span>
            <select
              value={win}
              onChange={(e) => setWin(Number(e.target.value))}
              className="rounded-lg border border-[#e6ecf5] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 outline-none focus:border-[#bfdbfe] sm:px-3 sm:py-2 sm:text-[11.5px]"
            >
              <option value={5}>Last 5m</option>
              <option value={15}>Last 15m</option>
              <option value={30}>Last 30m</option>
            </select>
            <span className="hidden items-center gap-2 md:inline-flex">
              <Image
                src="/ahu/leaf.png"
                alt="Clean Air emblem"
                width={56}
                height={56}
                className="h-8 w-8 object-contain mix-blend-multiply"
              />
              <span className="text-[11px] font-semibold leading-tight text-[#12294d]">
                Clean Air
                <br />
                Better Tomorrow
              </span>
            </span>
          </div>
        </div>
      </div>

      <ErrorNote message={error} />
      {loading && !data ? <Spinner label="Loading fleet status…" /> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-2 sm:gap-3.5 lg:grid-cols-3 xl:grid-cols-5">
            <Tile
              tile={<Box size={19} className="sm:h-[22px] sm:w-[22px]" />}
              grad="from-[#3b82f6] to-[#1d4ed8]"
              glow="rgba(37,99,235,0.55)"
              value={String(data.totals.ahus)}
              label="Total AHU"
              mobileTag="Fleet"
              viz={<Bars bars={bars} color="#93c5fd" />}
              caption={
                <span className="inline-flex items-center gap-1 text-emerald-600">
                  <ArrowUpRight size={12} /> +0 this week
                </span>
              }
            />
            <Tile
              tile={<Wifi size={19} className="sm:h-[22px] sm:w-[22px]" />}
              grad="from-[#34d399] to-[#059669]"
              glow="rgba(16,185,129,0.5)"
              value={String(data.totals.online)}
              label="Online AHU"
              mobileTag={`${onlinePct}%`}
              viz={<Progress value={data.totals.online / Math.max(1, data.totals.ahus)} />}
              caption={
                <span className="inline-flex items-center gap-1 text-emerald-600">
                  {onlinePct}% Online <ArrowUpRight size={12} /> +1
                </span>
              }
            />
            <Tile
              tile={<TriangleAlert size={19} className="sm:h-[22px] sm:w-[22px]" />}
              grad="from-[#f87171] to-[#dc2626]"
              glow="rgba(239,68,68,0.5)"
              value={String(data.totals.activeAlarms)}
              label="Active Alarms"
              mobileTag={data.totals.activeAlarms > 0 ? "Alert" : "Clear"}
              viz={<Bars bars={bars} color="#fca5a5" />}
              alert={data.totals.activeAlarms > 0}
              caption={
                <span className="text-red-500">
                  {data.recentAlarms.filter((a) => a.priority === "CRITICAL").length} Critical{" "}
                  {data.recentAlarms.filter((a) => a.priority === "HIGH").length} High
                </span>
              }
            />
            <Tile
              tile={<Activity size={19} className="sm:h-[22px] sm:w-[22px]" />}
              grad="from-[#a78bfa] to-[#7c3aed]"
              glow="rgba(139,92,246,0.5)"
              value={String(data.totals.trendAlerts)}
              label="Trend Alerts"
              mobileTag={data.totals.trendAlerts > 0 ? "Watch" : "Stable"}
              viz={<Bars bars={bars} color="#c4b5fd" />}
              caption={<span className="text-slate-400">Requiring Attention</span>}
            />
            <Tile
              tile={<Cloud size={19} className="sm:h-[22px] sm:w-[22px]" />}
              grad="from-[#38bdf8] to-[#2563eb]"
              glow="rgba(37,99,235,0.6)"
              value={data.sync.mode === "LOCAL" ? "Local Mode" : "Firebase RTDB"}
              valueClass="block text-[14px] sm:text-[15px] font-bold leading-snug tracking-[-0.01em] text-[#12294d]"
              label="Database sync · FR-24"
              mobileBanner
              viz={
                <span className="flex w-full items-center gap-1.5 text-[11.5px] font-medium text-slate-600">
                  <span className="h-2 w-2 flex-none rounded-full bg-[#22c55e] shadow-[0_0_8px_rgba(34,197,94,0.9)]" />
                  {`HTTP Polling · ${data.sync.pollingIntervalSec}s`}
                </span>
              }
              caption={
                <span className="text-slate-400">
                  Last sync: {data.sync.lastSuccessAt ? timeAgo(data.sync.lastSuccessAt) : "—"} · queue {data.sync.queuedItems}
                </span>
              }
              href="/audit"
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1fr_21rem]">
            <div className="min-w-0">
              <div className="mb-3 flex flex-col gap-2.5 sm:mb-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <h2 className="text-[16px] font-bold tracking-[-0.015em] text-[#12294d] sm:text-[19px]">AHU Units</h2>
                    <p className="text-[11px] text-slate-500 sm:text-[11.5px]">Live status of all air handling units</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="-mx-0.5 flex items-center gap-1.5 overflow-x-auto px-0.5 pb-0.5 sm:flex-wrap sm:overflow-visible">
                    {(
                      [
                        ["ALL", `All (${counts.ALL})`, "bg-[#2563eb] text-white shadow-[0_6px_16px_-6px_rgba(37,99,235,0.9)]"],
                        ["RUN", `Running (${counts.RUN})`, "bg-emerald-50 text-emerald-600 border border-emerald-200"],
                        ["STOP", `Stopped (${counts.STOP})`, "bg-slate-100 text-slate-500 border border-slate-200"],
                        ["FAULT", `Fault (${counts.FAULT})`, "bg-red-50 text-red-500 border border-red-200"],
                        ["OFFLINE", `Offline (${counts.OFFLINE})`, "bg-slate-100 text-slate-500 border border-slate-200"],
                      ] as const
                    ).map(([key, label, cls]) => (
                      <button
                        key={key}
                        onClick={() => setFilter(key as typeof filter)}
                        className={cx(
                          "shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition sm:px-3",
                          filter === key ? cls : "border border-[#e6ecf5] bg-white text-slate-500 hover:border-[#bfdbfe] hover:text-[#2563eb]",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="relative flex-1 sm:ml-1 sm:flex-none">
                      <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search AHU units…"
                        className="w-full rounded-lg border border-[#e6ecf5] bg-white py-1.5 pl-8 pr-2 text-[11px] text-slate-600 outline-none focus:border-[#bfdbfe] sm:w-44"
                      />
                    </label>
                    <button
                      onClick={() => setDense((d) => !d)}
                      title="Toggle grid density"
                      className={cx(
                        "hidden rounded-lg border p-1.5 transition sm:inline-flex",
                        dense ? "border-[#bfdbfe] bg-[#e8f0fe] text-[#2563eb]" : "border-[#e6ecf5] bg-white text-slate-400 hover:text-[#2563eb]",
                      )}
                    >
                      <LayoutGrid size={14} />
                    </button>
                  </div>
                </div>
              </div>

              <div
                className={cx(
                  "grid grid-cols-2 gap-2.5 sm:gap-4",
                  dense ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4",
                )}
              >
                {shown.map((c) => (
                  <UnitCard key={c.ahu.id} card={c} />
                ))}
                <Link
                  href="/admin?tab=devices"
                  title="Provision a device for a new unit (FR-21)"
                  className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-[#dbe4f0] bg-white/60 p-3 text-center transition hover:border-[#bfdbfe] hover:bg-[#f6faff] sm:aspect-auto sm:min-h-[248px] sm:gap-2 sm:p-5"
                >
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-[#dbeafe] text-[#2563eb] sm:h-12 sm:w-12">
                    <Plus size={20} />
                  </span>
                  <span className="text-[12px] font-bold text-[#12294d] sm:text-[13.5px]">Add AHU Unit</span>
                  <span className="hidden text-[11px] text-slate-400 sm:inline">Expand your monitoring system</span>
                  <span className="mt-1 rounded-lg bg-[#dbeafe] px-3 py-1 text-[10.5px] font-bold text-[#2563eb] sm:mt-2 sm:px-4 sm:py-2 sm:text-[11.5px]">
                    Add Unit
                  </span>
                </Link>
              </div>
              {shown.length === 0 ? <Empty>No units match this filter.</Empty> : null}

              <div className="mt-5 grid gap-4 lg:grid-cols-[1.55fr_1fr]">
                <div className="panel rounded-2xl p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2.5 text-[13.5px] font-bold text-[#12294d]">
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#e8f0fe] text-[#2563eb]">
                        <Thermometer size={16} />
                      </span>
                      Supply Temperature Trend (°C)
                    </h3>
                    <select
                      value={win}
                      onChange={(e) => setWin(Number(e.target.value))}
                      className="rounded-lg border border-[#e6ecf5] bg-white px-2.5 py-1.5 text-[10.5px] font-semibold text-slate-500 outline-none"
                    >
                      <option value={5}>Last 5 minutes</option>
                      <option value={15}>Last 15 minutes</option>
                      <option value={30}>Last 30 minutes</option>
                    </select>
                  </div>
                  <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
                    {cards.map((c, i) => (
                      <span key={c.ahu.id} className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-slate-500">
                        <span className="h-2 w-2 rounded-full" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                        {c.ahu.id}
                      </span>
                    ))}
                  </div>
                  <div className="h-60">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendRows} margin={{ top: 6, right: 12, bottom: 0, left: -14 }}>
                        <CartesianGrid stroke="#eef2f7" vertical={false} />
                        <XAxis
                          dataKey="t"
                          type="number"
                          domain={["dataMin", "dataMax"]}
                          tickFormatter={(t) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                          stroke="#94a3b8"
                          fontSize={10}
                          tickLine={false}
                        />
                        <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} domain={["auto", "auto"]} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#fff", border: "1px solid #e6ecf5", borderRadius: 10, fontSize: 11 }}
                          labelFormatter={(v) => new Date(Number(v)).toLocaleTimeString("en-GB")}
                        />
                        {cards.map((c, i) => (
                          <Line
                            key={c.ahu.id}
                            type="monotone"
                            dataKey={c.ahu.id}
                            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                            strokeWidth={1.6}
                            dot={{ r: 2, strokeWidth: 0, fill: SERIES_COLORS[i % SERIES_COLORS.length] }}
                            activeDot={{ r: 3.5 }}
                            isAnimationActive={false}
                            connectNulls
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="panel rounded-2xl p-4 sm:p-5">
                  <h3 className="mb-4 text-[13.5px] font-bold text-[#12294d]">AHU Status Distribution</h3>
                  <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-5">
                    <div className="relative h-36 w-36 flex-none sm:h-40 sm:w-40">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={pieData} dataKey="value" innerRadius={48} outerRadius={72} paddingAngle={2} strokeWidth={0}>
                            {pieData.map((d) => (
                              <Cell key={d.name} fill={d.color} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 grid place-items-center">
                        <span className="text-center">
                          <span className="num block text-[24px] font-bold text-[#12294d] sm:text-[26px]">{counts.ALL}</span>
                          <span className="block text-[10px] text-slate-400">Units</span>
                        </span>
                      </div>
                    </div>
                    <div className="w-full flex-1 space-y-2">
                      {statusRows.map((d) => (
                        <div key={d.name} className="flex items-center gap-2 text-[11.5px]">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                          <span className="text-slate-500">{d.name}</span>
                          <span className="num ml-auto font-bold text-slate-700">{d.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-[#eef2f7] pt-3">
                    <span className="text-[12px] font-bold text-emerald-600">{onlinePct}% Units Online</span>
                    <Link href="/devices" className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-emerald-600 transition hover:bg-emerald-100">
                      <ArrowRight size={14} />
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="panel rounded-2xl p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-[13.5px] font-bold text-[#12294d]">Active Alarms</h3>
                  <Link href="/alarms" className="inline-flex items-center gap-1 text-[11px] font-bold text-[#2563eb] hover:underline">
                    View All <ArrowRight size={12} />
                  </Link>
                </div>
                <div className="space-y-3">
                  {data.recentAlarms.slice(0, 4).map((a) => (
                    <Link key={a.id} href="/alarms" className="flex items-start gap-3 rounded-xl p-1 transition hover:bg-[#f8fafc]">
                      <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-red-50 text-red-500">
                        <TriangleAlert size={17} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="font-mono text-[12.5px] font-bold text-[#12294d]">{a.ahuId}</span>
                          <span className="num text-[12.5px] font-bold text-red-500">
                            {a.observedValue !== null
                              ? `${a.observedValue.toFixed(1)} ${PARAM_MAP[(a.parameter as ParamKey)]?.unit ?? ""}`.trim()
                              : "No Feedback"}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-[10.5px] text-slate-400">{a.message}</span>
                        <span className="mt-1.5 flex items-center justify-between">
                          <span className="text-[10px] text-slate-400">{timeAgo(a.triggeredAt)}</span>
                          <span
                            className={cx(
                              "rounded-md px-2 py-0.5 font-mono text-[9px] font-bold uppercase text-white",
                              a.priority === "CRITICAL" ? "bg-[#ef4444]" : a.priority === "HIGH" ? "bg-[#f59e0b]" : "bg-[#64748b]",
                            )}
                          >
                            {a.priority}
                          </span>
                        </span>
                      </span>
                    </Link>
                  ))}
                  {data.recentAlarms.length === 0 ? (
                    <p className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#e4eaf3] py-7 text-[11.5px] text-slate-400">
                      <CheckCircle2 size={14} className="text-emerald-500" /> No active alarms
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="panel rounded-2xl p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-[13.5px] font-bold text-[#12294d]">Recent Activity</h3>
                  <Link href="/audit" className="inline-flex items-center gap-1 text-[11px] font-bold text-[#2563eb] hover:underline">
                    View All <ArrowRight size={12} />
                  </Link>
                </div>
                <div className="space-y-3.5">
                  {activity.map((a, i) => (
                    <div key={a.id} className="relative flex gap-3">
                      {i < activity.length - 1 ? <span className="absolute left-[17px] top-9 h-[calc(100%-16px)] w-px bg-[#e6ecf5]" /> : null}
                      <span className={cx("relative z-10 grid h-9 w-9 flex-none place-items-center rounded-xl", a.tint)}>{a.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[12px] font-bold text-[#12294d]">{a.title}</span>
                          <span className="flex-none text-[10px] text-slate-400">{timeAgo(a.at)}</span>
                        </span>
                        <span className="block truncate text-[10.5px] text-slate-400">{a.sub}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="panel rounded-2xl p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-[13.5px] font-bold text-[#12294d]">
                    <Activity size={15} className="text-[#2563eb]" /> System Health
                  </h3>
                  <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-600">Healthy</span>
                </div>
                <div className="space-y-3">
                  <HealthRow icon={<Cloud size={15} />} label="Firebase RTDB sync" value={`Polling ${data.sync.pollingIntervalSec}s`} />
                  <HealthRow
                    icon={<Database size={15} />}
                    label="Live data"
                    value="Firebase RTDB"
                  />
                  <HealthRow icon={<Database size={15} />} label="Database" value={health.data?.database === "connected" ? "Healthy" : "Warming up"} />
                  <HealthRow icon={<Cpu size={15} />} label="Simulation Engine" value={simFresh ? "Running" : "Idle"} />
                  <HealthRow icon={<Activity size={15} />} label="Trend Analysis" value="Running" />
                  <HealthRow icon={<Send size={15} />} label="Command Queue" value={activeCmds > 0 ? `${activeCmds} active` : "Healthy"} />
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-[#eef4ff] text-[#2563eb]">
                      <MemoryStick size={15} />
                    </span>
                    <span className="flex-1 text-[12px] text-slate-600">Memory Usage</span>
                    <span className="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
                      <span className="block h-full rounded-full bg-[#22c55e]" style={{ width: `${health.data?.memPct ?? 42}%` }} />
                    </span>
                    <span className="num w-8 text-right text-[11px] font-bold text-slate-600">{health.data?.memPct ?? 42}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      <div className="flex justify-end">
        <button
          onClick={() => setPaused(!paused)}
          className={cx(
            "rounded-lg px-3 py-1.5 text-[11px] font-bold transition",
            paused ? "bg-red-50 text-red-500 hover:bg-red-100" : "bg-[#f1f5fb] text-slate-500 hover:bg-[#e6edf7]",
          )}
        >
          {paused ? "Resume polling" : "Pause polling"}
        </button>
      </div>
    </div>
  );
}
