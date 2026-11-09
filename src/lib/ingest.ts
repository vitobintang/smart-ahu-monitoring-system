import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { alarmBreachTimers, ahus, alarms, devices, sensorThresholds, telemetry } from "@/db/schema";
import type { AhuRow } from "@/db/schema";
import { PARAM_KEYS, PARAM_MAP, computeAhuStatus, type ParamKey } from "@/lib/domain";
import { publishRealtime } from "@/lib/realtime";
import { authoritativeTelemetry } from "@/lib/source";
import {
  confirmCommandsFromReading,
  evaluateFaultAlarm,
  evaluateThresholdAlarms,
  failActiveCommands,
  resolveAlarm,
} from "@/lib/engine";

type Client = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/* ------------------------------------------------------------------ */
/* FR-22 / FR-23 / NFR-04: telemetry ingestion                        */
/* ------------------------------------------------------------------ */
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
/* FR-22 / FR-23 / NFR-04: telemetry ingestion                        */
/* ------------------------------------------------------------------ */

export async function ingestTelemetry(token: string, payload: TelemetryPayload, exec: Client = db): Promise<IngestResult> {
  const deviceRows = await exec.select().from(devices).where(eq(devices.token, token)).limit(1);
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
  const ahuRows = await exec.select().from(ahus).where(eq(ahus.id, ahuId)).limit(1);
  const ahu = ahuRows[0];
  if (!ahu) return { ok: false, status: 404, body: { error: `Unregistered AHU identity "${ahuId}"` } };

  const errors: string[] = [];
  const ts = payload.timestamp ? new Date(payload.timestamp) : null;
  if (!ts || Number.isNaN(ts.getTime())) errors.push("timestamp: valid ISO-8601 measurement timestamp is required");
  else if (ts.getTime() > Date.now() + 300_000) errors.push("timestamp: measurement timestamp is too far in the future");

  const messageId = payload.messageId ? String(payload.messageId).slice(0, 120) : null;
  if (payload.messageId !== undefined && messageId === null) errors.push("messageId: must be a non-empty string");

  const thresholds = await exec.select().from(sensorThresholds).where(eq(sensorThresholds.ahuId, ahuId));
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

  await exec.transaction(async (tx) => {
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
