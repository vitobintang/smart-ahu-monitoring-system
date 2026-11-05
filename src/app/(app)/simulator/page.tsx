"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Cpu, Play, RotateCcw, Send, ShieldAlert, Zap } from "lucide-react";
import { api, LOCAL_POLL_MS, usePoll } from "@/lib/client";
import { AHU_IDS, PARAMETERS, type ParamKey } from "@/lib/domain";
import { Btn, Empty, ErrorNote, Field, Spinner, cx, inputClass } from "@/components/ui";

interface Override {
  ahuId: string;
  forcedFault: string | null;
  commLoss: boolean;
  rejectCommands: boolean;
  rapidFilterFouling: boolean;
  humiditySpike: boolean;
  currentOverload: boolean;
}

interface SimData {
  ahus: { id: string; name: string; desiredRunState: "RUN" | "STOP"; controlMode: string; setpoint: number; currentStatus: string }[];
  overrides: Override[];
  physicalControlUnlocked: boolean;
  note: string;
}

interface IngestResponse {
  status: number;
  body: unknown;
}

export default function SimulatorPage() {
  const { data, error, loading, reload, paused, setPaused } = usePoll<SimData>("/api/simulator", LOCAL_POLL_MS);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [ahuId, setAhuId] = useState<string>(AHU_IDS[0]);
  const [messageId, setMessageId] = useState<string>(() => crypto.randomUUID());
  const [reuseMessageId, setReuseMessageId] = useState(false);
  const [faultCode, setFaultCode] = useState("");
  const [runState, setRunState] = useState<"RUN" | "STOP">("RUN");
  const [params, setParams] = useState<Record<string, string>>({
    roomTemp: "24.2",
    supplyTemp: "14.8",
    humidity: "53",
    filterDiffPressure: "140",
    fanSpeed: "78",
    current: "12.4",
    voltage: "231",
  });
  const [response, setResponse] = useState<IngestResponse | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!reuseMessageId) setMessageId(crypto.randomUUID());
  }, [reuseMessageId]);

  async function patch(ahu: string, p: Partial<Override>) {
    setBusy(ahu);
    try {
      await api("/api/simulator", { method: "POST", body: JSON.stringify({ ahuId: ahu, ...p }) });
      await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  async function action(body: Record<string, unknown>) {
    setBusy("action");
    setNotice(null);
    try {
      await api("/api/simulator", { method: "POST", body: JSON.stringify(body) });
      await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  async function inject() {
    setSending(true);
    setResponse(null);
    try {
      const parameters: Record<string, number | null> = {};
      for (const [k, v] of Object.entries(params)) {
        parameters[k] = v === "" ? null : Number(v);
      }
      const res = await fetch("/api/simulator", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": document.cookie.match(/ahu_csrf=([^;]+)/)?.[1] ?? "" },
        body: JSON.stringify({ action: "INGEST", ahuId, messageId, runState, faultCode: faultCode || null, parameters }),
      });
      const body = await res.json();
      setResponse({ status: res.status, body });
      if (!reuseMessageId) setMessageId(crypto.randomUUID());
      await reload();
    } catch (err) {
      setResponse({ status: 0, body: { error: err instanceof Error ? err.message : "Request failed" } });
    } finally {
      setSending(false);
    }
  }

  if (loading && !data) return <Spinner label="Loading simulator…" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-50 sm:text-2xl">
            <Cpu size={20} className="text-violet-300" /> Telemetry &amp; Control Simulator
          </h1>
          <p className="text-xs text-slate-500">
            FR-28 built-in test engine · every generated record is stored with source {" "}
            <span className="font-mono text-violet-300">SIMULATION</span> · simulation control is fully active while
            physical control stays locked by default
          </p>
        </div>
        <div className="flex gap-2">
          <Btn variant="primary" onClick={() => void action({ action: "TICK" })} disabled={busy === "action"}>
            <Play size={13} /> Run one tick
          </Btn>
          <Btn variant="default" onClick={() => void action({ action: "RESET_ALL" })} disabled={busy === "action"}>
            <RotateCcw size={13} /> Reset overrides
          </Btn>
          <Btn variant={paused ? "danger" : "default"} onClick={() => setPaused(!paused)}>
            {paused ? "Resume" : "Pause"} polling
          </Btn>
        </div>
      </div>

      <div
        className={cx(
          "panel rounded-2xl p-4 text-[11px] leading-relaxed",
          data?.physicalControlUnlocked ? "border-emerald-500/40 text-emerald-200" : "border-amber-500/40 text-amber-200",
        )}
      >
        <strong className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wide">
          <ShieldAlert size={13} /> Physical control: {data?.physicalControlUnlocked ? "UNLOCKED" : "LOCKED (default)"}
        </strong>
        <p className="mt-1">
          Physical control is unavailable until a controller integration has been independently commissioned. Commands to physical devices are rejected. Independent hardware safety interlocks must be installed and verified locally.
        </p>
      </div>

      {notice ? <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{notice}</p> : null}
      <ErrorNote message={error} />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(data?.ahus ?? []).map((a) => {
          const ov = data?.overrides.find((o) => o.ahuId === a.id);
          return (
            <div key={a.id} className="panel rounded-2xl p-4">
              <div className="flex items-center justify-between gap-2">
                <Link href={`/ahu/${a.id}`} className="font-mono text-sm font-bold text-cyan-300 hover:text-cyan-200">
                  {a.id}
                </Link>
                <span className="rounded bg-ink-800 px-2 py-0.5 font-mono text-[10px] uppercase text-slate-300">
                  {a.currentStatus}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">{a.name}</p>
              <p className="mt-1 font-mono text-[10px] text-slate-500">
                desired {a.desiredRunState} · {a.controlMode} · setpoint {a.setpoint.toFixed(1)} °C
              </p>

              <div className="mt-3 space-y-1.5">
                <Toggle
                  label="Force controller fault (CRITICAL alarm)"
                  checked={Boolean(ov?.forcedFault)}
                  disabled={busy === a.id}
                  onChange={(v) => void patch(a.id, { forcedFault: v ? "SIM-FAULT-FAN-OVERLOAD" : null })}
                />
                <Toggle
                  label="Communication loss (heartbeat stop)"
                  checked={Boolean(ov?.commLoss)}
                  disabled={busy === a.id}
                  onChange={(v) => void patch(a.id, { commLoss: v })}
                />
                <Toggle
                  label="Reject commands / controller NACK (FR-26 FAILED)"
                  checked={Boolean(ov?.rejectCommands)}
                  disabled={busy === a.id}
                  onChange={(v) => void patch(a.id, { rejectCommands: v })}
                />
                <Toggle
                  label="Rapid filter fouling (trend test)"
                  checked={Boolean(ov?.rapidFilterFouling)}
                  disabled={busy === a.id}
                  onChange={(v) => void patch(a.id, { rapidFilterFouling: v })}
                />
                <Toggle
                  label="Humidity spike (threshold breach)"
                  checked={Boolean(ov?.humiditySpike)}
                  disabled={busy === a.id}
                  onChange={(v) => void patch(a.id, { humiditySpike: v })}
                />
                <Toggle
                  label="Motor current overload"
                  checked={Boolean(ov?.currentOverload)}
                  disabled={busy === a.id}
                  onChange={(v) => void patch(a.id, { currentOverload: v })}
                />
              </div>
            </div>
          );
        })}
      </div>

      {!data ? <Empty>Simulator unavailable.</Empty> : null}

      <div className="panel rounded-2xl p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-100">
          <Send size={14} className="text-cyan-300" /> Telemetry ingestion tester (FR-22 / FR-23)
        </h2>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Exercises the same validation pipeline as <span className="font-mono">POST /api/telemetry</span>: device bearer
          token, registered AHU identity, measurement timestamp, parameter structure and physical range validity, plus
          duplicate rejection. Enable "reuse messageId" and submit twice to observe the deduplication guard.
        </p>

        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="AHU">
            <select className={inputClass} value={ahuId} onChange={(e) => setAhuId(e.target.value)}>
              {AHU_IDS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Message ID" hint="deduplication key">
            <input className={cx(inputClass,"font-mono text-[11px]")} value={messageId} onChange={(e) => setMessageId(e.target.value)} />
          </Field>
          <Field label="Run state">
            <select className={inputClass} value={runState} onChange={(e) => setRunState(e.target.value as "RUN" | "STOP")}>
              <option value="RUN">RUN</option>
              <option value="STOP">STOP</option>
            </select>
          </Field>
          <Field label="Fault code" hint="non-empty raises a CRITICAL fault alarm">
            <input className={cx(inputClass,"font-mono text-[11px]")} value={faultCode} placeholder="(none)" onChange={(e) => setFaultCode(e.target.value)} />
          </Field>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {PARAMETERS.map((p) => (
            <label key={p.key} className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900/40 px-2.5 py-1.5">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-cyan-500"
                checked={params[p.key] !== undefined}
                onChange={(e) =>
                  setParams((prev) => {
                    const next = { ...prev };
                    if (e.target.checked) next[p.key] = "";
                    else delete next[p.key];
                    return next;
                  })
                }
              />
              <span className="flex-1 font-mono text-[10px] text-slate-400">
                {p.key}
                <span className="ml-1 text-slate-600">{p.unit}</span>
              </span>
              {params[p.key] !== undefined ? (
                <input
                  className="w-20 rounded border border-ink-600 bg-ink-950 px-1.5 py-0.5 text-right font-mono text-[11px] text-slate-100 outline-none focus:border-cyan-500/60"
                  value={params[p.key]}
                  placeholder="null"
                  onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: e.target.value }))}
                />
              ) : (
                <span className="font-mono text-[10px] text-slate-600">omitted</span>
              )}
            </label>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-[11px] text-slate-400">
            <input type="checkbox" className="h-4 w-4 accent-violet-500" checked={reuseMessageId} onChange={(e) => setReuseMessageId(e.target.checked)} />
            Reuse messageId on every submit (duplicate-retransmission test)
          </label>
          <Btn variant="primary" onClick={() => void inject()} disabled={sending}>
            <Zap size={13} /> {sending ? "Posting…" : "POST telemetry"}
          </Btn>
        </div>

        {response ? (
          <div className="mt-3 rounded-xl border border-ink-700 bg-ink-950/70 p-3">
            <p className="mb-1 flex items-center gap-2 font-mono text-[11px]">
              <Activity size={12} className="text-cyan-300" />
              HTTP{" "}
              <span
                className={cx(
                  "rounded px-1.5 py-0.5 font-bold",
                  response.status >= 200 && response.status < 300 ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300",
                )}
              >
                {response.status}
              </span>
            </p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-slate-300">
              {JSON.stringify(response.body, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cx(
        "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] transition",
        checked ? "border-violet-500/50 bg-violet-500/12 text-violet-100" : "border-ink-700 bg-ink-900/40 text-slate-400",
        disabled && "opacity-50",
      )}
    >
      <input type="checkbox" className="h-3.5 w-3.5 accent-violet-500" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export type { ParamKey };