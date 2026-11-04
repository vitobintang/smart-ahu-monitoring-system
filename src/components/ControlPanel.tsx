"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Gauge, Play, Power, Settings, Square, X } from "lucide-react";
import type { AhuStatus } from "@/db/schema";
import { api } from "@/lib/client";
import { Btn, CommandStatusBadge, cx, inputClass } from "@/components/ui";
import { COMMAND_TTL_SEC, SETPOINT_MAX, SETPOINT_MIN } from "@/lib/domain";

interface ActiveCommand {
  id: string;
  commandType: string;
  status: string;
  expiresAt: string;
}

export default function ControlPanel({
  ahuId,
  status,
  canControl,
  controlMode,
  setpoint,
  desiredRunState,
  activeCommand,
  physicalUnlocked,
  onDone,
}: {
  ahuId: string;
  status: AhuStatus;
  canControl: boolean;
  controlMode: "AUTO" | "MANUAL";
  setpoint: number;
  desiredRunState: "RUN" | "STOP";
  activeCommand: ActiveCommand | null;
  physicalUnlocked: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sp, setSp] = useState(setpoint);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => setSp(setpoint), [setpoint]);

  useEffect(() => {
    if (!activeCommand) {
      setRemaining(null);
      return;
    }
    const tick = () => {
      const ms = new Date(activeCommand.expiresAt).getTime() - Date.now();
      setRemaining(Math.max(0, Math.ceil(ms / 1000)));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [activeCommand]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const offline = status === "OFFLINE";
  const faulted = status === "FAULT";

  async function send(commandType: string, payload?: { setpoint?: number }) {
    if (!canControl) return;
    setBusy(commandType);
    setError(null);
    setInfo(null);
    try {
      await api("/api/commands", { method: "POST", body: JSON.stringify({ ahuId, commandType, payload }) });
      setInfo(`${commandType} command queued — REQUESTED (TTL ${COMMAND_TTL_SEC} s). It becomes SUCCEEDED only after controller confirmation feedback (FR-27).`);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Command rejected");
    } finally {
      setBusy(null);
    }
  }

  const disabledAll = !canControl || offline || Boolean(activeCommand);
  const stopOnly = faulted;

  return (
    <>
      <Btn variant="primary" onClick={() => setOpen(true)} disabled={!canControl} title={canControl ? "Open AHU control panel (FR-25)" : "Your role may not send control commands"}>
        <Settings size={14} /> Control panel
      </Btn>

      {open ? (
        <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center">
          <div className="panel w-full max-w-2xl rounded-2xl">
            <header className="flex items-center justify-between gap-3 border-b border-ink-700/70 px-5 py-3">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-100">
                  {ahuId} · Control commands
                </h3>
                <p className="text-[11px] text-slate-500">
                  FR-25 / FR-26 / FR-27 · max 1 active command · TTL {COMMAND_TTL_SEC} s
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-lg border border-ink-600 p-2 text-slate-400 hover:text-slate-200">
                <X size={14} />
              </button>
            </header>

            <div className="space-y-4 px-5 py-4">
              {/* safety notice */}
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-200">
                <strong className="inline-flex items-center gap-1.5 font-semibold">
                  <AlertTriangle size={13} /> NFR-09 — NOT an emergency stop
                </strong>
                <p className="mt-1">
                  The web STOP button performs a normal operational stop only. It is <strong>not</strong> an E-STOP.
                  Independent hardware interlocks and safety cutoffs must be installed and verified locally.
                  Physical control is {physicalUnlocked ? "unavailable" : "disabled; no physical controller integration is commissioned"}.
                </p>
              </div>

              {/* interlocks */}
              {offline ? (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-[11px] text-rose-200">
                  Unit status is <strong>OFFLINE</strong> — all control commands are rejected (FR-27).
                </div>
              ) : null}
              {faulted ? (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-[11px] text-red-200">
                  Unit status is <strong>FAULT</strong> — only the <strong>STOP</strong> command is permitted (FR-27).
                </div>
              ) : null}

              {/* active command + countdown */}
              {activeCommand ? (
                <div className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-xs text-cyan-200">
                      {activeCommand.commandType} · <CommandStatusBadge status={activeCommand.status} />
                    </p>
                    <p className="font-mono text-xs text-cyan-300">
                      expires in {remaining ?? COMMAND_TTL_SEC} s
                    </p>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-200"
                      style={{ width: `${((remaining ?? 0) / COMMAND_TTL_SEC) * 100}%` }}
                    />
                  </div>
                  <p className="mt-2 text-[10px] text-slate-400">
                    REQUESTED → ACCEPTED → SUCCEEDED | FAILED | EXPIRED. Only one active command per AHU is allowed.
                  </p>
                </div>
              ) : null}

              {/* run control */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Run control</p>
                  <div className="flex gap-2">
                    <Btn variant="success" disabled={disabledAll || stopOnly || busy !== null} onClick={() => send("START")} className="flex-1">
                      <Play size={13} /> Start
                    </Btn>
                    <Btn
                      variant="danger"
                      disabled={!canControl || offline || Boolean(activeCommand) || busy !== null}
                      onClick={() => send("STOP")}
                      className="flex-1"
                    >
                      <Square size={13} /> Stop
                    </Btn>
                  </div>
                  <p className="mt-2 text-[10px] text-slate-500">
                    Desired state: <span className="font-mono text-slate-300">{desiredRunState}</span>
                  </p>
                </div>

                <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Operating mode</p>
                  <div className="flex gap-2">
                    <Btn
                      variant={controlMode === "AUTO" ? "primary" : "default"}
                      disabled={disabledAll || stopOnly || busy !== null}
                      onClick={() => send("MODE_AUTO")}
                      className="flex-1"
                    >
                      Auto
                    </Btn>
                    <Btn
                      variant={controlMode === "MANUAL" ? "primary" : "default"}
                      disabled={disabledAll || stopOnly || busy !== null}
                      onClick={() => send("MODE_MANUAL")}
                      className="flex-1"
                    >
                      Manual
                    </Btn>
                  </div>
                  <p className="mt-2 text-[10px] text-slate-500">
                    Active mode: <span className="font-mono text-slate-300">{controlMode}</span>
                  </p>
                </div>
              </div>

              {/* setpoint */}
              <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    <Gauge size={12} /> Temperature setpoint
                  </p>
                  <p className="font-mono text-[10px] text-slate-500">
                    bounded {SETPOINT_MIN.toFixed(1)} – {SETPOINT_MAX.toFixed(1)} °C
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="range"
                    min={SETPOINT_MIN}
                    max={SETPOINT_MAX}
                    step={0.5}
                    value={sp}
                    disabled={disabledAll || stopOnly}
                    onChange={(e) => setSp(Number(e.target.value))}
                    className="min-w-[180px] flex-1"
                  />
                  <input
                    type="number"
                    min={SETPOINT_MIN}
                    max={SETPOINT_MAX}
                    step={0.1}
                    value={sp}
                    disabled={disabledAll || stopOnly}
                    onChange={(e) => setSp(Number(e.target.value))}
                    className={cx(inputClass, "w-28 font-mono")}
                  />
                  <span className="font-mono text-lg text-cyan-300">{sp.toFixed(1)} °C</span>
                  <Btn
                    variant="primary"
                    disabled={disabledAll || stopOnly || busy !== null || sp < SETPOINT_MIN || sp > SETPOINT_MAX}
                    onClick={() => send("SETPOINT", { setpoint: Number(sp.toFixed(1)) })}
                  >
                    <Power size={13} /> Apply setpoint
                  </Btn>
                </div>
                <p className="mt-2 text-[10px] text-slate-500">
                  Current setpoint: <span className="font-mono text-slate-300">{setpoint.toFixed(1)} °C</span>. Out of
                  scope: calendar schedules, lead-lag / assist sequencing, direct coil / heater / damper actuator
                  control and protection reset commands (constraint 3).
                </p>
              </div>

              {error ? <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div> : null}
              {info ? <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{info}</div> : null}

              {!canControl ? (
                <p className="text-[11px] text-slate-500">
                  Your role is read-only for control. Admin, Engineering and Operator roles may send commands (FR-02).
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}