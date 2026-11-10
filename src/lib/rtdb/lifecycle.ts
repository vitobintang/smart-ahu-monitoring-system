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
import { getLatestTelemetry, writeDeviceSnapshot, type RtdbTelemetryRecord } from "./telemetry";
import { removeRtdbBreachTimersForAhu } from "./alarms";
import { writeRtdbAuditLog, type RtdbAuditRecord } from "./audit";
import { defaultAhuRecord, patchRtdbAhu, readRtdbAhu, writeRtdbAhu, readRtdbEnabledSourceTypes, readRtdbThresholds, type RtdbAhuRecord, type RtdbThresholdRecord } from "./registry";

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

export async function acceptPendingRtdb(
  rtdb: RtdbAdapter,
  ahuId: string,
  now = Date.now(),
  owner?: RtdbAdapter,
): Promise<string[]> {
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
    let ownerRtdb: RtdbAdapter | null = owner ?? null;
    if (!ownerRtdb) {
      const { tryGetOwnerRtdb } = await import("@/lib/firebase/admin");
      ownerRtdb = await tryGetOwnerRtdb();
    }
    if (ownerRtdb && (await readDaikinDevice(ownerRtdb, ahuId))) {
      const patch = commandsToControlPatch([record]);
      if (await writeDaikinControl(ownerRtdb, ahuId, patch)) {
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

export type RtdbIngestResult =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; body: { error: string; details?: string[] } };

/**
 * Device snapshot processing — the single data path.
 *
 * The sampler reads the OWNER project's verbatim devices/{id} node and hands
 * it here; the simulator fabricates the same shape. Storage is the mirrored
 * Daikin layout (deviceHistory/{id}/{date}/{key} verbatim snapshot +
 * devices/{id} live mirror update); everything downstream (threshold/fault/
 * communication alarms, status compute, command failing, simulation feedback
 * confirmation, registry patches) works off the synthesized view.
 *
 * Idempotent per device timestamp (FR-23): re-processing the same snapshot is
 * a 200 no-op. A unit discovered on the tree without app metadata is
 * auto-registered with defaults.
 */
export async function processDaikinSnapshotRtdb(
  rtdb: RtdbAdapter,
  ahuId: string,
  snapshot: Record<string, unknown>,
  now = Date.now(),
): Promise<RtdbIngestResult> {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { ok: false, status: 400, body: { error: "Invalid device snapshot" } };
  }

  const prevLatest = await getLatestTelemetry(rtdb, ahuId);
  const { written, record } = await writeDeviceSnapshot(rtdb, ahuId, snapshot);
  if (!record) {
    return { ok: false, status: 422, body: { error: "Device snapshot carries no valid timestamp field" } };
  }
  if (!written) {
    return { ok: true, status: 200, body: { duplicated: true, message: "Snapshot already processed (FR-23)", ahuId } };
  }

  // Auto-register: a device discovered on the mirror tree becomes a fleet unit.
  // (readRtdbAhu synthesizes defaults for any mirror node, so existence is
  // checked against the app-meta subtree directly.)
  if ((await rtdb.get<unknown>(`devices/${ahuId}/app`)) === null) {
    await writeRtdbAhu(rtdb, defaultAhuRecord(ahuId, now));
  }
  const ahu = await readRtdbAhu(rtdb, ahuId);
  if (!ahu) return { ok: false, status: 500, body: { error: "Failed to register discovered device" } };
  if (!ahu.enabled) {
    return { ok: true, status: 201, body: { accepted: true, paused: true, ahuId, source: record.source } };
  }

  // A comm-timeout gap resets every debounce timer (mirrors the SQL pipeline).
  if (prevLatest && record.timestamp - prevLatest.timestamp > ahu.commTimeoutSec * 1000) {
    await removeRtdbBreachTimersForAhu(rtdb, ahuId);
  }

  const thresholds = await readRtdbThresholds(rtdb, ahuId);
  const values: Record<string, number | null> = {
    roomTemp: record.roomTemp,
    supplyTemp: record.supplyTemp,
    returnTemp: record.returnTemp,
    humidity: record.humidity,
    filterDiffPressure: record.filterDiffPressure,
    fanSpeed: record.fanSpeed,
    coilTemp: record.coilTemp,
    damperPosition: record.damperPosition,
    current: record.current,
    voltage: record.voltage,
    runHours: record.runHours,
    heaterOutput: record.heaterOutput,
  };

  // Freshness: a snapshot older than the comm window is stored but treated as
  // historical — alarm engines skip it (the COMMUNICATION alarm covers the gap).
  const fresh = now - record.timestamp <= ahu.commTimeoutSec * 1000 + 60_000;
  if (fresh) {
    await evaluateThresholdAlarmsRtdb(rtdb, ahu, thresholds, values, now);
    await evaluateFaultAlarmRtdb(rtdb, ahu, record.faultCode, now);
    await resolveAlarmRtdb(rtdb, ahuId, "COMMUNICATION", null, now);
  }

  const { computed } = await computeRtdbAhuStatus(rtdb, ahu, now);
  const newStatus = computed.status;

  const statusPayload = snapshot["status"] && typeof snapshot["status"] === "object" ? (snapshot["status"] as Record<string, unknown>) : snapshot;
  const snapSetpoint = typeof statusPayload.setpoint === "number" && Number.isFinite(statusPayload.setpoint) ? statusPayload.setpoint : null;
  await patchRtdbAhu(rtdb, ahuId, {
    lastSeenAt: record.timestamp,
    faultCode: record.faultCode,
    setpoint: snapSetpoint ?? ahu.setpoint,
    currentStatus: newStatus,
  });

  if (newStatus === "FAULT") {
    await failActiveCommandsRtdb(rtdb, ahuId, {
      nonStopOnly: true,
      reason: record.faultCode
        ? `Aborted: controller entered FAULT (${record.faultCode}) during command execution (FR-27)`
        : "Aborted: critical alarm put unit into FAULT during command execution (FR-27)",
      now,
    });
  }

  // Feedback confirmation runs for EVERY fresh mirror snapshot — the mirror
  // is the device's own reported state regardless of classification
  // (simulator units AND the real bridge's live node). commandFeedbackMatches
  // decides whether an ACCEPTED command is confirmed.
  await confirmFromReadingRtdb(
    rtdb,
    ahuId,
    { runState: record.runState, fanSpeed: record.fanSpeed },
    { setpoint: snapSetpoint, controlMode: null },
    record.timestamp,
  );

  return {
    ok: true,
    status: 201,
    body: {
      accepted: true,
      ahuId,
      source: record.source,
      status: newStatus,
    },
  };
}
