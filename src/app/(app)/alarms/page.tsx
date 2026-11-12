"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Filter,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
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
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const { data: session } = usePoll<{ user: { role: string } | null }>("/api/auth/session", 60000);
  const canAck = session?.user ? ["Admin", "Engineering", "Operator"].includes(session.user.role) : false;

  const path = `/api/alarms?state=${state}${ahuId ? `&ahuId=${ahuId}` : ""}`;
  const { data, error, loading, reload, paused, setPaused } = usePoll<{ alarms: AlarmRow[]; activeCount: number }>(path, LOCAL_POLL_MS);
  const { data: listData } = usePoll<{ ahus: Array<{ id: string }> }>("/api/ahu", 60000);
  const unitIds = listData?.ahus?.length ? listData.ahus.map((a) => a.id) : [...AHU_IDS];

  async function ack(id: string) {
    setBusy(id);
    try {
      await api("/api/alarms", { method: "POST", body: JSON.stringify({ alarmId: id }) });
      toast.success("Alarm acknowledged", {
        description: "Recorded acknowledgment with operator ID and timestamp (FR-15).",
      });
      await reload();
    } catch (err) {
      toast.error("Acknowledge failed", {
        description: err instanceof Error ? err.message : "Could not acknowledge alarm",
      });
    } finally {
      setBusy(null);
    }
  }

  async function ackAll() {
    setBusy("all");
    try {
      const res = await api<{ ok: boolean; count: number }>("/api/alarms", {
        method: "POST",
        body: JSON.stringify({ all: true }),
      });
      toast.success("All alarms acknowledged", {
        description: `Successfully acknowledged ${res.count ?? "all"} active alarms.`,
      });
      await reload();
    } catch (err) {
      toast.error("Bulk acknowledge failed", {
        description: err instanceof Error ? err.message : "Could not acknowledge all alarms",
      });
    } finally {
      setBusy(null);
    }
  }

  async function clearAllAcknowledged() {
    if (!confirm("Are you sure you want to clear all acknowledged alarms from history?")) return;
    setBusy("clear-all");
    try {
      const res = await api<{ ok: boolean; clearedCount: number }>("/api/alarms", {
        method: "DELETE",
        body: JSON.stringify({ allAcknowledged: true }),
      });
      toast.success("Acknowledged alarms cleared", {
        description: `Removed ${res.clearedCount ?? 0} acknowledged alarms from the log.`,
      });
      await reload();
    } catch (err) {
      toast.error("Clear failed", {
        description: err instanceof Error ? err.message : "Could not clear acknowledged alarms",
      });
    } finally {
      setBusy(null);
    }
  }

  async function clearAlarm(id: string) {
    setBusy(`clear-${id}`);
    try {
      await api("/api/alarms", {
        method: "DELETE",
        body: JSON.stringify({ alarmId: id }),
      });
      toast.success("Alarm cleared", {
        description: "Removed alarm record from the log.",
      });
      await reload();
    } catch (err) {
      toast.error("Clear failed", {
        description: err instanceof Error ? err.message : "Could not clear alarm",
      });
    } finally {
      setBusy(null);
    }
  }

  const allRows = data?.alarms ?? [];
  const unackedCount = allRows.filter((a) => a.isActive && !a.acknowledged).length;
  const ackedCount = allRows.filter((a) => a.acknowledged).length;

  const rows = allRows.filter((a) => {
    if (priority && a.priority !== priority) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const match =
        a.ahuId.toLowerCase().includes(q) ||
        a.parameter.toLowerCase().includes(q) ||
        a.message.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  return (
    <div className="space-y-5">
      {/* Header with Title and Global Actions */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Alarm Center</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Real-time threshold monitoring · Critical faults · Operator acknowledgment &amp; resolution tracking (FR-13..FR-15)
          </p>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          {canAck && unackedCount > 0 ? (
            <Btn
              variant="primary"
              size="md"
              onClick={() => void ackAll()}
              disabled={busy !== null}
              title="Acknowledge every active unacknowledged alarm"
            >
              <CheckCheck size={15} />
              Acknowledge All ({unackedCount})
            </Btn>
          ) : null}

          {canAck && ackedCount > 0 ? (
            <Btn
              variant="default"
              size="md"
              onClick={() => void clearAllAcknowledged()}
              disabled={busy !== null}
              title="Clear all acknowledged alarms from history"
              className="text-rose-600 hover:border-rose-300 hover:bg-rose-50"
            >
              <Trash2 size={14} />
              Clear Acknowledged ({ackedCount})
            </Btn>
          ) : null}

          <Btn
            variant={paused ? "danger" : "default"}
            size="md"
            onClick={() => setPaused(!paused)}
          >
            {paused ? "Resume polling" : "Pause polling"}
          </Btn>
        </div>
      </div>

      {/* Filter and View Bar */}
      <div className="group relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 p-3.5 shadow-2xs backdrop-blur-md transition-all sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          {/* Segmented State Tabs */}
          <div className="inline-flex rounded-xl border border-slate-200/80 bg-slate-100/90 p-1 shadow-inner">
            {(["active", "resolved", "all"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setState(s)}
                className={cx(
                  "rounded-lg px-3 py-1.5 font-sans text-xs font-semibold capitalize tracking-tight transition-all duration-150",
                  state === s
                    ? "bg-white text-slate-900 shadow-2xs ring-1 ring-black/5"
                    : "text-slate-600 hover:text-slate-900",
                )}
              >
                {s}
                {s === "active" && data ? ` (${data.activeCount})` : ""}
              </button>
            ))}
          </div>

          {/* Search and Dropdown Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[160px] flex-1 sm:w-56 sm:flex-none">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search alarms..."
                className="w-full rounded-xl border border-slate-200/90 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 outline-none transition hover:border-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
              />
            </div>

            <select
              value={ahuId}
              onChange={(e) => setAhuId(e.target.value)}
              className="rounded-xl border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 outline-none transition hover:border-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
            >
              <option value="">All devices</option>
              {unitIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>

            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="rounded-xl border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 outline-none transition hover:border-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
            >
              <option value="">All priorities</option>
              {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <ErrorNote message={error} />
      {loading && !data ? (
        <div className="space-y-3 rounded-2xl border border-slate-200/90 bg-white/95 p-6 shadow-2xs backdrop-blur-md animate-pulse">
          <div className="h-6 w-48 rounded bg-slate-200/80" />
          <div className="h-12 w-full rounded-xl bg-slate-100" />
          <div className="h-12 w-full rounded-xl bg-slate-50" />
          <div className="h-12 w-full rounded-xl bg-slate-50" />
          <div className="h-12 w-full rounded-xl bg-slate-50" />
        </div>
      ) : null}

      {/* Main Alarms Table and Mobile Cards */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 shadow-2xs backdrop-blur-md">
        {/* Mobile View (< md) */}
        <div className="divide-y divide-slate-100 md:hidden">
          {rows.length === 0 ? (
            <div className="p-8">
              <Empty icon={<Check className="h-6 w-6 text-emerald-500" />}>
                No alarms match the current filters.
              </Empty>
            </div>
          ) : null}
          {rows.map((a) => (
            <div
              key={a.id}
              className={cx(
                "space-y-2.5 p-4 transition-colors",
                a.isActive && a.priority === "CRITICAL" ? "bg-rose-50/40" : "hover:bg-slate-50/60",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Link href={`/devices/${a.ahuId}`} className="font-mono text-xs font-bold text-blue-600 hover:underline">
                    {a.ahuId}
                  </Link>
                  <span className="font-mono text-[11px] text-slate-500">{a.parameter}</span>
                  <PriorityBadge priority={a.priority} />
                </div>
                <span className="font-mono text-[10.5px] text-slate-400">{timeAgo(a.triggeredAt)}</span>
              </div>

              <p className="text-xs leading-relaxed text-slate-700">{a.message}</p>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  {a.isActive ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase text-rose-700 ring-1 ring-inset ring-rose-200">
                      <TriangleAlert size={10} /> active
                    </span>
                  ) : (
                    <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase text-emerald-700 ring-1 ring-inset ring-emerald-200">
                      resolved
                    </span>
                  )}
                  <span className="text-[10.5px] text-slate-400">
                    {a.acknowledged ? `Acked ${fmtDateTime(a.acknowledgedAt)}` : "Unacknowledged"}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {a.isActive && !a.acknowledged && canAck ? (
                    <Btn
                      size="sm"
                      variant="primary"
                      onClick={() => void ack(a.id)}
                      disabled={busy === a.id}
                    >
                      <Check size={11} /> Ack
                    </Btn>
                  ) : null}

                  {canAck && (a.acknowledged || !a.isActive) ? (
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() => void clearAlarm(a.id)}
                      disabled={busy === `clear-${a.id}`}
                      title="Clear this alarm from log"
                      className="text-slate-400 hover:text-rose-600"
                    >
                      <Trash2 size={12} /> Clear
                    </Btn>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop Table (>= md) */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="border-b border-slate-100 bg-slate-50/80 text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Device</th>
                <th className="px-4 py-3">Parameter</th>
                <th className="px-4 py-3">Message</th>
                <th className="px-4 py-3">Triggered</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3">Acknowledged</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12">
                    <Empty icon={<Check className="h-7 w-7 text-emerald-500" />}>
                      No alarms in this list. All monitored HVAC parameters are normal.
                    </Empty>
                  </td>
                </tr>
              ) : null}
              {rows.map((a) => (
                <tr
                  key={a.id}
                  className={cx(
                    "transition-colors",
                    a.isActive && a.priority === "CRITICAL" ? "bg-rose-50/30" : "hover:bg-slate-50/60",
                  )}
                >
                  <td className="px-4 py-3">
                    <PriorityBadge priority={a.priority} />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/devices/${a.ahuId}`} className="font-mono font-bold text-blue-600 hover:underline">
                      {a.ahuId}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-700">
                    {a.parameter}
                    {a.breachDirection ? (
                      <span className="ml-1 text-[9.5px] font-semibold text-slate-400">({a.breachDirection})</span>
                    ) : null}
                  </td>
                  <td className="max-w-[26rem] px-4 py-3 text-slate-700">{a.message}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-500" title={fmtDateTime(a.triggeredAt)}>
                    {timeAgo(a.triggeredAt)}
                  </td>
                  <td className="px-4 py-3">
                    {a.isActive ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-50 px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase text-rose-700 ring-1 ring-inset ring-rose-200">
                        <TriangleAlert size={10} /> active
                      </span>
                    ) : (
                      <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase text-emerald-700 ring-1 ring-inset ring-emerald-200">
                        resolved
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[11.5px] text-slate-600">
                    {a.acknowledged ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-emerald-800">
                          ACK
                        </span>
                        <span className="text-[10.5px] text-slate-400">{timeAgo(a.acknowledgedAt)}</span>
                      </span>
                    ) : (
                      <span className="font-mono text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {a.isActive && !a.acknowledged && canAck ? (
                        <Btn
                          variant="primary"
                          size="sm"
                          onClick={() => void ack(a.id)}
                          disabled={busy === a.id}
                        >
                          <Check size={11} /> Ack
                        </Btn>
                      ) : null}

                      {canAck && (a.acknowledged || !a.isActive) ? (
                        <Btn
                          variant="ghost"
                          size="sm"
                          onClick={() => void clearAlarm(a.id)}
                          disabled={busy === `clear-${a.id}`}
                          title="Clear this alarm from the log"
                          className="text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 size={13} />
                        </Btn>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-slate-400">
        Acknowledgment stores <span className="font-mono text-slate-500">acknowledgedBy</span> and{" "}
        <span className="font-mono text-slate-500">acknowledgedAt</span> and writes to the audit log.
        Per FR-15 it preserves the active alarm condition until the physical parameter returns within thresholds.
        Acknowledged and resolved alarms can be cleared to maintain an uncluttered log.
      </p>
    </div>
  );
}
