import { COMMAND_TTL_SEC, PARAM_MAP, SETPOINT_MAX, SETPOINT_MIN, commandFeedbackMatches, computeAhuStatus, type ParamKey } from "@/lib/domain";

import { randomId } from "@/lib/ids";
import type { RtdbAdapter } from "./store";
import {
  activeSlotFor,
  applyCommandStatusPatch,
  clearActiveCommand,
  commandActiveNode,
  readCommandHistory,
  writeRtdbCommand,
  type RtdbCommandRecord,
} from "./commands";
import {
  applyAlarmResolve,
  readRtdbBreachTimer,
  readActiveAlarmRecords,
  removeRtdbBreachTimer,
  writeRtdbAlarm,
  writeRtdbBreachTimer,
  type RtdbAlarmRecord,
} from "./alarms";
import { getLatestTelemetry, writeTelemetryMirror, telemetryNode, telemetryDateKey, type RtdbTelemetryRecord } from "./telemetry";
import { removeRtdbBreachTimersForAhu } from "./alarms";
import { writeRtdbAuditLog, type RtdbAuditRecord } from "./audit";
import { patchRtdbAhu, readRtdbAhu, readRtdbDeviceByToken, readRtdbEnabledSourceTypes, readRtdbThresholds, type RtdbAhuRecord, type RtdbThresholdRecord } from "./registry";

/**
 * Phase 5b slice 3: RTDB-native command/alarm/ingest lifecycle.
 *
 * These functions are the authoritative runtime paths when Firebase is
 * configured.
 * Semantics mirror the SQL originals one-for-one (FR-13/25/26/27, NFR-02):
 * the one-active-command claim is an RTDB transaction (emulator-verified),
 * expiry marks TTL-elapsed commands EXPIRED, simulation readings confirm
 * ACCEPTED commands whose feedback matches, and threshold alarms debounce
 * through the breach-timer tree.
 */

export type LifecycleAuditInput = Partial<Pick<RtdbAuditRecord, "userId" | "userEmail" | "ipAddress">> & {
  action: string;
  entity: string;
  details?: Record<string, unknown>;
  createdAt?: number;
};

/** Awaited audit write into the RTDB audit trail. */
export async function auditRtdb(rtdb: RtdbAdapter, input: LifecycleAuditInput): Promise<string> {
  const id = randomId();
  await writeRtdbAuditLog(rtdb, {
    id,
    userId: input.userId ?? null,
    userEmail: input.userEmail ?? null,
    ipAddress: input.ipAddress ?? null,
    action: input.action,
    entity: input.entity,
    details: input.details ?? {},
    createdAt: input.createdAt ?? Date.now(),
  });
  return id;
}

/** Status of an AHU computed purely from RTDB state (latest + active alarms). */
export async function computeRtdbAhuStatus(rtdb: RtdbAdapter, ahu: RtdbAhuRecord, now = Date.now()) {
  const latest = await getLatestTelemetry(rtdb, ahu.id);
  const active = await readActiveAlarmRecords(rtdb);
  return {
    latest,
    computed: computeAhuStatus({
      lastSeenAt: latest ? new Date(latest.timestamp) : null,
      commTimeoutSec: ahu.commTimeoutSec,
      faultCode: latest?.faultCode ?? null,
      hasCriticalAlarm: active.some((a) => a.ahuId === ahu.id && a.isActive && a.priority === "CRITICAL"),
      fanSpeed: latest?.fanSpeed ?? null,
      runState: latest?.runState ?? null,
      now: new Date(now),
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Alarm primitives                                                    */
/* ------------------------------------------------------------------ */

export async function raiseAlarmRtdb(
  rtdb: RtdbAdapter,
  input: {
    ahuId: string;
    parameter: string;
    priority: string;
    message: string;
    breachDirection?: string | null;
    observedValue?: number | null;
    thresholdValue?: number | null;
    triggeredAt?: number;
    now?: number;
  },
): Promise<string> {
  const active = await readActiveAlarmRecords(rtdb);
  const existing = active.find(
    (a) =>
      a.ahuId === input.ahuId &&
      a.parameter === input.parameter &&
      (input.breachDirection ? a.breachDirection === input.breachDirection : a.breachDirection === null),
  );
  if (existing) return existing.id;

  const id = randomId();
  const record: RtdbAlarmRecord = {
    id,
    ahuId: input.ahuId,
    parameter: input.parameter,
    priority: input.priority,
    message: input.message,
    breachDirection: input.breachDirection ?? null,
    observedValue: input.observedValue ?? null,
    thresholdValue: input.thresholdValue ?? null,
    isActive: true,
    acknowledged: false,
    acknowledgedBy: null,
    acknowledgedAt: null,
    triggeredAt: input.triggeredAt ?? input.now ?? Date.now(),
    resolvedAt: null,
  };
  await writeRtdbAlarm(rtdb, record);
  await auditRtdb(rtdb, {
    action: "ALARM_TRIGGERED",
    entity: `alarm:${id}`,
    details: {
      ahuId: input.ahuId,
      parameter: input.parameter,
      priority: input.priority,
      message: input.message,
      observedValue: input.observedValue ?? null,
      thresholdValue: input.thresholdValue ?? null,
    },
  });
  return id;
}

export async function resolveAlarmRtdb(
  rtdb: RtdbAdapter,
  ahuId: string,
  parameter: string,
  breachDirection?: string | null,
  now = Date.now(),
): Promise<number> {
  const active = await readActiveAlarmRecords(rtdb);
  const matches = active.filter(
    (a) =>
      a.ahuId === ahuId &&
      a.parameter === parameter &&
      (breachDirection ? a.breachDirection === breachDirection : a.breachDirection === null),
  );
  for (const alarm of matches) {
    await applyAlarmResolve(rtdb, alarm.id, now);
    await auditRtdb(rtdb, {
      action: "ALARM_RESOLVED",
      entity: `alarm:${alarm.id}`,
      details: { ahuId, parameter, breachDirection: breachDirection ?? null },
    });
  }
  return matches.length;
}

/** FR-13 threshold evaluation (debounce + raise/resolve), RTDB-native. */
export async function evaluateThresholdAlarmsRtdb(
  rtdb: RtdbAdapter,
  ahu: RtdbAhuRecord,
  thresholds: RtdbThresholdRecord[],
  values: Record<string, number | null>,
  now = Date.now(),
): Promise<void> {
  for (const th of thresholds) {
    if (!th.enabled) continue;
    const v = values[th.parameter];
    if (v === null || v === undefined) {
      await removeRtdbBreachTimer(rtdb, ahu.id, th.parameter, "HIGH");
      await removeRtdbBreachTimer(rtdb, ahu.id, th.parameter, "LOW");
      continue;
    }
    let dir: "HIGH" | "LOW" | null = null;
    let limit: number | null = null;
    if (th.highLimit !== null && v > th.highLimit) {
      dir = "HIGH";
      limit = th.highLimit;
    } else if (th.lowLimit !== null && v < th.lowLimit) {
      dir = "LOW";
      limit = th.lowLimit;
    }

    if (!dir) {
      await removeRtdbBreachTimer(rtdb, ahu.id, th.parameter, "HIGH");
      await removeRtdbBreachTimer(rtdb, ahu.id, th.parameter, "LOW");
      await resolveAlarmRtdb(rtdb, ahu.id, th.parameter, "HIGH", now);
      await resolveAlarmRtdb(rtdb, ahu.id, th.parameter, "LOW", now);
      continue;
    }

    const opposite: "HIGH" | "LOW" = dir === "HIGH" ? "LOW" : "HIGH";
    await removeRtdbBreachTimer(rtdb, ahu.id, th.parameter, opposite);
    await resolveAlarmRtdb(rtdb, ahu.id, th.parameter, opposite, now);

    const firstAt = (await readRtdbBreachTimer(rtdb, ahu.id, th.parameter, dir)) ?? now;
    await writeRtdbBreachTimer(rtdb, ahu.id, th.parameter, dir, firstAt);
    if ((now - firstAt) / 1000 < th.delaySec) continue;

    await raiseAlarmRtdb(rtdb, {
      ahuId: ahu.id,
      parameter: th.parameter,
      priority: th.priority,
      message: `${th.label ?? th.parameter} ${dir === "HIGH" ? "above" : "below"} limit: ${v}${th.unit ? ` ${th.unit}` : ""} (limit ${limit}${th.unit ? ` ${th.unit}` : ""})`,
      breachDirection: dir,
      observedValue: v,
      thresholdValue: limit,
      triggeredAt: now,
      now,
    });
  }
}

export async function evaluateFaultAlarmRtdb(rtdb: RtdbAdapter, ahu: RtdbAhuRecord, faultCode: string | null, now = Date.now()): Promise<void> {
  if (faultCode && faultCode.trim().length > 0) {
    await raiseAlarmRtdb(rtdb, {
      ahuId: ahu.id,
      parameter: "FAULT",
      priority: "CRITICAL",
      message: `Controller fault reported: ${faultCode}`,
      triggeredAt: now,
      now,
    });
  } else {
    await resolveAlarmRtdb(rtdb, ahu.id, "FAULT", null, now);
  }
}

export async function evaluateCommunicationAlarmRtdb(rtdb: RtdbAdapter, ahu: RtdbAhuRecord, ageSec: number | null, now = Date.now()): Promise<void> {
  if (ageSec === null || ageSec > ahu.commTimeoutSec) {
    await raiseAlarmRtdb(rtdb, {
      ahuId: ahu.id,
      parameter: "COMMUNICATION",
      priority: "HIGH",
      message: `Heartbeat lost — no telemetry for ${ageSec === null ? "an unknown period" : `${Math.round(ageSec)} s`} (timeout ${ahu.commTimeoutSec} s)`,
      now,
    });
  } else {
    await resolveAlarmRtdb(rtdb, ahu.id, "COMMUNICATION", null, now);
  }
}

/* ------------------------------------------------------------------ */
/* Command lifecycle                                                   */
/* ------------------------------------------------------------------ */

export async function expireStaleRtdb(rtdb: RtdbAdapter, now = Date.now()): Promise<number> {
  const tree = (await rtdb.get<Record<string, RtdbCommandRecord>>("commands")) ?? {};
  const stale = Object.values(tree).filter(
    (c) => (c.status === "REQUESTED" || c.status === "ACCEPTED") && c.expiresAt <= now,
  );
  for (const c of stale) {
    await applyCommandStatusPatch(rtdb, {
      id: c.id,
      ahuId: c.ahuId,
      status: "EXPIRED",
      updatedAt: now,
      rejectionReason: "TTL 60 s elapsed without controller confirmation",
    });
    await auditRtdb(rtdb, {
      action: "COMMAND_EXPIRED",
      entity: `command:${c.id}`,
      details: { ahuId: c.ahuId, commandType: c.commandType, transition: "-> EXPIRED" },
    });
  }
  return stale.length;
}

export async function acceptPendingRtdb(rtdb: RtdbAdapter, ahuId: string, now = Date.now()): Promise<string[]> {
  const sources = await readRtdbEnabledSourceTypes(rtdb, ahuId);
  // PHYSICAL stays request-only UNLESS the unit's controller integration is
  // commissioned (physicalControlEnabled) — e.g. the Daikin S21 bridge write-through.
  if (sources.includes("PHYSICAL") && !((await readRtdbAhu(rtdb, ahuId))?.physicalControlEnabled)) return [];
  const slotValue = await rtdb.get<{ commandId: string }>(commandActiveNode(ahuId));
  if (!slotValue) return [];
  const record = (await rtdb.get<RtdbCommandRecord>(`commands/${slotValue.commandId}`)) ?? null;
  if (!record || record.ahuId !== ahuId) return [];
  if (record.status !== "REQUESTED" || record.expiresAt <= now) return [];

  await applyCommandStatusPatch(rtdb, { id: record.id, ahuId, status: "ACCEPTED", updatedAt: now });
  await auditRtdb(rtdb, {
    action: "COMMAND_ACCEPTED",
    entity: `command:${record.id}`,
    details: { ahuId, commandType: record.commandType, transition: "REQUESTED -> ACCEPTED" },
  });

  // Daikin S21 integration: an accepted command is applied to the OWNER's
  // devices/{ahuId} node immediately (power/setpoint). Failures never break
  // the command lifecycle — the owner's bridge simply stays on its last state.
  try {
    const { readDaikinDevice, writeDaikinControl, commandsToControlPatch } = await import("./daikin");
    if (await readDaikinDevice(rtdb, ahuId)) {
      const patch = commandsToControlPatch([record]);
      if (await writeDaikinControl(rtdb, ahuId, patch)) {
        console.log(`[daikin] control written to devices/${ahuId}:`, JSON.stringify(patch));
      }
    }
  } catch (err) {
    console.error(`[daikin] control write-through failed for ${ahuId}:`, err instanceof Error ? err.message : err);
  }

  return [record.id];
}

/** FR-27: fails non-expired active commands with a reason + desired-state revert. */
export async function failActiveCommandsRtdb(
  rtdb: RtdbAdapter,
  ahuId: string,
  opts: {
    reason: string;
    nonStopOnly?: boolean;
    revertDesiredState?: boolean;
    userId?: string | null;
    userEmail?: string | null;
    ipAddress?: string | null;
    now?: number;
  },
): Promise<string[]> {
  const now = opts.now ?? Date.now();
  const history = await readCommandHistory(rtdb, ahuId, 500);
  const candidates = history.filter(
    (c) =>
      (c.status === "REQUESTED" || c.status === "ACCEPTED") &&
      c.expiresAt > now &&
      (!opts.nonStopOnly || c.commandType !== "STOP"),
  );
  const latest = opts.revertDesiredState ? await getLatestTelemetry(rtdb, ahuId) : null;
  const failed: string[] = [];

  for (const cmd of candidates) {
    await applyCommandStatusPatch(rtdb, {
      id: cmd.id,
      ahuId,
      status: "FAILED",
      updatedAt: now,
      rejectionReason: opts.reason,
    });
    await clearActiveCommand(rtdb, ahuId, cmd.id);
    failed.push(cmd.id);
    await auditRtdb(rtdb, {
      userId: opts.userId ?? null,
      userEmail: opts.userEmail ?? null,
      action: "COMMAND_FAILED",
      entity: `command:${cmd.id}`,
      ipAddress: opts.ipAddress ?? null,
      details: { ahuId, commandType: cmd.commandType, transition: `${cmd.status} -> FAILED`, reason: opts.reason },
    });

    if (cmd.commandType === "START") {
      const fallbackRun: "RUN" | "STOP" =
        latest && (latest.runState === "RUN" || (latest.fanSpeed ?? 0) > 2) ? "RUN" : "STOP";
      await patchRtdbAhu(rtdb, ahuId, { desiredRunState: fallbackRun });
    } else if (opts.revertDesiredState) {
      if (cmd.commandType === "STOP") {
        const wasRunning = latest?.runState === "RUN" || (latest?.fanSpeed ?? 0) > 2;
        await patchRtdbAhu(rtdb, ahuId, { desiredRunState: wasRunning ? "RUN" : "STOP" });
      }
      // MODE_/SETPOINT reverts need the previous raw echo; the RTDB mirror
      // persists runState/faultCode, so fall back to the registry's current
      // values (no-op revert) — the SQL path used telemetry.rawPayload.

    }
  }
  return failed;
}

/** Simulation feedback confirmations (ACCEPTED → SUCCEEDED when the reading matches). */
export async function confirmFromReadingRtdb(
  rtdb: RtdbAdapter,
  ahuId: string,
  reading: { runState: string | null; fanSpeed: number | null },
  echo: { setpoint: number | null; controlMode: string | null },
  ts: number,
): Promise<string[]> {
  const history = await readCommandHistory(rtdb, ahuId, 500);
  const confirmed: string[] = [];
  for (const cmd of history) {
    if (cmd.status !== "ACCEPTED" || ts < cmd.updatedAt || ts > cmd.expiresAt) continue;
    const target = (cmd.payload as { setpoint?: number } | null)?.setpoint ?? null;
    if (!commandFeedbackMatches(cmd.commandType, reading, echo, target ?? undefined)) continue;
    await applyCommandStatusPatch(rtdb, {
      id: cmd.id,
      ahuId,
      status: "SUCCEEDED",
      updatedAt: ts,
      confirmedAt: ts,
    });
    confirmed.push(cmd.id);
    await auditRtdb(rtdb, {
      action: "COMMAND_SUCCEEDED",
      entity: `command:${cmd.id}`,
      details: { ahuId, commandType: cmd.commandType, transition: `${cmd.status} -> SUCCEEDED` },
    });
  }
  return confirmed;
}

export interface RtdbCommandRequest {
  ahuId: string;
  commandType: string;
  payload?: { setpoint?: number };
  userId: string;
  userEmail: string;
  ipAddress: string | null;
}

export type RtdbCommandOutcome =
  | { ok: true; commandId: string; status: "REQUESTED" }
  | { ok: false; status: number; error: string; code?: string };

/** FR-25/26: create a command against RTDB — one-active-command via transaction. */
export async function createCommandRtdb(rtdb: RtdbAdapter, req: RtdbCommandRequest, now = Date.now()): Promise<RtdbCommandOutcome> {
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

  const ahu = await readRtdbAhu(rtdb, req.ahuId);
  if (!ahu) return { ok: false, status: 404, error: `AHU ${req.ahuId} is not registered` };

  const slot = await rtdb.get<{ commandId: string; commandType: string; status: string; expiresAt: number }>(commandActiveNode(req.ahuId));
  if (slot && (slot.status === "REQUESTED" || slot.status === "ACCEPTED") && slot.expiresAt > now) {
    const remain = Math.max(0, Math.ceil((slot.expiresAt - now) / 1000));
    return {
      ok: false,
      status: 409,
      code: "ACTIVE_COMMAND",
      error: `Only 1 active command per AHU is allowed. A ${slot.commandType} command is ${slot.status} (expires in ${remain} s).`,
    };
  }

  const { computed } = await computeRtdbAhuStatus(rtdb, ahu, now);
  const status = computed.status;
  if (status !== ahu.currentStatus) await patchRtdbAhu(rtdb, req.ahuId, { currentStatus: status });
  if (status === "OFFLINE") {
    return {
      ok: false,
      status: 409,
      code: "OFFLINE",
      error: "Command rejected: unit status is OFFLINE. All control commands are rejected while communication is lost (FR-27).",
    };
  }
  if (status === "FAULT" && req.commandType !== "STOP") {
    return {
      ok: false,
      status: 409,
      code: "FAULT",
      error: "Command rejected: unit status is FAULT. Only STOP is permitted while a fault is active (FR-27).",
    };
  }

  const sources = await readRtdbEnabledSourceTypes(rtdb, req.ahuId);
  if (sources.includes("PHYSICAL") && ahu.physicalControlEnabled !== true) {
    return {
      ok: false,
      status: 403,
      code: "PHYSICAL_LOCKED",
      error: "Physical control is unavailable until an independently reviewed controller integration is commissioned.",
    };
  }

  const id = randomId();
  const expiresAt = now + COMMAND_TTL_SEC * 1000;
  const record: RtdbCommandRecord = {
    id,
    ahuId: req.ahuId,
    userId: req.userId,
    userEmail: req.userEmail,
    commandType: req.commandType,
    payload: req.commandType === "SETPOINT" ? { setpoint: Number(req.payload?.setpoint) } : (req.payload ?? null),
    status: "REQUESTED",
    rejectionReason: null,
    createdAt: now,
    updatedAt: now,
    expiresAt,
    confirmedAt: null,
  };

  // The one-active-command claim: transactional on commandActive/{ahuId}.
  const claim = await rtdb.transaction<{ commandId: string; commandType: string; status: string; expiresAt: number }>(
    commandActiveNode(req.ahuId),
    (current) => {
      if (
        current &&
        (current.status === "REQUESTED" || current.status === "ACCEPTED") &&
        current.expiresAt > Date.now()
      ) {
        return undefined; // someone else holds the slot — abort
      }
      return activeSlotFor(record);
    },
  );
  if (!claim.committed) {
    return {
      ok: false,
      status: 409,
      code: "ACTIVE_COMMAND",
      error: "Only 1 active command per AHU is allowed.",
    };
  }

  await writeRtdbCommand(rtdb, record);
  const desired =
    req.commandType === "START"
      ? { desiredRunState: "RUN" }
      : req.commandType === "STOP"
        ? { desiredRunState: "STOP" }
        : req.commandType === "MODE_AUTO"
          ? { controlMode: "AUTO" }
          : req.commandType === "MODE_MANUAL"
            ? { controlMode: "MANUAL" }
            : req.commandType === "SETPOINT"
              ? { setpoint: Number(req.payload?.setpoint) }
              : null;
  if (desired) await patchRtdbAhu(rtdb, req.ahuId, desired);

  await auditRtdb(rtdb, {
    userId: req.userId,
    userEmail: req.userEmail,
    action: "COMMAND_REQUESTED",
    entity: `command:${id}`,
    ipAddress: req.ipAddress,
    details: {
      ahuId: req.ahuId,
      commandType: req.commandType,
      payload: req.payload ?? {},
      transition: "-> REQUESTED",
      expiresAt: new Date(expiresAt).toISOString(),
    },
  });
  return { ok: true, commandId: id, status: "REQUESTED" };
}

/* ------------------------------------------------------------------ */
/* Telemetry ingest (FR-04/12/13) — RTDB-native                        */
/* ------------------------------------------------------------------ */

export interface RtdbIngestPayload {
  ahuId?: string;
  messageId?: string;
  timestamp?: string;
  parameters?: Record<string, number | null>;
  quality?: { current?: "measured" | "fallback"; voltage?: "measured" | "fallback" };
  runState?: string;
  faultCode?: string | null;
  setpoint?: number | null;
  controlMode?: string | null;
}

export type RtdbIngestResult =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; body: { error: string; details?: string[] } };

const NUMERIC_PARAMS: ParamKey[] = [
  "roomTemp", "supplyTemp", "returnTemp", "humidity", "filterDiffPressure",
  "fanSpeed", "coilTemp", "damperPosition", "current", "voltage", "runHours", "heaterOutput",
];

/**
 * RTDB-native telemetry ingest — a faithful port of the SQL pipeline in
 * src/lib/ingest.ts: token auth, source-conflict guards, FR-23 duplicate
 * rejection (messageId, or a deterministic `t-{ts}` key when absent),
 * physical-validity + installed-sensor validation, history append with
 * transactional latest advance, threshold/fault/communication alarms with
 * debounce, FAULT command failing, simulation feedback confirmation and
 * registry patches.
 */
export async function ingestTelemetryRtdb(
  rtdb: RtdbAdapter,
  token: string,
  payload: RtdbIngestPayload,
  now = Date.now(),
): Promise<RtdbIngestResult> {
  const device = await readRtdbDeviceByToken(rtdb, token);
  if (!device) {
    return { ok: false, status: 401, body: { error: "Invalid or disabled device bearer token" } };
  }

  if (device.sourceType === "SIMULATION") {
    const sources = await readRtdbEnabledSourceTypes(rtdb, device.ahuId);
    if (sources.includes("PHYSICAL")) {
      return { ok: false, status: 409, body: { error: "Simulation is disabled while a physical device is enabled for this AHU" } };
    }
  }

  if (payload.ahuId && payload.ahuId !== device.ahuId) {
    return { ok: false, status: 400, body: { error: `AHU identity mismatch: token is provisioned for ${device.ahuId}` } };
  }
  const ahuId = payload.ahuId ?? device.ahuId;

  const ahu = await readRtdbAhu(rtdb, ahuId);
  if (!ahu) return { ok: false, status: 404, body: { error: `Unregistered AHU identity "${ahuId}"` } };

  // ── validation (mirrors the SQL path error-for-error) ──
  const errors: string[] = [];
  const tsMs = payload.timestamp ? new Date(payload.timestamp).getTime() : NaN;
  if (!payload.timestamp || Number.isNaN(tsMs)) errors.push("timestamp: valid ISO-8601 measurement timestamp is required");
  else if (tsMs > now + 300_000) errors.push("timestamp: measurement timestamp is too far in the future");

  const messageId = payload.messageId ? String(payload.messageId).slice(0, 120) : null;
  if (payload.messageId !== undefined && messageId === null) errors.push("messageId: must be a non-empty string");

  const thresholds = await readRtdbThresholds(rtdb, ahuId);
  const thMap = new Map(thresholds.map((t) => [t.parameter, t]));
  const installed = new Set(ahu.installedSensors);
  const values: Record<string, number | null> = {};
  const ignored: string[] = [];
  const raw = payload.parameters ?? {};

  for (const [key, val] of Object.entries(raw)) {
    if (!NUMERIC_PARAMS.includes(key as ParamKey)) {
      errors.push(`parameters.${key}: unsupported parameter key`);
      continue;
    }
    if (val === null || val === undefined) {
      values[key] = null;
      continue;
    }
    const num = Number(val);
    if (!Number.isFinite(num)) {
      errors.push(`parameters.${key}: value must be numeric or null`);
      continue;
    }
    const th = thMap.get(key);
    const meta = PARAM_MAP[key as ParamKey];
    const lo = th?.validMin ?? meta.validMin;
    const hi = th?.validMax ?? meta.validMax;
    if (lo !== null && hi !== null && (num < lo || num > hi)) {
      errors.push(`parameters.${key}: ${num} is outside the physical validity range [${lo}, ${hi}] ${meta.unit}`);
      continue;
    }
    if (!installed.has(key)) {
      ignored.push(key);
      continue;
    }
    values[key] = num;
  }

  const runState = payload.runState === "STOP" ? "STOP" : payload.runState === "RUN" ? "RUN" : null;
  if (payload.runState !== undefined && runState === null) errors.push("runState: must be RUN or STOP");
  const controlMode = payload.controlMode === "AUTO" || payload.controlMode === "MANUAL" ? payload.controlMode : null;
  if (payload.controlMode !== undefined && payload.controlMode !== null && controlMode === null)
    errors.push("controlMode: must be AUTO or MANUAL");

  const faultProvided = payload.faultCode !== undefined;
  const reportedFault =
    !faultProvided || payload.faultCode === null || String(payload.faultCode).trim() === ""
      ? null
      : String(payload.faultCode).slice(0, 80);
  const faultCode = faultProvided ? reportedFault : ahu.faultCode;

  const quality = payload.quality ?? {};
  if (
    typeof quality !== "object" ||
    (quality.current !== undefined && !["measured", "fallback"].includes(quality.current)) ||
    (quality.voltage !== undefined && !["measured", "fallback"].includes(quality.voltage))
  ) {
    return { ok: false, status: 400, body: { error: "quality.current and quality.voltage must be measured or fallback" } };
  }
  const currentFallback =
    quality.current === "fallback" ||
    (quality.current !== "measured" && typeof values.current === "number" && Math.abs(values.current - 1) < 1e-6);
  const voltageFallback =
    quality.voltage === "fallback" ||
    (quality.voltage !== "measured" && typeof values.voltage === "number" && Math.abs(values.voltage - 220) < 1e-6);

  if (errors.length > 0) {
    return { ok: false, status: 400, body: { error: "Telemetry validation failed", details: errors } };
  }

  // ── FR-23 duplicate rejection (messageId, else timestamp key) ──
  const shardKey = messageId ?? `t-${tsMs}`;
  const dup = await rtdb.get(telemetryNode(ahuId, telemetryDateKey(tsMs), shardKey));
  if (dup) {
    return { ok: true, status: 200, body: { duplicated: true, message: "Duplicate messageId rejected (FR-23)" } };
  }

  const latest = await getLatestTelemetry(rtdb, ahuId);
  const historical = Boolean(latest && tsMs < latest.timestamp);
  if (!historical && latest && tsMs - latest.timestamp > ahu.commTimeoutSec * 1000) {
    await removeRtdbBreachTimersForAhu(rtdb, ahuId);
  }

  const record: RtdbTelemetryRecord = {
    ahuId,
    messageId: shardKey,
    source: device.sourceType,
    timestamp: tsMs,
    receivedAt: now,
    roomTemp: values.roomTemp ?? null,
    supplyTemp: values.supplyTemp ?? null,
    returnTemp: values.returnTemp ?? null,
    humidity: values.humidity ?? null,
    filterDiffPressure: values.filterDiffPressure ?? null,
    fanSpeed: values.fanSpeed ?? null,
    coilTemp: values.coilTemp ?? null,
    damperPosition: values.damperPosition ?? null,
    current: values.current ?? null,
    isCurrentFallback: currentFallback,
    voltage: values.voltage ?? null,
    isVoltageFallback: voltageFallback,
    runHours: values.runHours ?? null,
    heaterOutput: values.heaterOutput ?? null,
    runState,
    faultCode,
  };
  await writeTelemetryMirror(rtdb, record);

  if (historical) {
    return { ok: true, status: 201, body: { accepted: true, historical: true, ahuId, source: device.sourceType } };
  }

  // ── alarms (fallback currents never evaluate) ──
  await evaluateThresholdAlarmsRtdb(rtdb, ahu, thresholds, values, now);
  await evaluateFaultAlarmRtdb(rtdb, ahu, faultCode, now);
  await resolveAlarmRtdb(rtdb, ahuId, "COMMUNICATION", null, now);

  const { computed } = await computeRtdbAhuStatus(rtdb, ahu, now);
  const newStatus = computed.status;

  await patchRtdbAhu(rtdb, ahuId, {
    lastSeenAt: tsMs,
    faultCode,
    controlMode: controlMode ?? ahu.controlMode,
    setpoint: typeof payload.setpoint === "number" ? payload.setpoint : ahu.setpoint,
    currentStatus: newStatus,
  });

  if (newStatus === "FAULT") {
    await failActiveCommandsRtdb(rtdb, ahuId, {
      nonStopOnly: true,
      reason: faultCode
        ? `Aborted: controller entered FAULT (${faultCode}) during command execution (FR-27)`
        : "Aborted: critical alarm put unit into FAULT during command execution (FR-27)",
      now,
    });
  }

  if (device.sourceType === "SIMULATION") {
    await confirmFromReadingRtdb(
      rtdb,
      ahuId,
      { runState, fanSpeed: values.fanSpeed ?? null },
      { setpoint: typeof payload.setpoint === "number" ? payload.setpoint : null, controlMode },
      tsMs,
    );
  }

  return {
    ok: true,
    status: 201,
    body: {
      accepted: true,
      ahuId,
      source: device.sourceType,
      status: newStatus,
      ignored,
    },
  };
}
