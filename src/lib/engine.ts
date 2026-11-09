import { and, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { randomId } from "@/lib/ids";
import { db } from "@/db";
import {
  ahuCommands,
  alarmBreachTimers,
  ahus,
  alarms,
  devices,
  sensorThresholds,
  telemetry,
} from "@/db/schema";
import type { AhuRow, AlarmPriority } from "@/db/schema";
import {
  COMMAND_TTL_SEC,
  PARAM_MAP,
  SETPOINT_MAX,
  SETPOINT_MIN,
  computeAhuStatus,
  commandFeedbackMatches,
  type ParamKey,
} from "@/lib/domain";
import { publishRealtime } from "@/lib/realtime";
import { writeAudit } from "@/lib/auth";
import { authoritativeTelemetry } from "@/lib/source";
import { mirrorToRtdb } from "@/lib/rtdb/live-read";
import type { RtdbAdapter } from "@/lib/rtdb/store";
import { applyCommandStatusPatch, activeSlotFor, claimActiveCommand, writeRtdbCommand, type RtdbCommandRecord } from "@/lib/rtdb/commands";
import { applyAlarmResolve, writeRtdbAlarm, type RtdbAlarmRecord } from "@/lib/rtdb/alarms";

/**
 * Phase 2 Slice C: fire-and-forget mirror of command lifecycle transitions
 * into the RTDB command tree (src/lib/rtdb/commands.ts). Silent no-op when
 * Firebase env vars are absent (PGlite test runs stay pure PostgreSQL);
 * failures are logged and never affect the authoritative PostgreSQL path.
 */
function mirrorCommand(fn: (rtdb: RtdbAdapter) => Promise<void>): void {
  mirrorToRtdb(fn);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Client = Tx | typeof db;

export const COMMAND_TYPES = ["START", "STOP", "MODE_AUTO", "MODE_MANUAL", "SETPOINT"] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

/* ------------------------------------------------------------------ */
/* Alarms                                                             */
/* ------------------------------------------------------------------ */

async function raiseAlarm(
  client: Client,
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
) {
  const existing = await client
    .select({ id: alarms.id })
    .from(alarms)
    .where(
      and(
        eq(alarms.ahuId, input.ahuId),
        eq(alarms.parameter, input.parameter),
        eq(alarms.isActive, true),
        input.breachDirection
          ? eq(alarms.breachDirection, input.breachDirection)
          : sql`${alarms.breachDirection} is null`,
      ),
    )
    .limit(1);
  if (existing.length > 0) return existing[0].id;

  const id = randomId();
  await client.insert(alarms).values({
    id,
    ahuId: input.ahuId,
    parameter: input.parameter,
    priority: input.priority,
    message: input.message,
    breachDirection: input.breachDirection ?? null,
    observedValue: input.observedValue ?? null,
    thresholdValue: input.thresholdValue ?? null,
    isActive: true,
    triggeredAt: input.triggeredAt ?? new Date(),
  });
  await writeAudit(
    {
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
    },
    client,
  );
  const triggeredRecord: RtdbAlarmRecord = {
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
    triggeredAt: (input.triggeredAt ?? new Date()).getTime(),
    resolvedAt: null,
  };
  mirrorCommand((rtdb) => writeRtdbAlarm(rtdb, triggeredRecord));
  await publishRealtime("alarm", input.ahuId, {
    type: "ALARM_TRIGGERED",
    alarmId: id,
    ahuId: input.ahuId,
    parameter: input.parameter,
    priority: input.priority,
    message: input.message,
    at: new Date().toISOString(),
  });
  return id;
}

export async function resolveAlarm(client: Client, ahuId: string, parameter: string, breachDirection?: string | null) {
  const cond = and(
    eq(alarms.ahuId, ahuId),
    eq(alarms.parameter, parameter),
    eq(alarms.isActive, true),
    breachDirection ? eq(alarms.breachDirection, breachDirection) : sql`${alarms.breachDirection} is null`,
  );
  const rows = await client.select({ id: alarms.id }).from(alarms).where(cond);
  if (rows.length === 0) return 0;
  const resolvedAt = new Date();
  await client
    .update(alarms)
    .set({ isActive: false, resolvedAt })
    .where(inArray(alarms.id, rows.map((r) => r.id)));
  for (const row of rows) {
    await writeAudit(
      {
        action: "ALARM_RESOLVED",
        entity: `alarm:${row.id}`,
        details: { ahuId, parameter, breachDirection: breachDirection ?? null },
      },
      client,
    );
    mirrorCommand((rtdb) => applyAlarmResolve(rtdb, row.id, resolvedAt.getTime()));
  }
  return rows.length;
}

/** FR-13 threshold breach evaluation with configurable activation delay. */
export async function evaluateThresholdAlarms(
  client: Client,
  ahu: AhuRow,
  values: Record<string, number | null>,
  ts: Date,
) {
  const thresholds = await client.select().from(sensorThresholds).where(eq(sensorThresholds.ahuId, ahu.id));
  for (const th of thresholds) {
    if (!th.enabled) continue;
    const v = values[th.parameter];
    if (v === null || v === undefined) {
      await client
        .delete(alarmBreachTimers)
        .where(inArray(alarmBreachTimers.id, [`${ahu.id}:${th.parameter}:HIGH`, `${ahu.id}:${th.parameter}:LOW`]));
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
    const meta = PARAM_MAP[th.parameter as ParamKey];
    const label = meta?.label ?? th.parameter;

    if (!dir) {
      await client
        .delete(alarmBreachTimers)
        .where(inArray(alarmBreachTimers.id, [`${ahu.id}:${th.parameter}:HIGH`, `${ahu.id}:${th.parameter}:LOW`]));
      await resolveAlarm(client, ahu.id, th.parameter, "HIGH");
      await resolveAlarm(client, ahu.id, th.parameter, "LOW");
      continue;
    }

    const key = `${ahu.id}:${th.parameter}:${dir}`;
    const opposite = `${ahu.id}:${th.parameter}:${dir === "HIGH" ? "LOW" : "HIGH"}`;
    await client.delete(alarmBreachTimers).where(eq(alarmBreachTimers.id, opposite));
    await resolveAlarm(client, ahu.id, th.parameter, dir === "HIGH" ? "LOW" : "HIGH");
    await client.insert(alarmBreachTimers).values({ id: key, firstAt: ts }).onConflictDoNothing();
    const [timer] = await client.select().from(alarmBreachTimers).where(eq(alarmBreachTimers.id, key)).limit(1);
    if (!timer || (ts.getTime() - timer.firstAt.getTime()) / 1000 < th.delaySec) continue;

    await raiseAlarm(client, {
      ahuId: ahu.id,
      parameter: th.parameter,
      priority: th.priority,
      breachDirection: dir,
      observedValue: v,
      thresholdValue: limit,
      triggeredAt: ts,
      message: `${label} ${dir === "HIGH" ? "above upper" : "below lower"} limit: ${v.toFixed(
        meta?.decimals ?? 1,
      )} ${meta?.unit ?? ""} (limit ${limit} ${meta?.unit ?? ""})`,
    });
  }
}

/** FR-14: controller fault -> CRITICAL alarm; heartbeat loss -> HIGH alarm. */
export async function evaluateFaultAlarm(client: Client, ahu: AhuRow, faultCode: string | null, ts: Date) {
  if (faultCode && faultCode.trim().length > 0) {
    await raiseAlarm(client, {
      ahuId: ahu.id,
      parameter: "FAULT",
      priority: "CRITICAL",
      message: `Controller fault reported: ${faultCode}`,
      observedValue: null,
      thresholdValue: null,
      triggeredAt: ts,
    });
  } else {
    await resolveAlarm(client, ahu.id, "FAULT");
  }
}

export async function evaluateCommunicationAlarm(ahu: AhuRow, ageSec: number | null, exec: Client = db) {
  const timeout = ahu.commTimeoutSec;
  if (ageSec === null || ageSec > timeout) {
    await raiseAlarm(exec, {
      ahuId: ahu.id,
      parameter: "COMMUNICATION",
      priority: "HIGH",
      message: `Heartbeat lost — no telemetry for ${
        ageSec === null ? "an unknown period" : `${Math.round(ageSec)} s`
      } (timeout ${timeout} s)`,
    });
  } else {
    await resolveAlarm(exec, ahu.id, "COMMUNICATION");
  }
}

export async function hasActiveCriticalAlarm(ahuId: string, exec: Client = db): Promise<boolean> {
  const rows = await exec
    .select({ id: alarms.id })
    .from(alarms)
    .where(and(eq(alarms.ahuId, ahuId), eq(alarms.isActive, true), eq(alarms.priority, "CRITICAL")))
    .limit(1);
  return rows.length > 0;
}

/** Recompute and persist FR-04 status for one AHU from its latest telemetry. */
export async function refreshAhuStatus(ahuId: string, now = new Date(), exec: Client = db) {
  const ahuRows = await exec.select().from(ahus).where(eq(ahus.id, ahuId)).limit(1);
  const ahu = ahuRows[0];
  if (!ahu) return null;
  const last = await exec
    .select()
    .from(telemetry)
    .where(and(eq(telemetry.ahuId, ahuId), authoritativeTelemetry()))
    .orderBy(desc(telemetry.timestamp))
    .limit(1);
  const row = last[0];
  const critical = await hasActiveCriticalAlarm(ahuId, exec);
  const { status, ageSec } = computeAhuStatus({
    lastSeenAt: row?.timestamp ?? null,
    commTimeoutSec: ahu.commTimeoutSec,
    faultCode: row?.faultCode ?? null,
    hasCriticalAlarm: critical,
    fanSpeed: row?.fanSpeed,
    runState: row?.runState,
    now,
  });
  if (status !== ahu.currentStatus) {
    await exec.update(ahus).set({ currentStatus: status }).where(eq(ahus.id, ahuId));
    await publishRealtime("status", ahuId, { ahuId, status, at: now.toISOString() });
  }
  if (status === "FAULT") {
    await failActiveCommands(exec, ahuId, {
      nonStopOnly: true,
      reason: row?.faultCode
        ? `Aborted: controller entered FAULT (${row.faultCode}) during command execution (FR-27)`
        : "Aborted: critical alarm put unit into FAULT during command execution (FR-27)",
      now,
    });
  }
  await evaluateCommunicationAlarm(ahu, ageSec, exec);
  return { status, ageSec, lastSeenAt: row?.timestamp ?? null };
}

/* ------------------------------------------------------------------ */
/* Source transition hygiene & FR-26 FAILED command transitions       */
/* ------------------------------------------------------------------ */

export async function readAuthoritativeSource(
  client: Client,
  ahuId: string,
): Promise<"PHYSICAL" | "SIMULATION" | null> {
  const enabledRows = await client
    .select({ sourceType: devices.sourceType })
    .from(devices)
    .where(and(eq(devices.ahuId, ahuId), eq(devices.enabled, true)));
  if (enabledRows.some((d) => d.sourceType === "PHYSICAL")) return "PHYSICAL";
  if (enabledRows.some((d) => d.sourceType === "SIMULATION")) return "SIMULATION";
  return null;
}

/**
 * FR-26 / FR-27 / FR-29: Transition active (REQUESTED / ACCEPTED, non-expired)
 * commands on an AHU to FAILED, reverting unconfirmed desired state when needed
 * and recording an immutable audit entry for every transition.
 */
export async function failActiveCommands(
  client: Client,
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
) {
  const now = opts.now ?? new Date();
  const conds = [
    eq(ahuCommands.ahuId, ahuId),
    inArray(ahuCommands.status, ["REQUESTED", "ACCEPTED"]),
    gt(ahuCommands.expiresAt, now),
  ];
  if (opts.nonStopOnly) {
    conds.push(sql`${ahuCommands.commandType} <> 'STOP'`);
  }

  const candidates = await client.select().from(ahuCommands).where(and(...conds));
  if (candidates.length === 0) return [];

  const [latestReading] = opts.revertDesiredState
    ? await client
        .select({
          runState: telemetry.runState,
          fanSpeed: telemetry.fanSpeed,
          rawPayload: telemetry.rawPayload,
        })
        .from(telemetry)
        .where(and(eq(telemetry.ahuId, ahuId), authoritativeTelemetry()))
        .orderBy(desc(telemetry.timestamp))
        .limit(1)
    : [];

  const failedIds: string[] = [];
  for (const cmd of candidates) {
    const [updated] = await client
      .update(ahuCommands)
      .set({
        status: "FAILED",
        rejectionReason: opts.reason,
        updatedAt: now,
      })
      .where(
        and(
          eq(ahuCommands.id, cmd.id),
          inArray(ahuCommands.status, ["REQUESTED", "ACCEPTED"]),
          gt(ahuCommands.expiresAt, now),
        ),
      )
      .returning({ id: ahuCommands.id });
    if (!updated) continue;
    failedIds.push(updated.id);
    mirrorCommand((rtdb) =>
      applyCommandStatusPatch(rtdb, {
        id: updated.id,
        ahuId,
        status: "FAILED",
        updatedAt: now.getTime(),
        rejectionReason: opts.reason,
      }),
    );

    if (cmd.commandType === "START") {
      const fallbackRun: "RUN" | "STOP" =
        opts.revertDesiredState &&
        (latestReading?.runState === "RUN" || (latestReading?.fanSpeed ?? 0) > 2)
          ? "RUN"
          : "STOP";
      await client.update(ahus).set({ desiredRunState: fallbackRun }).where(eq(ahus.id, ahuId));
    } else if (opts.revertDesiredState) {
      const raw = (latestReading?.rawPayload ?? {}) as {
        controlMode?: string | null;
        setpoint?: number | null;
      };
      if (cmd.commandType === "STOP") {
        const wasRunning = latestReading?.runState === "RUN" || (latestReading?.fanSpeed ?? 0) > 2;
        await client
          .update(ahus)
          .set({ desiredRunState: wasRunning ? "RUN" : "STOP" })
          .where(eq(ahus.id, ahuId));
      } else if (
        (cmd.commandType === "MODE_AUTO" || cmd.commandType === "MODE_MANUAL") &&
        (raw.controlMode === "AUTO" || raw.controlMode === "MANUAL")
      ) {
        await client.update(ahus).set({ controlMode: raw.controlMode }).where(eq(ahus.id, ahuId));
      } else if (cmd.commandType === "SETPOINT" && typeof raw.setpoint === "number") {
        await client.update(ahus).set({ setpoint: raw.setpoint }).where(eq(ahus.id, ahuId));
      }
    }

    await writeAudit(
      {
        userId: opts.userId ?? null,
        userEmail: opts.userEmail ?? null,
        ipAddress: opts.ipAddress ?? null,
        action: "COMMAND_FAILED",
        entity: `command:${cmd.id}`,
        details: {
          ahuId,
          commandType: cmd.commandType,
          transition: `${cmd.status} -> FAILED`,
          reason: opts.reason,
        },
      },
      client,
    );
    await publishRealtime("command", ahuId, {
      type: "COMMAND_FAILED",
      commandId: cmd.id,
      ahuId,
      commandType: cmd.commandType,
      status: "FAILED",
      rejectionReason: opts.reason,
    });
  }
  return failedIds;
}

/**
 * Cleanly resets pending breach timers, stale controller fault codes, active
 * non-communication alarms, and incompatible in-flight commands whenever an
 * AHU's authoritative telemetry source changes (e.g. SIMULATION <-> PHYSICAL
 * or all devices disabled). Resolved alarms remain in history with full audit logs.
 */
export async function reconcileAhuSourceTransition(
  client: Client,
  input: {
    ahuId: string;
    prevSource: "PHYSICAL" | "SIMULATION" | null;
    nextSource: "PHYSICAL" | "SIMULATION" | null;
    userId?: string | null;
    userEmail?: string | null;
    ipAddress?: string | null;
    now?: Date;
  },
) {
  if (input.prevSource === input.nextSource) {
    return { timersCleared: 0, alarmsResolved: 0, commandsFailed: 0 };
  }
  const now = input.now ?? new Date();

  const deletedTimers = await client
    .delete(alarmBreachTimers)
    .where(sql`${alarmBreachTimers.id} like ${`${input.ahuId}:%`}`)
    .returning({ id: alarmBreachTimers.id });

  await client.update(ahus).set({ faultCode: null }).where(eq(ahus.id, input.ahuId));

  const staleAlarms = await client
    .select({
      id: alarms.id,
      parameter: alarms.parameter,
      breachDirection: alarms.breachDirection,
    })
    .from(alarms)
    .where(
      and(
        eq(alarms.ahuId, input.ahuId),
        eq(alarms.isActive, true),
        sql`${alarms.parameter} <> 'COMMUNICATION'`,
      ),
    );

  if (staleAlarms.length > 0) {
    await client
      .update(alarms)
      .set({ isActive: false, resolvedAt: now })
      .where(inArray(alarms.id, staleAlarms.map((a) => a.id)));
    for (const alarm of staleAlarms) {
      await writeAudit(
        {
          userId: input.userId ?? null,
          userEmail: input.userEmail ?? null,
          ipAddress: input.ipAddress ?? null,
          action: "ALARM_RESOLVED",
          entity: `alarm:${alarm.id}`,
          details: {
            ahuId: input.ahuId,
            parameter: alarm.parameter,
            breachDirection: alarm.breachDirection ?? null,
            reason: "authoritative_source_changed",
            fromSource: input.prevSource,
            toSource: input.nextSource,
          },
        },
        client,
      );
    }
  }

  let commandsFailed = 0;
  if (input.nextSource === null || input.nextSource === "PHYSICAL") {
    const failed = await failActiveCommands(client, input.ahuId, {
      reason:
        input.nextSource === "PHYSICAL"
          ? "Aborted: physical telemetry source became authoritative (physical control is locked)"
          : "Aborted: all telemetry devices for this AHU were disabled",
      revertDesiredState: true,
      userId: input.userId,
      userEmail: input.userEmail,
      ipAddress: input.ipAddress,
      now,
    });
    commandsFailed = failed.length;
  }

  return {
    timersCleared: deletedTimers.length,
    alarmsResolved: staleAlarms.length,
    commandsFailed,
  };
}

/* ------------------------------------------------------------------ */
/* FR-26 / FR-27: command lifecycle engine                            */
/* ------------------------------------------------------------------ */

export async function expireStaleCommands(now = new Date(), exec: Client = db) {
  const stale = await exec.transaction(async (tx) => {
    const stale = await tx
      .update(ahuCommands)
      .set({
        status: "EXPIRED",
        updatedAt: now,
        rejectionReason: "TTL 60 s elapsed without controller confirmation",
      })
      .where(and(inArray(ahuCommands.status, ["REQUESTED", "ACCEPTED"]), lte(ahuCommands.expiresAt, now)))
      .returning({ id: ahuCommands.id, ahuId: ahuCommands.ahuId, commandType: ahuCommands.commandType });
    for (const c of stale) {
      await writeAudit(
        {
          action: "COMMAND_EXPIRED",
          entity: `command:${c.id}`,
          details: { ahuId: c.ahuId, commandType: c.commandType, transition: "-> EXPIRED" },
        },
        tx,
      );
    }
    return stale;
  });
  for (const c of stale) {
    mirrorCommand((rtdb) =>
      applyCommandStatusPatch(rtdb, {
        id: c.id,
        ahuId: c.ahuId,
        status: "EXPIRED",
        updatedAt: now.getTime(),
        rejectionReason: "TTL 60 s elapsed without controller confirmation",
      }),
    );
  }
  return stale.length;
}

export async function confirmCommandsFromReading(
  client: Client,
  ahuId: string,
  reading: { runState: string | null; fanSpeed: number | null },
  echo: { setpoint: number | null; controlMode: string | null },
  ts: Date,
) {
  const active = await client
    .select()
    .from(ahuCommands)
    .where(and(eq(ahuCommands.ahuId, ahuId), inArray(ahuCommands.status, ["REQUESTED", "ACCEPTED"])));
  for (const cmd of active) {
    if (cmd.status !== "ACCEPTED" || ts < cmd.updatedAt || ts > cmd.expiresAt || new Date() > cmd.expiresAt)
      continue;
    const target = (cmd.payload as { setpoint?: number } | null)?.setpoint;
    const confirmed = commandFeedbackMatches(cmd.commandType, reading, echo, target);
    if (confirmed) {
      const [succeeded] = await client
        .update(ahuCommands)
        .set({ status: "SUCCEEDED", confirmedAt: ts, updatedAt: new Date() })
        .where(
          and(
            eq(ahuCommands.id, cmd.id),
            eq(ahuCommands.status, "ACCEPTED"),
            gt(ahuCommands.expiresAt, new Date()),
          ),
        )
        .returning({ id: ahuCommands.id });
      if (!succeeded) continue;
      await writeAudit(
        {
          action: "COMMAND_SUCCEEDED",
          entity: `command:${cmd.id}`,
          details: { ahuId, commandType: cmd.commandType, transition: `${cmd.status} -> SUCCEEDED` },
        },
        client,
      );
      mirrorCommand((rtdb) =>
        applyCommandStatusPatch(rtdb, {
          id: cmd.id,
          ahuId,
          status: "SUCCEEDED",
          updatedAt: Date.now(),
          confirmedAt: ts.getTime(),
        }),
      );
    }
  }
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

  await expireStaleCommands();

  const ahuRows = await db.select().from(ahus).where(eq(ahus.id, req.ahuId)).limit(1);
  const ahu = ahuRows[0];
  if (!ahu) return { ok: false, status: 404, error: `AHU ${req.ahuId} is not registered` };

  const active = await db
    .select()
    .from(ahuCommands)
    .where(and(eq(ahuCommands.ahuId, req.ahuId), inArray(ahuCommands.status, ["REQUESTED", "ACCEPTED"])))
    .limit(1);
  if (active.length > 0) {
    const remain = Math.max(0, Math.ceil((active[0].expiresAt.getTime() - Date.now()) / 1000));
    return {
      ok: false,
      status: 409,
      code: "ACTIVE_COMMAND",
      error: `Only 1 active command per AHU is allowed. A ${active[0].commandType} command is ${active[0].status} (expires in ${remain} s).`,
    };
  }

  const statusInfo = await refreshAhuStatus(req.ahuId);
  const status = statusInfo?.status ?? ahu.currentStatus;

  if (status === "OFFLINE") {
    return {
      ok: false,
      status: 409,
      code: "OFFLINE",
      error:
        "Command rejected: unit status is OFFLINE. All control commands are rejected while communication is lost (FR-27).",
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

  const now = new Date();
  const id = randomId();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${req.ahuId}, 0))`);
    const [physical] = await tx
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.ahuId, req.ahuId), eq(devices.enabled, true), eq(devices.sourceType, "PHYSICAL")))
      .limit(1);
    if (physical) return "PHYSICAL_LOCKED" as const;
    const [inserted] = await tx
      .insert(ahuCommands)
      .values({
        id,
        ahuId: req.ahuId,
        userId: req.userId,
        userEmail: req.userEmail,
        commandType: req.commandType,
        payload: req.commandType === "SETPOINT" ? { setpoint: Number(req.payload?.setpoint) } : (req.payload ?? {}),
        status: "REQUESTED",
        createdAt: now,
        expiresAt: new Date(now.getTime() + COMMAND_TTL_SEC * 1000),
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: ahuCommands.id });
    if (!inserted) return "ACTIVE_COMMAND" as const;

    if (req.commandType === "START") await tx.update(ahus).set({ desiredRunState: "RUN" }).where(eq(ahus.id, req.ahuId));
    if (req.commandType === "STOP") await tx.update(ahus).set({ desiredRunState: "STOP" }).where(eq(ahus.id, req.ahuId));
    if (req.commandType === "MODE_AUTO") await tx.update(ahus).set({ controlMode: "AUTO" }).where(eq(ahus.id, req.ahuId));
    if (req.commandType === "MODE_MANUAL") await tx.update(ahus).set({ controlMode: "MANUAL" }).where(eq(ahus.id, req.ahuId));
    if (req.commandType === "SETPOINT")
      await tx.update(ahus).set({ setpoint: Number(req.payload?.setpoint) }).where(eq(ahus.id, req.ahuId));

    await writeAudit(
      {
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
          expiresAt: new Date(now.getTime() + COMMAND_TTL_SEC * 1000).toISOString(),
        },
      },
      tx,
    );
    return "OK" as const;
  });

  if (result === "PHYSICAL_LOCKED") {
    return {
      ok: false,
      status: 403,
      code: result,
      error: "Physical control is unavailable until an independently reviewed controller integration is commissioned.",
    };
  }
  if (result === "ACTIVE_COMMAND") {
    return { ok: false, status: 409, code: result, error: "Another command is already active for this AHU." };
  }

  const commandRecord: RtdbCommandRecord = {
    id,
    ahuId: req.ahuId,
    userId: req.userId,
    userEmail: req.userEmail,
    commandType: req.commandType,
    payload:
      (req.commandType === "SETPOINT"
        ? { setpoint: Number(req.payload?.setpoint) }
        : (req.payload ?? {})) as RtdbCommandRecord["payload"],
    status: "REQUESTED",
    rejectionReason: null,
    createdAt: now.getTime(),
    updatedAt: now.getTime(),
    expiresAt: now.getTime() + COMMAND_TTL_SEC * 1000,
    confirmedAt: null,
  };
  mirrorCommand(async (rtdb) => {
    await writeRtdbCommand(rtdb, commandRecord);
    await claimActiveCommand(rtdb, req.ahuId, activeSlotFor(commandRecord), now.getTime());
  });

  await publishRealtime("command", req.ahuId, {
    type: "COMMAND_REQUESTED",
    commandId: id,
    ahuId: req.ahuId,
    commandType: req.commandType,
    status: "REQUESTED",
    expiresAt: new Date(now.getTime() + COMMAND_TTL_SEC * 1000).toISOString(),
  });
  return { ok: true, commandId: id, status: "REQUESTED" };
}

/** Used by the simulator/controller: REQUESTED -> ACCEPTED. */
export async function acceptPendingCommands(ahuId: string, exec: Client = db) {
  const pending = await exec.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ahuId}, 0))`);
    const [physical] = await tx
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.ahuId, ahuId), eq(devices.sourceType, "PHYSICAL"), eq(devices.enabled, true)))
      .limit(1);
    if (physical) return [];
    const now = new Date();
    const pending = await tx
      .update(ahuCommands)
      .set({ status: "ACCEPTED", updatedAt: now })
      .where(and(eq(ahuCommands.ahuId, ahuId), eq(ahuCommands.status, "REQUESTED"), gt(ahuCommands.expiresAt, now)))
      .returning();
    for (const cmd of pending) {
      await writeAudit(
        {
          action: "COMMAND_ACCEPTED",
          entity: `command:${cmd.id}`,
          details: { ahuId, commandType: cmd.commandType, transition: "REQUESTED -> ACCEPTED" },
        },
        tx,
      );
    }
    return pending;
  });
  for (const cmd of pending) {
    mirrorCommand((rtdb) =>
      applyCommandStatusPatch(rtdb, {
        id: cmd.id,
        ahuId,
        status: "ACCEPTED",
        updatedAt: cmd.updatedAt.getTime(),
      }),
    );
  }
  return pending;
}
