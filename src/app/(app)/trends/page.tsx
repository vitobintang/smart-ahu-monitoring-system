"use client";

import Link from "next/link";
import { useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, Check, TriangleAlert } from "lucide-react";
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

export default function TrendsPage() {
  const { data, error, loading, reload, paused, setPaused } = usePoll<{
    analyses: Record<string, Analysis[]>;
    history: TrendRow[];
  }>("/api/trends", LOCAL_POLL_MS * 2);
  const { data: session } = usePoll<{ user: { role: string } | null }>("/api/auth/session", 60000);
  const canAck = session?.user ? ["Admin", "Engineering", "Operator"].includes(session.user.role) : false;
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [onlyAlerts, setOnlyAlerts] = useState(false);

  async function ack(id: string) {
    setBusy(id);
    try {
      await api("/api/trends", { method: "POST", body: JSON.stringify({ trendId: id }) });
      setNotice("Trend warning acknowledged and written to the audit log (FR-18).");
      await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Acknowledge failed");
    } finally {
      setBusy(null);
    }
  }

  const entries = Object.entries(data?.analyses ?? {});

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-50 sm:text-2xl">Smart Detection · Trend Center</h1>
          <p className="text-xs text-slate-500">
            FR-16 trend proximity estimation for the 15-minute and 30-minute horizons · FR-17 analysis quality ·
            FR-18 warning history
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Btn variant={onlyAlerts ? "primary" : "default"} onClick={() => setOnlyAlerts((v) => !v)}>
            {onlyAlerts ? "Showing projected breaches" : "Show only projected breaches"}
          </Btn>
          <Btn variant={paused ? "danger" : "default"} onClick={() => setPaused(!paused)}>
            {paused ? "Resume" : "Pause"} polling
          </Btn>
        </div>
      </div>

      <div className="panel rounded-2xl border-violet-200 bg-violet-50/90 p-4 text-[11.5px] leading-relaxed text-violet-950">
        <strong className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wide text-violet-900">
          <Activity size={13} className="text-violet-700" /> Trend Proximity Estimation
        </strong>
        <p className="mt-1">
          This module performs a linear/statistical projection of the recent parameter trajectory and reports how close
          it is to a configured threshold within 15 or 30 minutes. Per constraint 2 it is explicitly{" "}
          <span className="font-semibold text-violet-900">not</span> a definitive mechanical failure prediction. Every
          result is accompanied by its data-sufficiency indicator and an unreliability flag when variance is too high
          or the sample count is insufficient.
        </p>
      </div>

      {notice ? <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[11.5px] text-sky-900">{notice}</p> : null}
      <ErrorNote message={error} />
      {loading && !data ? <Spinner label="Running trend analysis…" /> : null}

      <div className="space-y-4">
        {entries.map(([ahuId, analyses]) => {
          const shown = analyses.filter((a) => (onlyAlerts ? Boolean(a.horizon) : true));
          if (shown.length === 0) return null;
          return (
            <div key={ahuId} className="panel rounded-2xl p-4">
              <div className="mb-3 flex items-center gap-2">
                <Link href={`/devices/${ahuId}`} className="font-mono text-sm font-bold text-cyan-300 hover:text-cyan-200">
                  {ahuId}
                </Link>
                <span className="text-[11px] text-slate-500">{shown.length} trend-enabled parameters</span>
              </div>
              <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                {shown.map((a) => (
                  <div
                    key={a.parameter}
                    className={cx(
                      "rounded-xl border p-3",
                      a.horizon && a.isReliable
                        ? "border-violet-500/50 bg-violet-500/10"
                        : a.horizon
                          ? "border-amber-500/40 bg-amber-500/8"
                          : "border-ink-700 bg-ink-900/50",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-slate-100">{a.label}</span>
                      <span className="font-mono text-[10px] text-slate-500">{PARAM_MAP[a.parameter].localLabel.toLowerCase()}</span>
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
                        <span className="ml-auto rounded bg-violet-500/25 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-violet-100">
                          ≤ {a.horizon} min
                        </span>
                      ) : null}
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-1.5 text-[11px] sm:grid-cols-4">
                      <Cell k="Current" v={a.currentValue === null ? "—" : `${a.currentValue} ${a.unit}`} />
                      <Cell k="ETA breach" v={a.minutesToBreach === null ? "—" : `${a.minutesToBreach.toFixed(1)} min`} />
                      <Cell k="Slope" v={`${a.slopePerMin.toFixed(3)}/min`} />
                      <Cell k="Limit" v={a.limit === null ? "—" : `${a.limit} ${a.unit}`} />
                    </dl>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[9px]">
                      <span className={cx("rounded px-1.5 py-0.5 font-mono uppercase ring-1", a.sufficient ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" : "bg-amber-500/15 text-amber-300 ring-amber-500/30")}>
                        {a.sufficient ? "data sufficient" : "data insufficient"} · {a.sampleCount}/{8} samples · {a.spanMin} min
                      </span>
                      <span className={cx("rounded px-1.5 py-0.5 font-mono uppercase ring-1", a.isReliable ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" : "bg-red-500/15 text-red-300 ring-red-500/30")}>
                        {a.isReliable ? "reliable" : "unreliable"} · R² {a.r2.toFixed(2)}
                      </span>
                    </div>
                    {a.unreliabilityReason ? (
                      <p className="mt-1.5 inline-flex items-start gap-1 text-[10px] text-amber-300">
                        <TriangleAlert size={11} className="mt-px shrink-0" /> {a.unreliabilityReason}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {entries.length === 0 && data ? <Empty>No trend-enabled parameters are configured.</Empty> : null}
      </div>

      <div className="panel rounded-2xl p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-100">Trend warning history (FR-18)</h2>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Every generated proximity warning is logged, broadcast to active web sessions and can be acknowledged.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="bg-ink-900/60 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2.5">Raised</th>
                <th className="px-3 py-2.5">AHU</th>
                <th className="px-3 py-2.5">Parameter</th>
                <th className="px-3 py-2.5">Direction</th>
                <th className="px-3 py-2.5">Horizon</th>
                <th className="px-3 py-2.5">ETA</th>
                <th className="px-3 py-2.5">Projection</th>
                <th className="px-3 py-2.5">Quality</th>
                <th className="px-3 py-2.5">Acknowledged</th>
                <th className="px-3 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800/70">
              {(data?.history ?? []).length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8">
                    <Empty>No trend warnings recorded yet.</Empty>
                  </td>
                </tr>
              ) : null}
              {(data?.history ?? []).map((t) => (
                <tr key={t.id}>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-slate-500" title={fmtDateTime(t.createdAt)}>
                    {timeAgo(t.createdAt)}
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/devices/${t.ahuId}`} className="font-mono text-cyan-300">
                      {t.ahuId}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-300">{t.parameter}</td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-slate-300">{t.direction}</td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-violet-300">{t.estimatedMin} min</td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-slate-300">
                    {t.minutesToBreach === null ? "—" : `${t.minutesToBreach.toFixed(1)} min`}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-slate-400">
                    {t.currentValue ?? "—"} → {t.projectedValue ?? "—"} (limit {t.thresholdValue ?? "—"})
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cx("rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ring-1", t.isReliable ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" : "bg-red-500/15 text-red-300 ring-red-500/30")}>
                      {t.isReliable ? "reliable" : "unreliable"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-slate-400">
                    {t.acknowledged ? fmtDateTime(t.acknowledgedAt) : <span className="text-slate-600">not acknowledged</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {!t.acknowledged ? (
                      <Btn variant="default" onClick={() => void ack(t.id)} disabled={busy === t.id || !canAck}>
                        <Check size={11} /> Ack
                      </Btn>
                    ) : (
                      <span className="text-[10px] text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg border border-ink-700/70 bg-ink-950/50 px-2 py-1">
      <dt className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">{k}</dt>
      <dd className="font-mono text-[11px] text-slate-200">{v}</dd>
    </div>
  );
}