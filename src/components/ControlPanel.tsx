"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Gauge, Play, Power, Settings, Square, X } from "lucide-react";
import type { AhuStatus } from "@/db/schema";
import { api } from "@/lib/client";
import { Btn, CommandStatusBadge, StatusBadge, cx, inputClass } from "@/components/ui";
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
  compact = false,
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
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [sp, setSp] = useState(setpoint);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

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
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
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
      setInfo(
        `${commandType} command queued — REQUESTED (TTL ${COMMAND_TTL_SEC} s). It becomes SUCCEEDED only after controller confirmation feedback (FR-27).`,
      );
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Command rejected");
    } finally {
      setBusy(null);
    }
  }

  const disabledAll = !canControl || offline || Boolean(activeCommand);
  const stopOnly = faulted;

  const modal =
    open && mounted
      ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${ahuId} control commands`}
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
            className="no-print fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 p-2.5 backdrop-blur-xs sm:items-center sm:p-4"
          >
            <div className="animate-rise flex max-h-[calc(100dvh-1.25rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#dbe4f0] bg-white shadow-[0_24px_70px_-18px_rgba(15,23,42,0.45)] sm:max-h-[calc(100dvh-3rem)]">
              <header className="flex flex-none items-center justify-between gap-3 border-b border-[#e6ecf5] bg-[#f8fafd] px-4 py-3.5 sm:px-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-mono text-sm font-bold uppercase tracking-wide text-[#12294d]">
                      {ahuId} · Control Panel
                    </h3>
                    <StatusBadge status={status} size="sm" />
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    FR-25 / FR-26 / FR-27 · max 1 active command · TTL {COMMAND_TTL_SEC} s
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close control panel"
                  className="grid h-9 w-9 flex-none place-items-center rounded-xl border border-[#dbe4f0] bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-800"
                >
                  <X size={16} />
                </button>
              </header>

              <div className="flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-4 py-4 sm:space-y-4 sm:px-5">
                {/* safety notice */}
                <div className="rounded-xl border border-amber-200 bg-amber-50/90 p-3 text-[11px] leading-relaxed text-amber-900">
                  <strong className="inline-flex items-center gap-1.5 font-semibold text-amber-950">
                    <AlertTriangle size={13} className="text-amber-600" /> NFR-09 — NOT an emergency stop
                  </strong>
                  <p className="mt-1">
                    The web STOP button performs a normal operational stop only. It is <strong>not</strong> an E-STOP.
                    Independent hardware interlocks and safety cutoffs must be installed and verified locally. Physical
                    control is{" "}
                    {physicalUnlocked
                      ? "unavailable"
                      : "disabled; no physical controller integration is commissioned"}
                    .
                  </p>
                </div>

                {/* interlocks */}
                {offline ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-[11.5px] text-rose-800">
                    Unit status is <strong>OFFLINE</strong> — all control commands are rejected (FR-27).
                  </div>
                ) : null}
                {faulted ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[11.5px] text-red-800">
                    Unit status is <strong>FAULT</strong> — only the <strong>STOP</strong> command is permitted (FR-27).
                  </div>
                ) : null}

                {/* active command + countdown */}
                {activeCommand ? (
                  <div className="rounded-xl border border-sky-200 bg-sky-50/80 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2 font-mono text-xs font-semibold text-sky-900">
                        <span>{activeCommand.commandType}</span>
                        <CommandStatusBadge status={activeCommand.status} />
                      </p>
                      <p className="font-mono text-xs font-semibold text-sky-700">
                        expires in {remaining ?? COMMAND_TTL_SEC} s
                      </p>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-sky-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#2563eb] to-[#10b981] transition-all duration-200"
                        style={{ width: `${((remaining ?? 0) / COMMAND_TTL_SEC) * 100}%` }}
                      />
                    </div>
                    <p className="mt-2 text-[10.5px] text-slate-600">
                      REQUESTED → ACCEPTED → SUCCEEDED | FAILED | EXPIRED. Only one active command per AHU is allowed.
                    </p>
                  </div>
                ) : null}

                {/* run control & operating mode */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-[#e4eaf3] bg-[#f8fafd] p-3.5">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Run control
                    </p>
                    <div className="flex gap-2">
                      <Btn
                        variant="success"
                        disabled={disabledAll || stopOnly || busy !== null}
                        onClick={() => void send("START")}
                        className="flex-1 py-2"
                      >
                        <Play size={13} /> Start
                      </Btn>
                      <Btn
                        variant="danger"
                        disabled={!canControl || offline || Boolean(activeCommand) || busy !== null}
                        onClick={() => void send("STOP")}
                        className="flex-1 py-2"
                      >
                        <Square size={13} /> Stop
                      </Btn>
                    </div>
                    <p className="mt-2 text-[10.5px] text-slate-500">
                      Desired state: <span className="font-mono font-semibold text-slate-800">{desiredRunState}</span>
                    </p>
                  </div>

                  <div className="rounded-xl border border-[#e4eaf3] bg-[#f8fafd] p-3.5">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Operating mode
                    </p>
                    <div className="flex gap-2">
                      <Btn
                        variant={controlMode === "AUTO" ? "primary" : "default"}
                        disabled={disabledAll || stopOnly || busy !== null}
                        onClick={() => void send("MODE_AUTO")}
                        className="flex-1 py-2"
                      >
                        Auto
                      </Btn>
                      <Btn
                        variant={controlMode === "MANUAL" ? "primary" : "default"}
                        disabled={disabledAll || stopOnly || busy !== null}
                        onClick={() => void send("MODE_MANUAL")}
                        className="flex-1 py-2"
                      >
                        Manual
                      </Btn>
                    </div>
                    <p className="mt-2 text-[10.5px] text-slate-500">
                      Active mode: <span className="font-mono font-semibold text-slate-800">{controlMode}</span>
                    </p>
                  </div>
                </div>

                {/* setpoint */}
                <div className="rounded-xl border border-[#e4eaf3] bg-[#f8fafd] p-3.5">
                  <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                    <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      <Gauge size={13} className="text-[#1d6ef2]" /> Temperature setpoint
                    </p>
                    <p className="font-mono text-[10.5px] text-slate-500">
                      bounded {SETPOINT_MIN.toFixed(1)} – {SETPOINT_MAX.toFixed(1)} °C
                    </p>
                  </div>
                  <div className="space-y-3 sm:flex sm:flex-wrap sm:items-center sm:gap-3 sm:space-y-0">
                    <input
                      type="range"
                      min={SETPOINT_MIN}
                      max={SETPOINT_MAX}
                      step={0.5}
                      value={sp}
                      disabled={disabledAll || stopOnly}
                      onChange={(e) => setSp(Number(e.target.value))}
                      className="w-full sm:min-w-[160px] sm:flex-1"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={SETPOINT_MIN}
                          max={SETPOINT_MAX}
                          step={0.1}
                          value={sp}
                          disabled={disabledAll || stopOnly}
                          onChange={(e) => setSp(Number(e.target.value))}
                          className={cx(inputClass, "w-24 font-mono")}
                        />
                        <span className="font-mono text-base font-bold text-[#1d6ef2]">{sp.toFixed(1)} °C</span>
                      </div>
                      <Btn
                        variant="primary"
                        disabled={disabledAll || stopOnly || busy !== null || sp < SETPOINT_MIN || sp > SETPOINT_MAX}
                        onClick={() => void send("SETPOINT", { setpoint: Number(sp.toFixed(1)) })}
                        className="w-full sm:w-auto"
                      >
                        <Power size={13} /> Apply setpoint
                      </Btn>
                    </div>
                  </div>
                  <p className="mt-2.5 text-[10.5px] leading-relaxed text-slate-500">
                    Current setpoint: <span className="font-mono font-semibold text-slate-800">{setpoint.toFixed(1)} °C</span>.
                    Out of scope: calendar schedules, lead-lag sequencing, direct actuator overrides and protection
                    reset commands.
                  </p>
                </div>

                {error ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {error}
                  </div>
                ) : null}
                {info ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    {info}
                  </div>
                ) : null}

                {!canControl ? (
                  <p className="text-[11px] text-slate-500">
                    Your role is read-only for control. Admin, Engineering and Operator roles may send commands (FR-02).
                  </p>
                ) : null}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <Btn
        size={compact ? "sm" : "md"}
        variant="primary"
        onClick={() => setOpen(true)}
        disabled={!canControl}
        title={canControl ? `Open ${ahuId} control panel (FR-25)` : "Your role may not send control commands"}
      >
        <Settings size={compact ? 13 : 14} /> Control panel
      </Btn>
      {modal}
    </>
  );
}
