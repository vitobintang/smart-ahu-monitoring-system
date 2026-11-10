"use client";

import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Bolt, Clock3, Gauge, Zap } from "lucide-react";
import { LOCAL_POLL_MS, usePoll } from "@/lib/client";
import { AHU_IDS } from "@/lib/domain";
import { Empty, ErrorNote, QualityTag, Spinner, StatTile, cx } from "@/components/ui";

interface Detail {
  ahu: { id: string; name: string; location: string };
  latest: Record<string, unknown> | null;
  computed: { status: string; stale: boolean };
  series: { points: { t: number; current: number | null; voltage: number | null }[] };
}

/** Read-only energy monitoring derived from the 12 supported parameters (FR-06). */
export default function EnergyPage() {
  const [ahuId, setAhuId] = useState<string>(AHU_IDS[0]);
  // Unit list follows the ACTIVE device fleet (Daikin DB ⇄ My DB switch).
  const { data: listData } = usePoll<{ ahus: Array<{ id: string }> }>("/api/ahu", 30000);
  const unitIds = listData?.ahus?.length ? listData.ahus.map((a) => a.id) : [...AHU_IDS];
  const activeAhuId = unitIds.includes(ahuId) ? ahuId : unitIds[0];
  const { data, error, loading } = usePoll<Detail>(`/api/ahu/${activeAhuId}?window=30`, LOCAL_POLL_MS);

  const latest = (data?.latest ?? {}) as Record<string, unknown>;
  const current = typeof latest.current === "number" ? latest.current : null;
  const voltage = typeof latest.voltage === "number" ? latest.voltage : null;
  const runHours = typeof latest.runHours === "number" ? latest.runHours : null;
  const currentFallback = Boolean(latest.isCurrentFallback);
  const voltageFallback = Boolean(latest.isVoltageFallback);
  const apparent = current !== null && voltage !== null ? current * voltage : null;

  const rows = (data?.series.points ?? []).map((p) => ({ t: p.t, current: p.current, voltage: p.voltage }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-[22px] font-bold tracking-[-0.02em] text-[#12294d]">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#3b82f6] to-[#1d4ed8] text-white shadow-[0_10px_22px_-8px_rgba(37,99,235,0.8)]">
              <Zap size={17} />
            </span>
            Energy Management
          </h1>
          <p className="mt-1 text-[12px] text-slate-500">
            Electrical parameters per unit: current (A), voltage (V), operating hours and derived apparent power —
            read-only monitoring (FR-06). Placeholder sentinels are flagged, never presented as measurements (NFR-06).
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {unitIds.map((id) => (
            <button
              key={id}
              onClick={() => setAhuId(id)}
              className={cx(
                "rounded-lg px-2.5 py-1.5 font-mono text-[11px] font-bold transition",
                activeAhuId === id ? "bg-[#2563eb] text-white shadow-[0_6px_16px_-6px_rgba(37,99,235,0.9)]" : "border border-[#e6ecf5] bg-white text-slate-500 hover:border-[#bfdbfe] hover:text-[#2563eb]",
              )}
            >
              {id}
            </button>
          ))}
        </div>
      </div>

      <ErrorNote message={error} />
      {loading && !data ? <Spinner label="Loading energy data…" /> : null}

      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="panel rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <p className="eyebrow">Current · arus</p>
                <QualityTag quality={currentFallback ? "ESTIMATED_FALLBACK" : current === null ? "NULL_UNAVAILABLE" : latest.source === "SIMULATION" ? "SIMULATED" : "OK"} />
              </div>
              <p className="num mt-2 text-[26px] font-bold text-[#12294d]">
                {current === null ? "—" : current.toFixed(2)} <span className="text-[12px] font-semibold text-slate-400">A</span>
              </p>
              {currentFallback ? (
                <p className="mt-1 text-[10.5px] text-fuchsia-600">1 A sentinel — excluded from averages &amp; charts</p>
              ) : (
                <p className="mt-1 text-[10.5px] text-slate-400">Measured on the supply feeder</p>
              )}
            </div>
            <div className="panel rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <p className="eyebrow">Voltage · tegangan</p>
                <QualityTag quality={voltageFallback ? "ESTIMATED_FALLBACK" : voltage === null ? "NULL_UNAVAILABLE" : latest.source === "SIMULATION" ? "SIMULATED" : "OK"} />
              </div>
              <p className="num mt-2 text-[26px] font-bold text-[#12294d]">
                {voltage === null ? "—" : voltage.toFixed(1)} <span className="text-[12px] font-semibold text-slate-400">V</span>
              </p>
              <p className="mt-1 text-[10.5px] text-slate-400">Nominal 230 V ±10 %</p>
            </div>
            <StatTile label="Apparent power (derived)" value={apparent === null ? "—" : `${(apparent / 1000).toFixed(2)} kVA`} icon={<Bolt size={15} />} tone="cyan" sub="V × A — computed, not metered" />
            <StatTile label="Operating hours" value={runHours === null ? "—" : runHours.toFixed(1)} icon={<Clock3 size={15} />} tone="neutral" sub="jam operasi · cumulative" />
          </div>

          <div className="panel rounded-2xl p-5">
            <h2 className="mb-3 flex items-center gap-2 text-[13.5px] font-bold text-[#12294d]">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#e8f0fe] text-[#2563eb]"><Gauge size={16} /></span>
              Current &amp; voltage — last 30 minutes ({ahuId})
            </h2>
            {rows.length === 0 ? (
              <Empty>No electrical samples in this window.</Empty>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: -14 }}>
                    <CartesianGrid stroke="#eef2f7" vertical={false} />
                    <XAxis dataKey="t" type="number" domain={["dataMin","dataMax"]} tickFormatter={(t) => new Date(t).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})} stroke="#94a3b8" fontSize={10} tickLine={false} />
                    <YAxis yAxisId="a" stroke="#2563eb" fontSize={10} tickLine={false} />
                    <YAxis yAxisId="v" orientation="right" stroke="#f59e0b" fontSize={10} tickLine={false} domain={["auto","auto"]} />
                    <Tooltip contentStyle={{backgroundColor:"#fff",border:"1px solid #e6ecf5",borderRadius:10,fontSize:11}} labelFormatter={(v)=>new Date(Number(v)).toLocaleTimeString("en-GB")} />
                    <Line yAxisId="a" type="monotone" dataKey="current" name="Current (A)" stroke="#2563eb" strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls={false} />
                    <Line yAxisId="v" type="monotone" dataKey="voltage" name="Voltage (V)" stroke="#f59e0b" strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className="mt-2 text-[10.5px] text-slate-400">
              Gaps appear where a sample was NULL/UNAVAILABLE or flagged ESTIMATED_FALLBACK — placeholder values are
              never plotted as real measurements.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}