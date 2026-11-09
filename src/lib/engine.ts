import { SETPOINT_MAX, SETPOINT_MIN } from "@/lib/domain";
import { publishRealtime } from "@/lib/realtime";
import type { AhuRow, AlarmPriority } from "@/lib/types";
import type { RtdbAdapter } from "@/lib/rtdb/store";
import {
  acceptPendingRtdb,
  auditRtdb,
  confirmFromReadingRtdb,
  createCommandRtdb,
  evaluateCommunicationAlarmRtdb,
  evaluateFaultAlarmRtdb,
  evaluateThresholdAlarmsRtdb,
  expireStaleRtdb,
  failActiveCommandsRtdb,
  raiseAlarmRtdb,
  resolveAlarmRtdb,
} from "@/lib/rtdb/lifecycle";
import { readActiveAlarmRecords } from "@/lib/rtdb/alarms";
import { patchRtdbAhu, readRtdbAhu, readRtdbEnabledSourceTypes, readRtdbThresholds } from "@/lib/rtdb/registry";
import { tryGetAhuRtdb } from "@/lib/rtdb/live-read";

/**
 * FR-13/25/26/27 command & alarm runtime — Phase 5c: Firebase RTDB is the
 * only store. Every function here executes natively against RTDB (see
 * src/lib/rtdb/lifecycle.ts); an unconfigured environment is a fatal error,
 * not a silent fallback.
 */

export const COMMAND_TYPES = ["START", "STOP", "MODE_AUTO", "MODE_MANUAL", "SETPOINT"] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

async function requireRtdb(): Promise<RtdbAdapter> {
  const rtdb = await tryGetAhuRtdb();
  if (!rtdb) throw new Error("Firebase RTDB is not configured");
  return rtdb;
}

/* ------------------------------------------------------------------ */
/* Alarm primitives (FR-13)                                            */
/* ------------------------------------------------------------------ */

export async function raiseAlarm(
  rtdb: RtdbAdapter,
  input: {
    ahuId: string;
    parameter: string;
    priority: AlarmPriority;
    message: string;
    breachDirection?: string | null;
    observedValue?: number | null;
    thresholdValue?: number | null;
    triggeredAt?: Date;
  },
): Promise<string> {
  return raiseAlarmRtdb(rtdb, {
    ahuId: input.ahuId,
    parameter: input.parameter,
    priority: input.priority,
    message: input.message,
    breachDirection: input.breachDirection ?? null,
    observedValue: input.observedValue ?? null,
    thresholdValue: input.thresholdValue ?? null,
    triggeredAt: input.triggeredAt?.getTime(),
  });
}

export async function resolveAlarm(
  rtdb: RtdbAdapter,
  ahuId: string,
  parameter: string,
  breachDirection?: string | null,
): Promise<number> {
  return resolveAlarmRtdb(rtdb, ahuId, parameter, breachDirection ?? null);
}

export async function evaluateThresholdAlarms(
  rtdb: RtdbAdapter,
  ahu: AhuRow,
  values: Record<string, number | null>,
  ts: Date,
): Promise<void> {
  const thresholds = await readRtdbThresholds(rtdb, ahu.id);
  await evaluateThresholdAlarmsRtdb(rtdb, ahu as never, thresholds, values, ts.getTime());
}

export async function evaluateFaultAlarm(rtdb: RtdbAdapter, ahu: AhuRow, faultCode: string | null, ts: Date): Promise<void> {
  await evaluateFaultAlarmRtdb(rtdb, ahu as never, faultCode, ts.getTime());
}

export async function evaluateCommunicationAlarm(ahu: AhuRow, ageSec: number | null): Promise<void> {
  const rtdb = await requireRtdb();
  await evaluateCommunicationAlarmRtdb(rtdb, ahu as never, ageSec);
}

export async function hasActiveCriticalAlarm(ahuId: string): Promise<boolean> {
  const rtdb = await requireRtdb();
  const active = await readActiveAlarmRecords(rtdb);
  return active.some((a) => a.ahuId === ahuId && a.isActive && a.priority === "CRITICAL");
}

/* ------------------------------------------------------------------ */
/* Status sweep                                                        */
/* ------------------------------------------------------------------ */

export async function refreshAhuStatus(ahuId: string, now = new Date()) {
  const rtdb = await requireRtdb();
  const ahuRecord = await readRtdbAhu(rtdb, ahuId);
  if (!ahuRecord) return null;
  const { latest, computed } = await (await import("@/lib/rtdb/lifecycle")).computeRtdbAhuStatus(rtdb, ahuRecord, now.getTime());
  if (computed.status !== ahuRecord.currentStatus) {
    await patchRtdbAhu(rtdb, ahuId, { currentStatus: computed.status });
    await publishRealtime("status", ahuId, { ahuId, status: computed.status, at: now.toISOString() });
  }
  if (computed.status === "FAULT") {
    await failActiveCommandsRtdb(rtdb, ahuId, {
      nonStopOnly: true,
      reason: latest?.faultCode
        ? `Aborted: controller entered FAULT (${latest.faultCode}) during command execution (FR-27)`
        : "Aborted: critical alarm put unit into FAULT during command execution (FR-27)",
      now: now.getTime(),
    });
  }
  await evaluateCommunicationAlarmRtdb(rtdb, ahuRecord, computed.ageSec, now.getTime());
  return { status: computed.status, ageSec: computed.ageSec, lastSeenAt: latest ? new Date(latest.timestamp) : null };
}

/** PHYSICAL wins over SIMULATION when both have enabled devices (RTDB-native). */
export async function readAuthoritativeSource(
  rtdb: RtdbAdapter,
  ahuId: string,
): Promise<"PHYSICAL" | "SIMULATION" | null> {
  const sources = await readRtdbEnabledSourceTypes(rtdb, ahuId);
  if (sources.includes("PHYSICAL")) return "PHYSICAL";
  if (sources.includes("SIMULATION")) return "SIMULATION";
  return null;
}

/* ------------------------------------------------------------------ */
/* Command lifecycle (FR-25/26/27)                                     */
/* ------------------------------------------------------------------ */

export async function failActiveCommands(
  rtdb: RtdbAdapter,
  ahuId: string,
  opts: {
    reason: string;
    nonStopOnly?: boolean;
    revertDesiredState?: boolean;
    userId?: string | null;
    userEmail?: string | null;
    ipAddress?: string | null;
    now?: Date;
  },
): Promise<string[]> {
  return failActiveCommandsRtdb(rtdb, ahuId, {
    reason: opts.reason,
    nonStopOnly: opts.nonStopOnly,
    revertDesiredState: opts.revertDesiredState,
    userId: opts.userId ?? null,
    userEmail: opts.userEmail ?? null,
    ipAddress: opts.ipAddress ?? null,
    now: opts.now?.getTime(),
  });
}

/**
 * FR-29 source transition (device enabled/disabled/provisioned/removed):
 * clears breach timers, resets the fault code, resolves stale non-COMM
 * alarms and fails active non-expired commands — all RTDB-native.
 */
export async function reconcileAhuSourceTransition(
  rtdb: RtdbAdapter,
  input: {
    ahuId: string;
    prevSource: "PHYSICAL" | "SIMULATION" | null;
    nextSource: "PHYSICAL" | "SIMULATION" | null;
    userId?: string | null;
    userEmail?: string | null;
    ipAddress?: string | null;
    now?: Date;
  },
): Promise<{ timersCleared: number; alarmsResolved: number; commandsFailed: number }> {
  if (input.prevSource === input.nextSource) {
    return { timersCleared: 0, alarmsResolved: 0, commandsFailed: 0 };
  }
  const now = input.now ?? new Date();

  await (async () => {
    const { removeRtdbBreachTimersForAhu } = await import("@/lib/rtdb/alarms");
    await removeRtdbBreachTimersForAhu(rtdb, input.ahuId);
  })();
  await patchRtdbAhu(rtdb, input.ahuId, { faultCode: null });

  const active = await readActiveAlarmRecords(rtdb);
  const stale = active.filter((a) => a.ahuId === input.ahuId && a.parameter !== "COMMUNICATION");
  let alarmsResolved = 0;
  for (const alarm of stale) {
    await resolveAlarmRtdb(rtdb, input.ahuId, alarm.parameter, alarm.breachDirection, now.getTime());
    alarmsResolved += 1;
  }

  const failed = await failActiveCommandsRtdb(rtdb, input.ahuId, {
    reason: `Aborted: authoritative source changed from ${input.prevSource ?? "none"} to ${input.nextSource ?? "none"} (FR-29)`,
    revertDesiredState: false,
    userId: input.userId ?? null,
    userEmail: input.userEmail ?? null,
    ipAddress: input.ipAddress ?? null,
    now: now.getTime(),
  });

  await auditRtdb(rtdb, {
    userId: input.userId ?? null,
    userEmail: input.userEmail ?? null,
    action: "SOURCE_TRANSITION",
    entity: `ahu:${input.ahuId}`,
    ipAddress: input.ipAddress ?? null,
    details: {
      ahuId: input.ahuId,
      prevSource: input.prevSource,
      nextSource: input.nextSource,
      alarmsResolved,
      commandsFailed: failed.length,
    },
  });

  return { timersCleared: 1, alarmsResolved, commandsFailed: failed.length };
}

export async function expireStaleCommands(now = new Date()): Promise<number> {
  const rtdb = await requireRtdb();
  return expireStaleRtdb(rtdb, now.getTime());
}

export async function confirmCommandsFromReading(
  rtdb: RtdbAdapter,
  ahuId: string,
  reading: { runState: string | null; fanSpeed: number | null },
  echo: { setpoint: number | null; controlMode: string | null },
  ts: Date,
): Promise<string[]> {
  return confirmFromReadingRtdb(rtdb, ahuId, reading, echo, ts.getTime());
}

export interface CommandRequest {
  ahuId: string;
  commandType: CommandType;
  payload?: { setpoint?: number };
  userId: string;
  userEmail: string;
  ipAddress: string | null;
}

export type CommandOutcome =
  | { ok: true; commandId: string; status: string }
  | { ok: false; status: number; error: string; code?: string };

export async function createCommand(req: CommandRequest): Promise<CommandOutcome> {
  if (!COMMAND_TYPES.includes(req.commandType)) {
    return { ok: false, status: 400, error: `Unsupported command type "${req.commandType}"` };
  }
  if (req.commandType === "SETPOINT") {
    const sp = req.payload?.setpoint;
    if (typeof sp !== "number" || Number.isNaN(sp) || sp < SETPOINT_MIN || sp > SETPOINT_MAX) {
      return {
        ok: false,
        status: 400,
        error: `Setpoint must be a number between ${SETPOINT_MIN.toFixed(1)} and ${SETPOINT_MAX.toFixed(1)} °C`,
      };
    }
  }
  const rtdb = await requireRtdb();
  await expireStaleRtdb(rtdb);
  return createCommandRtdb(rtdb, req);
}

export async function acceptPendingCommands(ahuId: string): Promise<Array<{ id: string }>> {
  const rtdb = await requireRtdb();
  const ids = await acceptPendingRtdb(rtdb, ahuId, Date.now());
  return ids.map((id) => ({ id }));
}
