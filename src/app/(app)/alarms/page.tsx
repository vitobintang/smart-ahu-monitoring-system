"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Filter, TriangleAlert } from "lucide-react";
import { api, fmtDateTime, LOCAL_POLL_MS, timeAgo, usePoll } from "@/lib/client";
import { AHU_IDS } from "@/lib/domain";
import { Btn, Empty, ErrorNote, PriorityBadge, Spinner, cx } from "@/components/ui";

interface AlarmRow {
  id: string;
  ahuId: string;
  parameter: string;
  priority: string;
  message: string;
  breachDirection: string | null;
  observedValue: number | null;
  thresholdValue: number | null;
  isActive: boolean;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  triggeredAt: string;
  resolvedAt: string | null;
}

export default function AlarmsPage() {
  const [state, setState] = useState<"active" | "resolved" | "all">("active");
  const [ahuId, setAhuId] = useState<string>("");
  const [priority, setPriority] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { data: session } = usePoll<{ user: { role: string } | null }>("/api/auth/session", 60000);
  const canAck = session?.user ? ["Admin", "Engineering", "Operator"].includes(session.user.role) : false;

  const path = `/api/alarms?state=${state}${ahuId ? `&ahuId=${ahuId}` : ""}`;
  const { data, error, loading, reload, paused, setPaused } = usePoll<{ alarms: AlarmRow[]; activeCount: number }>(path, LOCAL_POLL_MS);

  async function ack(id: string) {
    setBusy(id);
    setNotice(null);
    try {
      await api("/api/alarms", { method: "POST", body: JSON.stringify({ alarmId: id }) });
      setNotice("Alarm acknowledged — user id and timestamp stored. The alarm condition stays ACTIVE (FR-15).");
      await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Acknowledge failed");
    } finally {
      setBusy(null);
    }
  }

  const rows = (data?.alarms ?? []).filter((a) => (priority ? a.priority === priority : true));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-50 sm:text-2xl">Alarm Center</h1>
          <p className="text-xs text-slate-500">
            FR-13 parameter thresholds · FR-14 fault (CRITICAL) &amp; communication timeout (HIGH) · FR-15 acknowledge
            without clearing
          </p>
        </div>
        <Btn variant={paused ? "danger" : "default"} onClick={() => setPaused(!paused)}>
          {paused ? "Resume" : "Pause"} polling
        </Btn>
      </div>

      <div className="panel flex flex-col gap-2.5 rounded-2xl p-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
        <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-ink-600 sm:flex">
          {(["active", "resolved", "all"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setState(s)}
              className={cx(
                "px-2.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide sm:px-3",
                state === s ? "bg-cyan-500/25 text-cyan-100" : "bg-ink-900/60 text-slate-400 hover:text-slate-200",
              )}
            >
              {s}
              {s === "active" && data ? ` (${data.activeCount})` : ""}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <span className="hidden items-center gap-1.5 text-[11px] text-slate-500 sm:inline-flex">
            <Filter size={12} /> filters
          </span>
          <select value={ahuId} onChange={(e) => setAhuId(e.target.value)} className="w-full rounded-lg border border-ink-600 bg-ink-950/80 px-2.5 py-1.5 text-xs text-slate-200 sm:w-auto">
            <option value="">All AHUs</option>
            {AHU_IDS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full rounded-lg border border-ink-600 bg-ink-950/80 px-2.5 py-1.5 text-xs text-slate-200 sm:w-auto">
            <option value="">All priorities</option>
            {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      {notice ? <p className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[11px] text-cyan-200">{notice}</p> : null}
      <ErrorNote message={error} />
      {loading && !data ? <Spinner label="Loading alarms…" /> : null}

      <div className="panel overflow-hidden rounded-2xl">
        {/* Mobile alarm cards */}
        <div className="divide-y divide-ink-800/70 md:hidden">
          {rows.length === 0 ? (
            <div className="p-6">
              <Empty>No alarms match the current filter.</Empty>
            </div>
          ) : null}
          {rows.map((a) => (
            <div key={a.id} className="space-y-2 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Link href={`/ahu/${a.ahuId}`} className="font-mono text-xs font-bold text-cyan-300 hover:underline">
                    {a.ahuId}
                  </Link>
                  <span className="font-mono text-[11px] text-slate-400">{a.parameter}</span>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase text-slate-200">
                    {a.priority}
                  </span>
                </div>
                <span className="font-mono text-[10.5px] text-slate-500">{timeAgo(a.triggeredAt)}</span>
              </div>
              <p className="text-xs leading-snug text-slate-300">{a.message}</p>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  {a.isActive ? (
                    <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-red-300">
                      <TriangleAlert size={10} /> active
                    </span>
                  ) : (
                    <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-emerald-300">
                      resolved
                    </span>
                  )}
                  <span className="text-[10.5px] text-slate-400">
                    {a.acknowledged ? `Acked ${fmtDateTime(a.acknowledgedAt)}` : "Unacknowledged"}
                  </span>
                </div>
                {a.isActive && !a.acknowledged ? (
                  <Btn size="sm" variant="default" onClick={() => void ack(a.id)} disabled={busy === a.id || canAck === false}>
                    <Check size={11} /> Ack
                  </Btn>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="bg-ink-900/60 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Priority</th>
                <th className="px-4 py-2.5">AHU</th>
                <th className="px-4 py-2.5">Parameter</th>
                <th className="px-4 py-2.5">Message</th>
                <th className="px-4 py-2.5">Triggered</th>
                <th className="px-4 py-2.5">State</th>
                <th className="px-4 py-2.5">Acknowledged</th>
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800/70">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8">
                    <Empty>No alarms in this list.</Empty>
                  </td>
                </tr>
              ) : null}
              {rows.map((a) => (
                <tr key={a.id} className={cx(a.isActive && a.priority === "CRITICAL" && "bg-red-500/5")}>
                  <td className="px-4 py-2.5">
                    <PriorityBadge priority={a.priority} />
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={`/ahu/${a.ahuId}`} className="font-mono text-cyan-300 hover:text-cyan-200">
                      {a.ahuId}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-300">
                    {a.parameter}
                    {a.breachDirection ? <span className="ml-1 text-[9px] text-slate-500">{a.breachDirection}</span> : null}
                  </td>
                  <td className="max-w-[26rem] px-4 py-2.5 text-slate-300">{a.message}</td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500" title={fmtDateTime(a.triggeredAt)}>
                    {timeAgo(a.triggeredAt)}
                  </td>
                  <td className="px-4 py-2.5">
                    {a.isActive ? (
                      <span className="inline-flex items-center gap-1.5 rounded bg-red-500/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-red-300">
                        <TriangleAlert size={10} /> active
                      </span>
                    ) : (
                      <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-emerald-300">
                        resolved {fmtDateTime(a.resolvedAt)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-slate-400">
                    {a.acknowledged ? (
                      <span>
                        <span className="font-mono text-emerald-400">yes</span> · {fmtDateTime(a.acknowledgedAt)}
                      </span>
                    ) : (
                      <span className="text-slate-600">no</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {a.isActive && !a.acknowledged ? (
                      <Btn variant="default" onClick={() => void ack(a.id)} disabled={busy === a.id || canAck === false}>
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

      <p className="text-[11px] leading-relaxed text-slate-500">
        Acknowledgment stores <span className="font-mono text-slate-400">acknowledgedBy</span> and{" "}
        <span className="font-mono text-slate-400">acknowledgedAt</span> and is written to the audit log.
        Per FR-15 it never clears or resolves an active alarm — resolution happens only when the measured condition
        returns inside its thresholds, the controller fault clears, or communication is restored.
      </p>
    </div>
  );
}