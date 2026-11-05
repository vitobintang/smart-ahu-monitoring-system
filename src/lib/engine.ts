import { and, desc, eq, gt, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
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
  trendAlerts,
} from "@/db/schema";
import type { AhuRow, AlarmPriority } from "@/db/schema";
import {
  COMMAND_TTL_SEC,
  PARAM_KEYS,
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Client = Tx | typeof db;

export const COMMAND_TYPES = ["START", "STOP", "MODE_AUTO", "MODE_MANUAL", "SETPOINT"] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export interface TelemetryPayload {
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

export interface IngestResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

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

async function resolveAlarm(client: Client, ahuId: string, parameter: string, breachDirection?: string | null) {
  const cond = and(
    eq(alarms.ahuId, ahuId),
    eq(alarms.parameter, parameter),
    eq(alarms.isActive, true),
    breachDirection ? eq(alarms.breachDirection, breachDirection) : sql`${alarms.breachDirection} is null`,
  );
  const rows = await client.select({ id: alarms.id }).from(alarms).where(cond);
  if (rows.length === 0) return 0;
  await client
    .update(alarms)
    .set({ isActive: false, resolvedAt: new Date() })
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
  }
  return rows.length;
}

/** FR-13 threshold breach evaluation with configurable activation delay. */
async function evaluateThresholdAlarms(
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

export async function evaluateCommunicationAlarm(ahu: AhuRow, ageSec: number | null) {
  const timeout = ahu.commTimeoutSec;
  if (ageSec === null || ageSec > timeout) {
    await raiseAlarm(db, {
      ahuId: ahu.id,
      parameter: "COMMUNICATION",
      priority: "HIGH",
      message: `Heartbeat lost — no telemetry for ${
        ageSec === null ? "an unknown period" : `${Math.round(ageSec)} s`
      } (timeout ${timeout} s)`,
    });
  } else {
    await resolveAlarm(db, ahu.id, "COMMUNICATION");
  }
}

export async function hasActiveCriticalAlarm(ahuId: string): Promise<boolean> {
  const rows = await db
    .select({ id: alarms.id })
    .from(alarms)
    .where(and(eq(alarms.ahuId, ahuId), eq(alarms.isActive, true), eq(alarms.priority, "CRITICAL")))
    .limit(1);
  return rows.length > 0;
}

/** Recompute and persist FR-04 status for one AHU from its latest telemetry. */
export async function refreshAhuStatus(ahuId: string, now = new Date()) {
  const ahuRows = await db.select().from(ahus).where(eq(ahus.id, ahuId)).limit(1);
  const ahu = ahuRows[0];
  if (!ahu) return null;
  const last = await db
    .select()
    .from(telemetry)
    .where(and(eq(telemetry.ahuId, ahuId), authoritativeTelemetry()))
    .orderBy(desc(telemetry.timestamp))
    .limit(1);
  const row = last[0];
  const critical = await hasActiveCriticalAlarm(ahuId);
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
    await db.update(ahus).set({ currentStatus: status }).where(eq(ahus.id, ahuId));
    await publishRealtime("status", ahuId, { ahuId, status, at: now.toISOString() });
  }
  if (status === "FAULT") {
    await failActiveCommands(db, ahuId, {
      nonStopOnly: true,
      reason: row?.faultCode
        ? `Aborted: controller entered FAULT (${row.faultCode}) during command execution (FR-27)`
        : "Aborted: critical alarm put unit into FAULT during command execution (FR-27)",
      now,
    });
  }
  await evaluateCommunicationAlarm(ahu, ageSec);
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

export async function expireStaleCommands(now = new Date()) {
  return db.transaction(async (tx) => {
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
    return stale.length;
  });
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
export async function acceptPendingCommands(ahuId: string) {
  return db.transaction(async (tx) => {
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
}

/* ------------------------------------------------------------------ */
/* FR-22 / FR-23 / NFR-04: telemetry ingestion                        */
/* ------------------------------------------------------------------ */

export async function ingestTelemetry(token: string, payload: TelemetryPayload): Promise<IngestResult> {
  const deviceRows = await db.select().from(devices).where(eq(devices.token, token)).limit(1);
  const device = deviceRows[0];
  if (!device || !device.enabled) {
    return { ok: false, status: 401, body: { error: "Invalid or disabled device bearer token" } };
  }

  if (device.sourceType === "SIMULATION") {
    const [physical] = await db
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.ahuId, device.ahuId), eq(devices.sourceType, "PHYSICAL"), eq(devices.enabled, true)))
      .limit(1);
    if (physical) {
      return {
        ok: false,
        status: 409,
        body: { error: "Simulation is disabled while a physical device is enabled for this AHU" },
      };
    }
  }

  const ahuId = payload.ahuId ?? device.ahuId;
  if (payload.ahuId && payload.ahuId !== device.ahuId) {
    return {
      ok: false,
      status: 400,
      body: { error: `AHU identity mismatch: token is provisioned for ${device.ahuId}` },
    };
  }
  const ahuRows = await db.select().from(ahus).where(eq(ahus.id, ahuId)).limit(1);
  const ahu = ahuRows[0];
  if (!ahu) return { ok: false, status: 404, body: { error: `Unregistered AHU identity "${ahuId}"` } };

  const errors: string[] = [];
  const ts = payload.timestamp ? new Date(payload.timestamp) : null;
  if (!ts || Number.isNaN(ts.getTime())) errors.push("timestamp: valid ISO-8601 measurement timestamp is required");
  else if (ts.getTime() > Date.now() + 300_000) errors.push("timestamp: measurement timestamp is too far in the future");

  const messageId = payload.messageId ? String(payload.messageId).slice(0, 120) : null;
  if (payload.messageId !== undefined && messageId === null) errors.push("messageId: must be a non-empty string");

  const thresholds = await db.select().from(sensorThresholds).where(eq(sensorThresholds.ahuId, ahuId));
  const thMap = new Map(thresholds.map((t) => [t.parameter, t]));
  const installed = new Set(ahu.installedSensors);
  const values: Record<string, number | null> = {};
  const ignored: string[] = [];
  const raw = payload.parameters ?? {};

  for (const [key, val] of Object.entries(raw)) {
    if (!PARAM_KEYS.includes(key as ParamKey)) {
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
    if (num < lo || num > hi) {
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

  if (errors.length > 0) {
    return { ok: false, status: 400, body: { error: "Telemetry validation failed", details: errors } };
  }

  if (messageId) {
    const dup = await db
      .select({ id: telemetry.id })
      .from(telemetry)
      .where(and(eq(telemetry.ahuId, ahuId), eq(telemetry.messageId, messageId)))
      .limit(1);
    if (dup.length > 0) {
      return {
        ok: true,
        status: 200,
        body: { duplicated: true, telemetryId: dup[0].id, message: "Duplicate messageId rejected (FR-23)" },
      };
    }
  } else if (ts) {
    const dup = await db
      .select({ id: telemetry.id })
      .from(telemetry)
      .where(and(eq(telemetry.ahuId, ahuId), eq(telemetry.timestamp, ts)))
      .limit(1);
    if (dup.length > 0) {
      return {
        ok: true,
        status: 200,
        body: { duplicated: true, telemetryId: dup[0].id, message: "Duplicate timestamp rejected (FR-23)" },
      };
    }
  }

  const quality = payload.quality ?? {};
  if (
    !quality ||
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

  let telemetryId = 0;
  let duplicatedTelemetryId: number | undefined;
  let sourceConflict = false;
  let historical = false;
  let newStatus: AhuRow["currentStatus"] = ahu.currentStatus;

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ahuId}, 0))`);
    const [enabledDevice] = await tx.select({ enabled: devices.enabled }).from(devices).where(eq(devices.id, device.id)).limit(1);
    const [physical] =
      device.sourceType === "SIMULATION"
        ? await tx
            .select({ id: devices.id })
            .from(devices)
            .where(and(eq(devices.ahuId, ahuId), eq(devices.sourceType, "PHYSICAL"), eq(devices.enabled, true)))
            .limit(1)
        : [];
    if (!enabledDevice?.enabled || physical) {
      sourceConflict = true;
      return;
    }
    const duplicateCondition = messageId
      ? and(eq(telemetry.ahuId, ahuId), eq(telemetry.messageId, messageId))
      : and(eq(telemetry.ahuId, ahuId), eq(telemetry.timestamp, ts as Date));
    const [duplicate] = await tx.select({ id: telemetry.id }).from(telemetry).where(duplicateCondition).limit(1);
    if (duplicate) {
      duplicatedTelemetryId = duplicate.id;
      return;
    }
    const [latest] = await tx
      .select({ timestamp: telemetry.timestamp })
      .from(telemetry)
      .where(and(eq(telemetry.ahuId, ahuId), authoritativeTelemetry()))
      .orderBy(desc(telemetry.timestamp))
      .limit(1);
    historical = Boolean(latest && (ts as Date).getTime() < latest.timestamp.getTime());
    if (!historical && latest && (ts as Date).getTime() - latest.timestamp.getTime() > ahu.commTimeoutSec * 1000) {
      await tx.delete(alarmBreachTimers).where(sql`${alarmBreachTimers.id} like ${`${ahuId}:%`}`);
    }
    const inserted = await tx
      .insert(telemetry)
      .values({
        ahuId,
        timestamp: ts as Date,
        source: device.sourceType,
        messageId,
        roomTemp: values.roomTemp ?? null,
        supplyTemp: values.supplyTemp ?? null,
        returnTemp: values.returnTemp ?? null,
        humidity: values.humidity ?? null,
        filterDiffPressure: values.filterDiffPressure ?? null,
        fanSpeed: values.fanSpeed ?? null,
        coilTemp: values.coilTemp ?? null,
        damperPosition: values.damperPosition ?? null,
        current: values.current ?? null,
        isCurrentFallback: Boolean(currentFallback),
        voltage: values.voltage ?? null,
        isVoltageFallback: Boolean(voltageFallback),
        runHours: values.runHours ?? null,
        heaterOutput: values.heaterOutput ?? null,
        runState,
        faultCode,
        rawPayload: { parameters: raw, quality, ignored, runState, controlMode, setpoint: payload.setpoint ?? null },
      })
      .returning({ id: telemetry.id });
    telemetryId = inserted[0]?.id ?? 0;
    if (historical) return;

    await tx
      .update(ahus)
      .set({
        lastSeenAt: ts as Date,
        faultCode,
        controlMode: controlMode ?? ahu.controlMode,
        setpoint: typeof payload.setpoint === "number" ? payload.setpoint : ahu.setpoint,
      })
      .where(eq(ahus.id, ahuId));

    await evaluateThresholdAlarms(
      tx,
      ahu,
      {
        ...values,
        current: currentFallback ? null : values.current,
        voltage: voltageFallback ? null : values.voltage,
      },
      ts as Date,
    );
    await evaluateFaultAlarm(tx, ahu, faultCode, ts as Date);
    await resolveAlarm(tx, ahuId, "COMMUNICATION");

    const critical = await tx
      .select({ id: alarms.id })
      .from(alarms)
      .where(and(eq(alarms.ahuId, ahuId), eq(alarms.isActive, true), eq(alarms.priority, "CRITICAL")))
      .limit(1);
    const computed = computeAhuStatus({
      lastSeenAt: ts as Date,
      commTimeoutSec: ahu.commTimeoutSec,
      faultCode,
      hasCriticalAlarm: critical.length > 0,
      fanSpeed: values.fanSpeed ?? null,
      runState,
    });
    newStatus = computed.status;
    await tx.update(ahus).set({ currentStatus: newStatus }).where(eq(ahus.id, ahuId));

    if (newStatus === "FAULT") {
      await failActiveCommands(tx, ahuId, {
        nonStopOnly: true,
        reason: faultCode
          ? `Aborted: controller entered FAULT (${faultCode}) during command execution (FR-27)`
          : "Aborted: critical alarm put unit into FAULT during command execution (FR-27)",
        now: ts as Date,
      });
    }

    if (device.sourceType === "SIMULATION") {
      await confirmCommandsFromReading(
        tx,
        ahuId,
        { runState, fanSpeed: values.fanSpeed ?? null },
        { setpoint: typeof payload.setpoint === "number" ? payload.setpoint : null, controlMode },
        ts as Date,
      );
    }
  });

  if (sourceConflict)
    return { ok: false, status: 409, body: { error: "Device was disabled or another source became authoritative" } };
  if (duplicatedTelemetryId !== undefined)
    return { ok: true, status: 200, body: { duplicated: true, telemetryId: duplicatedTelemetryId } };
  if (historical)
    return { ok: true, status: 201, body: { accepted: true, historical: true, telemetryId, ahuId, source: device.sourceType } };

  await publishRealtime("telemetry", ahuId, {
    ahuId,
    telemetryId,
    timestamp: ts?.toISOString(),
    source: device.sourceType,
    status: newStatus,
    values,
    ignored,
    fallback: { current: Boolean(currentFallback), voltage: Boolean(voltageFallback) },
    faultCode,
    runState,
  });

  return {
    ok: true,
    status: 201,
    body: {
      accepted: true,
      telemetryId,
      ahuId,
      source: device.sourceType,
      status: newStatus,
      ignoredUninstalledParameters: ignored,
      dataQualityFlags: {
        current: currentFallback ? "ESTIMATED_FALLBACK" : values.current == null ? "NULL_UNAVAILABLE" : "OK",
        voltage: voltageFallback ? "ESTIMATED_FALLBACK" : values.voltage == null ? "NULL_UNAVAILABLE" : "OK",
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* FR-16 / FR-17: Trend Proximity Estimation                          */
/* ------------------------------------------------------------------ */

export interface TrendAnalysis {
  parameter: ParamKey;
  label: string;
  unit: string;
  limitType: "HIGH" | "LOW" | null;
  limit: number | null;
  direction: "RISING" | "FALLING" | "FLAT";
  sampleCount: number;
  spanMin: number;
  sufficient: boolean;
  isReliable: boolean;
  unreliabilityReason: string | null;
  slopePerMin: number;
  r2: number;
  residualStd: number;
  currentValue: number | null;
  projectedValue: number | null;
  minutesToBreach: number | null;
  horizon: 15 | 30 | null;
  series: { t: number; v: number }[];
  projection: { t: number; v: number }[];
}

const MIN_SAMPLES = 8;
const MIN_SPAN_MIN = 5;
const MIN_R2 = 0.35;

export function computeTrendAnalyses(
  thresholds: Array<{
    parameter: string;
    trendEnabled: boolean;
    highLimit: number | null;
    lowLimit: number | null;
  }>,
  rows: Array<Record<string, unknown>>,
  now = new Date(),
): TrendAnalysis[] {
  const out: TrendAnalysis[] = [];
  for (const th of thresholds) {
    if (!th.trendEnabled) continue;
    const key = th.parameter as ParamKey;
    if (!PARAM_KEYS.includes(key)) continue;
    const meta = PARAM_MAP[key];
    const points = rows
      .map((r) => ({
        t: new Date(r.timestamp as string | number | Date).getTime(),
        v: r[key] as number | null | undefined,
      }))
      .filter(
        (p): p is { t: number; v: number } =>
          Number.isFinite(p.t) && typeof p.v === "number" && Number.isFinite(p.v),
      );

    const spanMin = points.length > 1 ? (points[points.length - 1].t - points[0].t) / 60000 : 0;
    const sufficient = points.length >= MIN_SAMPLES && spanMin >= MIN_SPAN_MIN;

    let slope = 0;
    let intercept = 0;
    let r2 = 0;
    let residualStd = 0;
    if (points.length >= 2) {
      const n = points.length;
      const sx = points.reduce((a, p) => a + p.t, 0);
      const sy = points.reduce((a, p) => a + p.v, 0);
      const sxx = points.reduce((a, p) => a + p.t * p.t, 0);
      const sxy = points.reduce((a, p) => a + p.t * p.v, 0);
      const denom = n * sxx - sx * sx;
      slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
      intercept = (sy - slope * sx) / n;
      const meanY = sy / n;
      const ssTot = points.reduce((a, p) => a + (p.v - meanY) ** 2, 0);
      const ssRes = points.reduce((a, p) => a + (p.v - (slope * p.t + intercept)) ** 2, 0);
      r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
      residualStd = Math.sqrt(ssRes / Math.max(1, n - 2));
    }
    const slopePerMin = slope * 60000;
    const lastT = points.length > 0 ? points[points.length - 1].t : now.getTime();
    const currentValue = points.length > 0 ? points[points.length - 1].v : null;

    let limitType: "HIGH" | "LOW" | null = null;
    let limit: number | null = null;
    if (slopePerMin > 1e-9 && th.highLimit !== null) {
      limitType = "HIGH";
      limit = th.highLimit;
    } else if (slopePerMin < -1e-9 && th.lowLimit !== null) {
      limitType = "LOW";
      limit = th.lowLimit;
    }

    let minutesToBreach: number | null = null;
    let projectedValue: number | null = null;
    let horizon: 15 | 30 | null = null;
    if (limit !== null && currentValue !== null && Math.abs(slopePerMin) > 1e-9) {
      const distance = limitType === "HIGH" ? limit - currentValue : currentValue - limit;
      const rate = Math.abs(slopePerMin);
      if (distance > 0) {
        const m = distance / rate;
        minutesToBreach = m;
        if (m <= 30) horizon = m <= 15 ? 15 : 30;
      } else {
        minutesToBreach = 0;
        horizon = 15;
      }
      projectedValue = currentValue + slopePerMin * (horizon ?? 30);
    } else if (currentValue !== null) {
      projectedValue = currentValue + slopePerMin * 30;
    }

    const direction: TrendAnalysis["direction"] =
      slopePerMin > 1e-6 ? "RISING" : slopePerMin < -1e-6 ? "FALLING" : "FLAT";

    let isReliable = sufficient && r2 >= MIN_R2;
    let reason: string | null = null;
    if (!sufficient) {
      isReliable = false;
      reason =
        points.length < MIN_SAMPLES
          ? `Insufficient data: ${points.length}/${MIN_SAMPLES} samples`
          : `Insufficient history: ${spanMin.toFixed(1)} min span (< ${MIN_SPAN_MIN} min)`;
    } else if (r2 < MIN_R2) {
      isReliable = false;
      reason = `Variance too high: R² ${r2.toFixed(2)} < ${MIN_R2} (residual σ ${residualStd.toFixed(2)})`;
    }

    out.push({
      parameter: key,
      label: meta.label,
      unit: meta.unit,
      limitType,
      limit,
      direction,
      sampleCount: points.length,
      spanMin: Number(spanMin.toFixed(1)),
      sufficient,
      isReliable,
      unreliabilityReason: reason,
      slopePerMin: Number(slopePerMin.toFixed(4)),
      r2: Number(r2.toFixed(3)),
      residualStd: Number(residualStd.toFixed(3)),
      currentValue: currentValue === null ? null : Number(currentValue.toFixed(meta.decimals)),
      projectedValue: projectedValue === null ? null : Number(projectedValue.toFixed(meta.decimals)),
      minutesToBreach: minutesToBreach === null ? null : Number(minutesToBreach.toFixed(1)),
      horizon,
      series: points.map((p) => ({ t: p.t, v: Number(p.v.toFixed(meta.decimals)) })),
      projection:
        currentValue !== null && horizon
          ? [
              { t: lastT, v: Number(currentValue.toFixed(meta.decimals)) },
              { t: lastT + horizon * 60000, v: Number((currentValue + slopePerMin * horizon).toFixed(meta.decimals)) },
            ]
          : [],
    });
  }
  return out;
}

export async function analyseTrends(ahuId: string, now = new Date()): Promise<TrendAnalysis[]> {
  const [ahuRows, thresholds] = await Promise.all([
    db.select().from(ahus).where(eq(ahus.id, ahuId)).limit(1),
    db
      .select()
      .from(sensorThresholds)
      .where(and(eq(sensorThresholds.ahuId, ahuId), eq(sensorThresholds.trendEnabled, true))),
  ]);
  if (!ahuRows[0] || thresholds.length === 0) return [];

  const since = new Date(now.getTime() - 45 * 60 * 1000);
  const wanted = new Set(thresholds.map((t) => t.parameter));
  const projection: Record<string, unknown> = { timestamp: telemetry.timestamp };
  for (const key of PARAM_KEYS) {
    if (wanted.has(key)) {
      projection[key] =
        key === "current"
          ? sql`case when ${telemetry.isCurrentFallback} then null else ${telemetry.current} end`.as("current")
          : key === "voltage"
            ? sql`case when ${telemetry.isVoltageFallback} then null else ${telemetry.voltage} end`.as("voltage")
            : telemetry[key];
    }
  }
  const rows = (await db
    .select(projection as never)
    .from(telemetry)
    .where(and(eq(telemetry.ahuId, ahuId), gt(telemetry.timestamp, since), authoritativeTelemetry()))
    .orderBy(telemetry.timestamp)) as unknown as Array<Record<string, unknown>>;

  return computeTrendAnalyses(thresholds, rows, now);
}

/** Batched fleet trend analysis in a single parallel DB round-trip. */
export async function analyseTrendsBatch(
  ahuIds?: string[],
  now = new Date(),
): Promise<Record<string, TrendAnalysis[]>> {
  const [ahuRows, allThresholds] = await Promise.all([
    ahuIds && ahuIds.length > 0
      ? db.select({ id: ahus.id }).from(ahus).where(inArray(ahus.id, ahuIds)).orderBy(ahus.id)
      : db.select({ id: ahus.id }).from(ahus).orderBy(ahus.id),
    ahuIds && ahuIds.length > 0
      ? db
          .select()
          .from(sensorThresholds)
          .where(and(inArray(sensorThresholds.ahuId, ahuIds), eq(sensorThresholds.trendEnabled, true)))
      : db.select().from(sensorThresholds).where(eq(sensorThresholds.trendEnabled, true)),
  ]);

  const ids = ahuRows.map((a) => a.id);
  const out: Record<string, TrendAnalysis[]> = {};
  for (const id of ids) out[id] = [];
  if (ids.length === 0 || allThresholds.length === 0) return out;

  const since = new Date(now.getTime() - 45 * 60 * 1000);
  const wanted = new Set(allThresholds.map((t) => t.parameter));
  const projection: Record<string, unknown> = {
    ahuId: telemetry.ahuId,
    timestamp: telemetry.timestamp,
  };
  for (const key of PARAM_KEYS) {
    if (wanted.has(key)) {
      projection[key] =
        key === "current"
          ? sql`case when ${telemetry.isCurrentFallback} then null else ${telemetry.current} end`.as("current")
          : key === "voltage"
            ? sql`case when ${telemetry.isVoltageFallback} then null else ${telemetry.voltage} end`.as("voltage")
            : telemetry[key];
    }
  }

  const allRows = (await db
    .select(projection as never)
    .from(telemetry)
    .where(and(inArray(telemetry.ahuId, ids), gt(telemetry.timestamp, since), authoritativeTelemetry()))
    .orderBy(telemetry.timestamp)) as unknown as Array<Record<string, unknown>>;

  const rowsByAhu = new Map<string, Array<Record<string, unknown>>>();
  for (const r of allRows) {
    const id = String(r.ahuId);
    const list = rowsByAhu.get(id) ?? [];
    list.push(r);
    rowsByAhu.set(id, list);
  }

  const thByAhu = new Map<string, typeof allThresholds>();
  for (const th of allThresholds) {
    const list = thByAhu.get(th.ahuId) ?? [];
    list.push(th);
    thByAhu.set(th.ahuId, list);
  }

  for (const id of ids) {
    out[id] = computeTrendAnalyses(thByAhu.get(id) ?? [], rowsByAhu.get(id) ?? [], now);
  }
  return out;
}

/** FR-18: persist trend warnings (deduplicated per parameter/horizon). */
export async function runTrendDetection(ahuId: string, now = new Date()) {
  const analyses = await analyseTrends(ahuId, now);
  const created: string[] = [];
  for (const a of analyses) {
    if (!a.horizon || a.minutesToBreach === null || a.minutesToBreach <= 0) continue;
    const recent = await db
      .select({ id: trendAlerts.id })
      .from(trendAlerts)
      .where(
        and(
          eq(trendAlerts.ahuId, ahuId),
          eq(trendAlerts.parameter, a.parameter),
          eq(trendAlerts.estimatedMin, a.horizon),
          gt(trendAlerts.createdAt, new Date(now.getTime() - 10 * 60 * 1000)),
        ),
      )
      .limit(1);
    if (recent.length > 0) continue;

    const id = randomId();
    await db.insert(trendAlerts).values({
      id,
      ahuId,
      parameter: a.parameter,
      estimatedMin: a.horizon,
      direction: a.direction,
      isReliable: a.isReliable,
      unreliabilityReason: a.unreliabilityReason,
      sampleCount: a.sampleCount,
      variance: a.residualStd,
      slopePerMin: a.slopePerMin,
      currentValue: a.currentValue,
      projectedValue: a.projectedValue,
      thresholdValue: a.limit,
      minutesToBreach: a.minutesToBreach,
      acknowledged: false,
      createdAt: now,
    });
    await writeAudit({
      action: "TREND_ALERT_TRIGGERED",
      entity: `trend:${id}`,
      details: {
        ahuId,
        parameter: a.parameter,
        horizon: a.horizon,
        direction: a.direction,
        reliable: a.isReliable,
        minutesToBreach: a.minutesToBreach,
      },
    });
    await publishRealtime("trend", ahuId, {
      type: "TREND_ALERT",
      trendId: id,
      ahuId,
      parameter: a.parameter,
      horizon: a.horizon,
      direction: a.direction,
      minutesToBreach: a.minutesToBreach,
      at: now.toISOString(),
    });
    created.push(id);
  }
  return created;
}

export async function listActiveAlarms(ahuIds?: string[]) {
  const cond =
    ahuIds && ahuIds.length > 0
      ? and(eq(alarms.isActive, true), inArray(alarms.ahuId, ahuIds))
      : eq(alarms.isActive, true);
  return db.select().from(alarms).where(cond).orderBy(desc(alarms.triggeredAt));
}

export { isNotNull, or };