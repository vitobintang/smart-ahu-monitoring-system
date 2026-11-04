"use client";

import { Fragment, useState } from "react";
import { ScrollText, ChevronDown, ChevronRight } from "lucide-react";
import { fmtDateTime, timeAgo, usePoll } from "@/lib/client";
import { Btn, Empty, ErrorNote, Spinner, cx, inputClass } from "@/components/ui";

interface LogRow {
  id: string;
  userId: string | null;
  userEmail: string | null;
  action: string;
  entity: string;
  details: unknown;
  ipAddress: string | null;
  createdAt: string;
}

const ACTION_TONE: Record<string, string> = {
  LOGIN_SUCCESS: "text-emerald-300",
  LOGOUT: "text-slate-300",
  LOGIN_FAILED: "text-red-300",
  LOGIN_RATE_LIMITED: "text-red-300",
  USER_CREATED: "text-cyan-300",
  DEVICE_PROVISIONED: "text-cyan-300",
  DEVICE_UPDATED: "text-cyan-300",
  CONFIG_CHANGED: "text-amber-300",
  ALARM_TRIGGERED: "text-orange-300",
  ALARM_ACKNOWLEDGED: "text-emerald-300",
  TREND_ALERT_TRIGGERED: "text-violet-300",
  TREND_ALERT_ACKNOWLEDGED: "text-violet-300",
  COMMAND_REQUESTED: "text-cyan-300",
  COMMAND_ACCEPTED: "text-amber-300",
  COMMAND_SUCCEEDED: "text-emerald-300",
  COMMAND_EXPIRED: "text-red-300",
  REPORT_EXPORTED: "text-slate-300",
  SIMULATOR_OVERRIDE: "text-violet-300",
  SIMULATOR_INJECT: "text-violet-300",
  SIMULATOR_RESET: "text-violet-300",
};

export default function AuditPage() {
  const [action, setAction] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const path = `/api/audit-logs?limit=250${action ? `&action=${encodeURIComponent(action)}` : ""}`;
  const { data, error, loading, reload, paused, setPaused } = usePoll<{ logs: LogRow[]; actions: string[] }>(path, 15000);

  if (loading && !data) return <Spinner label="Loading audit log…" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-50 sm:text-2xl">
            <ScrollText size={20} className="text-cyan-300" /> Audit Log
          </h1>
          <p className="text-xs text-slate-500">
            FR-29 immutable append-only trail · authentication, configuration changes, user creation, device
            provisioning, alarm &amp; trend activations/acknowledgments and control command lifecycle transitions
          </p>
        </div>
        <Btn variant={paused ? "danger" : "default"} onClick={() => setPaused(!paused)}>
          {paused ? "Resume" : "Pause"} polling
        </Btn>
      </div>

      <div className="panel no-print flex flex-wrap items-end gap-3 rounded-2xl p-3">
        <label className="min-w-[16rem] flex-1">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Filter by action</span>
          <select className={inputClass} value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {(data?.actions ?? []).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <Btn variant="default" onClick={() => void reload()}>
          Refresh
        </Btn>
        <p className="text-[11px] text-slate-500">
          Visible to Admin and Engineering only (RBAC · NFR-03).
        </p>
      </div>

      <ErrorNote message={error} />

      <div className="panel overflow-hidden rounded-2xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-xs">
            <thead className="bg-ink-900/60 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="w-8 px-2 py-2.5" />
                <th className="px-3 py-2.5">Timestamp</th>
                <th className="px-3 py-2.5">Action</th>
                <th className="px-3 py-2.5">Entity</th>
                <th className="px-3 py-2.5">Actor</th>
                <th className="px-3 py-2.5">IP address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800/70">
              {(data?.logs ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8">
                    <Empty>No audit entries recorded yet.</Empty>
                  </td>
                </tr>
              ) : null}
              {(data?.logs ?? []).map((l) => (
                <Fragment key={l.id}>
                  <tr className="hover:bg-ink-900/40">
                    <td className="px-2 py-2">
                      <button onClick={() => setOpen(open === l.id ? null : l.id)} className="text-slate-500 hover:text-cyan-300">
                        {open === l.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-slate-400" title={fmtDateTime(l.createdAt)}>
                      {fmtDateTime(l.createdAt)} <span className="text-slate-600">({timeAgo(l.createdAt)})</span>
                    </td>
                    <td className={cx("px-3 py-2 font-mono text-[11px] font-semibold", ACTION_TONE[l.action] ?? "text-slate-300")}>{l.action}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-400">{l.entity}</td>
                    <td className="px-3 py-2 text-slate-400">{l.userEmail ?? <span className="text-slate-600">system</span>}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{l.ipAddress ?? "—"}</td>
                  </tr>
                  {open === l.id ? (
                    <tr key={`${l.id}-details`} className="bg-ink-950/60">
                      <td colSpan={6} className="px-4 py-3">
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-slate-400">
                          {JSON.stringify(l.details, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}