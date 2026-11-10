"use client";

import { useState } from "react";
import AhuDetailed3DView from "@/components/AhuDetailed3DView";
import Link from "next/link";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, ArrowDownRight, ArrowLeft, ArrowUpRight, Check, Clock, Cpu, MapPin, Server, TriangleAlert } from "lucide-react";
import { useSearchParams } from "next/navigation";
import type { AhuStatus } from "@/lib/types";
import { api, fmtDateTime, LOCAL_POLL_MS, timeAgo, usePoll } from "@/lib/client";
import {
  classifyQuality,
  PARAMETERS,
  PARAM_MAP,
  type DataQuality,
  type ParamKey,
} from "@/lib/domain";
import LiveCharts, { type ChartPoint } from "@/components/LiveCharts";
import ControlPanel from "@/components/ControlPanel";
import { Btn, CommandStatusBadge, Empty, ErrorNote, Metric, PriorityBadge, SourceTag, Spinner, StatusBadge, cx } from "@/components/ui";

interface Threshold {
  id: string;
  parameter: string;
  enabled: boolean;
  lowLimit: number | null;
  highLimit: number | null;
  delaySec: number;
  priority: string;
  trendEnabled: boolean;
  unit: string | null;
  label: string | null;
}

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
  series: { t: number; v: number }[];
  projection: { t: number; v: number }[];
}

interface Detail {
  ahu: {
    id: string;
    name: string;
    location: string;
    commTimeoutSec: number;
    hasHeater: boolean;
    installedSensors: string[];
    controlMode: "AUTO" | "MANUAL";
    setpoint: number;
    desiredRunState: "RUN" | "STOP";
    physicalControlEnabled: boolean;
    deviceType?: string | null;
  };
  latest: Record<string, unknown> | null;
  thresholds: Threshold[];
  devices: { id: string; label: string; sourceType: "PHYSICAL" | "SIMULATION"; enabled: boolean; createdAt: string }[];
  alarms: { id: string; parameter: string; priority: string; message: string; isActive: boolean; acknowledged: boolean; acknowledgedBy: string | null; acknowledgedAt: string | null; triggeredAt: string; resolvedAt: string | null; observedValue: number | null; thresholdValue: number | null }[];
  commands: { id: string; commandType: string; status: string; rejectionReason?: string | null; createdAt: string; expiresAt: string; confirmedAt: string | null; userEmail: string | null; payload: unknown }[];
  trends: { id: string; parameter: string; estimatedMin: number; direction: string; isReliable: boolean; acknowledged: boolean; createdAt: string; minutesToBreach: number | null }[];
  analyses: Analysis[];
  computed: { status: AhuStatus; ageSec: number | null; stale: boolean };
  windowMin: number;
  series: { points: ChartPoint[]; runProportion: number; buckets: { t: number; run: number; total: number }[] };
  serverTime: string;
}

export default function AhuDetailView({
  ahuId,
  canControl,
  physicalUnlocked,
}: {
  ahuId: string;
  canControl: boolean;
  physicalUnlocked: boolean;
}) {
  // Context-aware back navigation: links to this page carry ?from=<internal path>
  // (dashboard cards pass /dashboard, the 3D facility map passes /ahu). Anything
  // absent or unsafe falls back to the dashboard, the previous hardcoded target.
  const fromParam = useSearchParams().get("from");
  const backHref = fromParam && /^\/(?!\/)/.test(fromParam) ? fromParam : "/dashboard";
  const backLabel =
    backHref === "/dashboard" ? "Dashboard" : backHref === "/devices" ? "Devices Map" : "Back";
  const [win, setWin] = useState(15);
  const { data, error, loading, reload, paused, setPaused, lastSync } = usePoll<Detail>(
    `/api/ahu/${ahuId}?window=${win}`,
    LOCAL_POLL_MS,
  );
  const [ackBusy, setAckBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function ackAlarm(id: string) {
    setAckBusy(id);
    setNotice(null);
    try {
      await api("/api/alarms", { method: "POST", body: JSON.stringify({ alarmId: id }) });
      setNotice("Alarm acknowledged. Acknowledgment does not resolve an active alarm condition (FR-15).");
      await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Acknowledge failed");
    } finally {
      setAckBusy(null);
    }
  }

  async function ackTrend(id: string) {
    setAckBusy(id);
    setNotice(null);
    try {
      await api("/api/trends", { method: "POST", body: JSON.stringify({ trendId: id }) });
      setNotice("Trend proximity warning acknowledged (FR-18).");
      await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Acknowledge failed");
    } finally {
      setAckBusy(null);
    }
  }

  if (loading && !data) return <Spinner label={`Loading ${ahuId}…`} />;
  if (!data) return <Empty>{error ?? "No data available for this AHU."}</Empty>;

  const { ahu, latest, computed } = data;
  const values = (latest ?? {}) as Record<string, number | string | boolean | null>;
  const stale = computed.stale;
  const source = (values.source as "PHYSICAL" | "SIMULATION" | null) ?? null;
  const thMap = new Map(data.thresholds.map((t) => [t.parameter, t]));

  const qualityOf = (p: ParamKey): DataQuality =>
    classifyQuality({
      param: p,
      installed: ahu.installedSensors,
      value: values[p] as number | null,
      fallbackFlag: p === "current" ? Boolean(values.isCurrentFallback) : p === "voltage" ? Boolean(values.isVoltageFallback) : false,
      stale,
      source,
    });

  const activeAlarms = data.alarms.filter((a) => a.isActive);
  const resolvedAlarms = data.alarms.filter((a) => !a.isActive);
  const activeCommand = data.commands.find((c) => c.status === "REQUESTED" || c.status === "ACCEPTED") ?? null;

  return (
    <div className="space-y-5">
      {/* FR-05 identity header */}
      <div className="panel rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col gap-3.5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <Link
                href={backHref}
                className="group inline-flex items-center gap-2 rounded-full border border-[#c8dbf8] bg-white/95 py-1 pl-1 pr-3.5 text-[11.5px] font-bold text-[#12294d] shadow-[0_4px_14px_-4px_rgba(18,41,77,0.45)] backdrop-blur transition hover:border-[#60a5fa] hover:bg-[#f0f6ff]"
                title={`Back to ${backLabel}`}
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[#1d6ef2] text-white shadow transition-transform duration-200 group-hover:-translate-x-0.5">
                  <ArrowLeft size={13} />
                </span>
                {backLabel}
              </Link>
              <h1 className="font-mono text-lg font-bold tracking-wide text-cyan-300 text-glow-cyan">{ahu.id}</h1>
              <StatusBadge status={computed.status} />
              <SourceTag source={source} />
            </div>
            <p className="mt-1 text-sm font-medium text-slate-100">{ahu.name}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <MapPin size={11} /> {ahu.location}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock size={11} /> comm timeout {ahu.commTimeoutSec} s
              </span>
              <span className="inline-flex items-center gap-1">
                <Cpu size={11} /> {ahu.controlMode} · setpoint {ahu.setpoint.toFixed(1)} °C · desired {ahu.desiredRunState}
              </span>
              <span className="inline-flex items-center gap-1">
                <Server size={11} /> last update {fmtDateTime(values.timestamp as string)} ({timeAgo(values.timestamp as string)})
              </span>
              {lastSync ? <span className="font-mono text-[10px]">view synced {timeAgo(lastSync)}</span> : null}
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <ControlPanel
              ahuId={ahu.id}
              status={computed.status}
              canControl={canControl}
              controlMode={ahu.controlMode}
              setpoint={ahu.setpoint}
              desiredRunState={ahu.desiredRunState}
              activeCommand={
                activeCommand
                  ? { id: activeCommand.id, commandType: activeCommand.commandType, status: activeCommand.status, expiresAt: activeCommand.expiresAt }
                  : null
              }
              physicalUnlocked={physicalUnlocked}
              onDone={() => void reload()}
            />
            <Btn variant={paused ? "danger" : "default"} onClick={() => setPaused(!paused)}>
              {paused ? "Resume" : "Pause"} polling
            </Btn>
          </div>
        </div>
        {notice ? <p className="mt-3 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[11px] text-cyan-200">{notice}</p> : null}
        <ErrorNote message={error} />
      </div>

      {/* FR-06 twelve parameters */}
      <div className="panel rounded-2xl p-4 sm:p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-100">
          Sensor parameters <span className="ml-1 font-mono text-[10px] text-slate-500">12 supported · {ahu.installedSensors.length} installed</span>
        </h2>
        <p className="mt-0.5 text-[11px] text-slate-500">
          NFR-06 data clarity: every value is tagged UNINSTALLED / NULL-UNAVAILABLE / STALE / SIMULATED / ESTIMATED_FALLBACK.
        </p>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {PARAMETERS.map((p) => {
            const quality = qualityOf(p.key);
            const raw = values[p.key];
            const num = typeof raw === "number" ? raw : null;
            const th = thMap.get(p.key);
            return (
              <Metric
                key={p.key}
                label={`${p.label} · ${p.localLabel.toLowerCase()}`}
                value={quality === "UNINSTALLED" ? "n/a" : num === null ? "—" : num.toFixed(p.decimals)}
                unit={p.unit}
                quality={quality}
                accent={quality === "OK" ? "cyan" : quality === "STALE" ? "amber" : "slate"}
                sub={
                  th?.enabled
                    ? `limits ${th.lowLimit ?? "—"} … ${th.highLimit ?? "—"} ${p.unit} · delay ${th.delaySec}s · ${th.priority}`
                    : "no threshold configured"
                }
              />
            );
          })}
        </div>
      </div>

      {/* FR-07 schematic */}
      <div className="panel rounded-2xl p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-100">Equipment condition — 3D internals</h2>
        <AhuDetailed3DView
          ahuId={ahu.id}
          deviceType={ahu.deviceType ?? "AHU"}
          status={computed.status}
          hasHeater={ahu.hasHeater}
          fanSpeed={typeof values.fanSpeed === "number" ? (values.fanSpeed as number) : null}
          className="mb-3"
        />
        {!ahu.hasHeater ? (
          <p className="mt-2 text-[10px] text-slate-500">
            Heating coil is not rendered because <span className="font-mono">hasHeater = false</span> for this unit (FR-07).
          </p>
        ) : null}
      </div>

      {/* FR-08 live charts */}
      <div className="panel rounded-2xl p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-100">Live telemetry charts</h2>
        <LiveCharts
          points={data.series.points}
          buckets={data.series.buckets}
          windowMin={data.windowMin}
          onWindow={(m) => setWin(m)}
          paused={paused}
          onTogglePause={() => setPaused(!paused)}
          runProportion={data.series.runProportion}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {/* FR-16 / FR-17 smart detection */}
        <div className="panel rounded-2xl p-4 sm:p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-100">Trend proximity estimation</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            FR-16 / FR-17 linear-statistical estimation of limit proximity within 15 or 30 minutes. This is{" "}
            <span className="text-violet-300">not</span> definitive mechanical failure prediction (constraint 2).
          </p>
          <div className="mt-3 space-y-3">
            {data.analyses.length === 0 ? <Empty>No trend-enabled parameters configured for this AHU.</Empty> : null}
            {data.analyses.map((a) => (
              <TrendCard key={a.parameter} analysis={a} />
            ))}
          </div>

          {data.trends.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Trend warning history (FR-18)
              </p>
              <div className="space-y-1.5">
                {data.trends.slice(0, 6).map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-700 bg-ink-900/50 px-2.5 py-1.5">
                    <Activity size={12} className="text-violet-300" />
                    <span className="font-mono text-[11px] text-slate-200">{t.parameter}</span>
                    <span className="text-[10px] text-slate-500">
                      {t.direction} · ≤ {t.estimatedMin} min · {t.minutesToBreach !== null ? `${t.minutesToBreach.toFixed(1)} min to breach` : "—"}
                    </span>
                    <span className={cx("ml-auto font-mono text-[9px] uppercase", t.isReliable ? "text-emerald-400" : "text-amber-400")}>
                      {t.isReliable ? "reliable" : "unreliable"}
                    </span>
                    {t.acknowledged ? (
                      <span className="font-mono text-[9px] uppercase text-slate-500">acked</span>
                    ) : (
                      <Btn variant="ghost" onClick={() => void ackTrend(t.id)} disabled={ackBusy === t.id || !canControl}>
                        <Check size={11} /> ack
                      </Btn>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* FR-15 alarms */}
        <div className="panel rounded-2xl p-4 sm:p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-100">Alarms</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Active and resolved lists are kept separate. Acknowledging records the user and timestamp but never clears
            an active condition.
          </p>
          <div className="mt-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-red-300">
              Active ({activeAlarms.length})
            </p>
            {activeAlarms.length === 0 ? <Empty>No active alarms.</Empty> : null}
            {activeAlarms.map((a) => (
              <div key={a.id} className="rounded-xl border border-ink-700 bg-ink-900/50 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <PriorityBadge priority={a.priority} />
                  <span className="font-mono text-[11px] text-cyan-300">{a.parameter}</span>
                  <span className="ml-auto text-[10px] text-slate-500">{timeAgo(a.triggeredAt)}</span>
                </div>
                <p className="mt-1 text-xs text-slate-300">{a.message}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {a.acknowledged ? (
                    <span className="font-mono text-[10px] uppercase text-emerald-400">
                      acknowledged {fmtDateTime(a.acknowledgedAt)}
                    </span>
                  ) : (
                    <Btn variant="default" onClick={() => void ackAlarm(a.id)} disabled={ackBusy === a.id || !canControl}>
                      <Check size={11} /> Acknowledge
                    </Btn>
                  )}
                  <span className="text-[10px] text-slate-600">condition remains ACTIVE</span>
                </div>
              </div>
            ))}

            <p className="pt-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
              Resolved ({resolvedAlarms.length})
            </p>
            {resolvedAlarms.slice(0, 6).map((a) => (
              <div key={a.id} className="rounded-xl border border-ink-800 bg-ink-950/40 p-2.5 opacity-75">
                <div className="flex flex-wrap items-center gap-2">
                  <PriorityBadge priority={a.priority} />
                  <span className="font-mono text-[11px] text-slate-400">{a.parameter}</span>
                  <span className="ml-auto text-[10px] text-slate-600">resolved {fmtDateTime(a.resolvedAt)}</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{a.message}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* FR-26 command queue + devices */}
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="panel rounded-2xl p-4 sm:p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-100">Command lifecycle (FR-26)</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            REQUESTED → ACCEPTED → SUCCEEDED | FAILED | EXPIRED · max 1 active command · TTL 60 s
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr className="border-b border-ink-700">
                  <th className="py-2 pr-3">Command</th>
                  <th className="py-2 pr-3">Payload</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Requested by</th>
                  <th className="py-2 pr-3">Created</th>
                  <th className="py-2">Confirmed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800/70">
                {data.commands.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-500">
                      No commands issued for this AHU yet.
                    </td>
                  </tr>
                ) : null}
                {data.commands.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 pr-3 font-mono text-cyan-300">{c.commandType}</td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-slate-400">{JSON.stringify(c.payload ?? {})}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-col items-start gap-1">
                        <CommandStatusBadge status={c.status} />
                        {c.rejectionReason ? (
                          <span className="max-w-xs text-[10px] leading-snug text-rose-700">
                            {c.rejectionReason}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-slate-400">{c.userEmail ?? "system"}</td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-slate-500">{fmtDateTime(c.createdAt)}</td>
                    <td className="py-2 font-mono text-[11px] text-slate-500">{c.confirmedAt ? fmtDateTime(c.confirmedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel rounded-2xl p-4 sm:p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-100">Provisioned devices (FR-21)</h2>
          <div className="mt-3 space-y-2">
            {data.devices.map((d) => (
              <div key={d.id} className="rounded-xl border border-ink-700 bg-ink-900/50 p-2.5">
                <div className="flex items-center gap-2">
                  <SourceTag source={d.sourceType} />
                  <span className="text-xs text-slate-200">{d.label}</span>
                  <span className={cx("ml-auto font-mono text-[10px] uppercase", d.enabled ? "text-emerald-400" : "text-slate-500")}>
                    {d.enabled ? "enabled" : "disabled"}
                  </span>
                </div>
              </div>
            ))}
            {data.devices.length === 0 ? <Empty>No devices provisioned.</Empty> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function TrendCard({ analysis: a }: { analysis: Analysis }) {
  const meta = PARAM_MAP[a.parameter];
  const chartData = [
    ...a.series.map((p) => ({ t: p.t, actual: p.v, projected: null as number | null })),
    ...a.projection.map((p) => ({ t: p.t, actual: null as number | null, projected: p.v })),
  ];
  return (
    <div
      className={cx(
        "rounded-xl border p-3",
        a.horizon && a.isReliable ? "border-violet-500/45 bg-violet-500/8" : "border-ink-700 bg-ink-900/50",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-100">{a.label}</span>
        <span className="font-mono text-[10px] text-slate-500">{meta.localLabel.toLowerCase()}</span>
        {a.direction === "RISING" ? (
          <span className="inline-flex items-center gap-1 rounded bg-orange-500/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-orange-300">
            <ArrowUpRight size={10} /> rising
          </span>
        ) : a.direction === "FALLING" ? (
          <span className="inline-flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-sky-300">
            <ArrowDownRight size={10} /> falling
          </span>
        ) : (
          <span className="rounded bg-slate-500/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-slate-400">flat</span>
        )}
        {a.horizon ? (
          <span className="ml-auto rounded bg-violet-500/20 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-violet-200">
            breach ≤ {a.horizon} min
          </span>
        ) : (
          <span className="ml-auto font-mono text-[10px] text-slate-500">no breach projected in 30 min</span>
        )}
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-4">
        <MiniStat label="Current" value={a.currentValue === null ? "—" : `${a.currentValue} ${a.unit}`} />
        <MiniStat
          label={`ETA to ${a.limitType ?? "limit"}`}
          value={a.minutesToBreach === null ? "—" : `${a.minutesToBreach.toFixed(1)} min`}
          tone={a.minutesToBreach !== null && a.minutesToBreach <= 15 ? "warn" : undefined}
        />
        <MiniStat label={`Projected (${a.horizon ?? 30} min)`} value={a.projectedValue === null ? "—" : `${a.projectedValue} ${a.unit}`} />
        <MiniStat label="Limit" value={a.limit === null ? "—" : `${a.limit} ${a.unit}`} />
      </div>

      <div className="mt-2 h-24">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 6, bottom: 0, left: -26 }}>
            <CartesianGrid stroke="rgba(30,58,85,0.4)" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
              stroke="#64748b"
              fontSize={9}
              tickLine={false}
            />
            <YAxis stroke="#64748b" fontSize={9} tickLine={false} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{ backgroundColor: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 10, color: "#0f172a" }}
              labelFormatter={(v) => new Date(Number(v)).toLocaleTimeString("en-GB")}
            />
            {a.limit !== null ? <ReferenceLine y={a.limit} stroke="#ef4444" strokeDasharray="4 4" /> : null}
            <Line type="monotone" dataKey="actual" stroke="#06b6d4" strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls={false} />
            <Line type="monotone" dataKey="projected" stroke="#a78bfa" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
        <span className={cx("rounded px-1.5 py-0.5 font-mono uppercase ring-1", a.sufficient ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" : "bg-amber-500/15 text-amber-300 ring-amber-500/30")}>
          data {a.sufficient ? "sufficient" : "insufficient"} · {a.sampleCount} samples / {a.spanMin} min
        </span>
        <span
          className={cx(
            "rounded px-1.5 py-0.5 font-mono uppercase ring-1",
            a.isReliable ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" : "bg-red-500/15 text-red-300 ring-red-500/30",
          )}
        >
          {a.isReliable ? "analysis reliable" : "analysis unreliable"}
        </span>
        <span className="font-mono text-slate-500">
          slope {a.slopePerMin.toFixed(3)} {a.unit}/min · R² {a.r2.toFixed(2)} · σ {a.residualStd.toFixed(2)}
        </span>
        {a.unreliabilityReason ? (
          <span className="inline-flex items-center gap-1 text-amber-300">
            <TriangleAlert size={11} /> {a.unreliabilityReason}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-lg border border-ink-700/70 bg-ink-950/50 px-2 py-1.5">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={cx("font-mono text-xs", tone === "warn" ? "text-amber-300" : "text-slate-200")}>{value}</p>
    </div>
  );
}