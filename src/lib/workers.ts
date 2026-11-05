import { and, eq, lt, sql } from "drizzle-orm";
import { randomId } from "@/lib/ids";
import { db } from "@/db";
import { ahus, devices, sensorThresholds, syncOutbox, telemetry } from "@/db/schema";
import type { AhuRow, DeviceRow } from "@/db/schema";
import { acceptPendingCommands, expireStaleCommands, failActiveCommands, ingestTelemetry, refreshAhuStatus, runTrendDetection } from "@/lib/engine";
import { drainSyncOutbox } from "@/lib/realtime";
import { PARAM_MAP, type ParamKey } from "@/lib/domain";

/* ------------------------------------------------------------------ */
/* FR-28: built-in telemetry & control simulator                      */
/* ------------------------------------------------------------------ */

export interface SimOverride {
  forcedFault: string | null;
  commLoss: boolean;
  rejectCommands: boolean;
  rapidFilterFouling: boolean;
  humiditySpike: boolean;
  currentOverload: boolean;
}

interface SimState {
  roomTemp: number;
  supplyTemp: number;
  returnTemp: number;
  humidity: number;
  filterDp: number;
  fanSpeed: number;
  coilTemp: number;
  damper: number;
  current: number;
  voltage: number;
  runHours: number;
  heaterOutput: number;
}

const g = globalThis as typeof globalThis & {
  __simStates?: Map<string, SimState>;
  __simOverrides?: Map<string, SimOverride>;
  __workersStarted?: boolean;
  __simRunning?: boolean;
};

const simStates: Map<string, SimState> = (g.__simStates ??= new Map());
export const simOverrides: Map<string, SimOverride> = (g.__simOverrides ??= new Map());

export function getOverride(ahuId: string): SimOverride {
  const existing = simOverrides.get(ahuId);
  if (existing) return existing;
  const fresh: SimOverride = {
    forcedFault: null,
    commLoss: false,
    rejectCommands: false,
    rapidFilterFouling: false,
    humiditySpike: false,
    currentOverload: false,
  };
  simOverrides.set(ahuId, fresh);
  return fresh;
}

export function setOverride(ahuId: string, patch: Partial<SimOverride>): SimOverride {
  const cur = getOverride(ahuId);
  const next = { ...cur, ...patch };
  simOverrides.set(ahuId, next);
  return next;
}

export function resetSimulatorUnit(ahuId: string): void {
  simOverrides.delete(ahuId);
  simStates.delete(ahuId);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const noise = (amp: number) => (Math.random() * 2 - 1) * amp;
/** mean-reverting random walk */
const walk = (v: number, target: number, rate: number, amp: number, lo: number, hi: number) =>
  clamp(v + (target - v) * rate + noise(amp), lo, hi);

async function loadState(ahu: AhuRow, last: typeof telemetry.$inferSelect | undefined): Promise<SimState> {
  const cached = simStates.get(ahu.id);
  if (cached) return cached;
  const base: SimState = {
    roomTemp: last?.roomTemp ?? 24.5,
    supplyTemp: last?.supplyTemp ?? 14.5,
    returnTemp: last?.returnTemp ?? 25.5,
    humidity: last?.humidity ?? 52,
    filterDp: last?.filterDiffPressure ?? 110,
    fanSpeed: last?.fanSpeed ?? 0,
    coilTemp: last?.coilTemp ?? 12,
    damper: last?.damperPosition ?? 0,
    current: last?.current ?? 0,
    voltage: last?.voltage ?? 230,
    runHours: last?.runHours ?? Math.round(Math.random() * 4000 + 500),
    heaterOutput: last?.heaterOutput ?? 0,
  };
  simStates.set(ahu.id, base);
  return base;
}

function buildFrame(ahu: AhuRow, state: SimState, ov: SimOverride, tickSec: number): SimState {
  const running = ahu.desiredRunState === "RUN" && !ov.forcedFault;
  const faulted = Boolean(ov.forcedFault);

  const fanTarget = faulted ? 0 : running ? (ahu.controlMode === "AUTO" ? 78 : 85) : 0;
  const damperTarget = faulted ? 0 : running ? (ahu.controlMode === "AUTO" ? 72 : 90) : 0;

  state.fanSpeed = walk(state.fanSpeed, fanTarget, 0.35, 1.4, 0, 100);
  state.damper = walk(state.damper, damperTarget, 0.3, 1.2, 0, 100);

  const coolingTarget = running ? ahu.setpoint - 2.2 : state.roomTemp;
  state.coilTemp = walk(state.coilTemp, running ? 7.5 : 16, 0.25, 0.5, 2, 30);
  state.supplyTemp = walk(state.supplyTemp, coolingTarget, 0.28, 0.25, 4, 45);
  state.roomTemp = walk(state.roomTemp, running ? ahu.setpoint + 1.4 : 28.5, 0.05, 0.08, 12, 45);
  state.returnTemp = walk(state.returnTemp, (state.roomTemp * 0.7 + state.supplyTemp * 0.3), 0.2, 0.15, 5, 45);

  const humTarget = ov.humiditySpike ? 88 : running ? 52 : 62;
  state.humidity = walk(state.humidity, humTarget, ov.humiditySpike ? 0.25 : 0.06, 0.6, 5, 99);

  // Filter fouling: slow upward drift so the trend estimator has a real signal
  const fouling = ov.rapidFilterFouling ? 1.6 : 0.12;
  state.filterDp = clamp(state.filterDp + fouling + noise(0.6), 10, 900);

  const loadFactor = state.fanSpeed / 100;
  const currentTarget = ov.currentOverload ? 34 : faulted ? 0 : 2.4 + loadFactor * 13.5;
  // NOTE: never emit the 1 A / 220 V placeholder sentinels (NFR-06.5)
  let current = walk(state.current, currentTarget, 0.3, 0.25, 0, 400);
  if (Math.abs(current - 1) < 0.02) current = 1.05;
  state.current = Number(current.toFixed(2));

  let voltage = walk(state.voltage, ov.currentOverload ? 205 : 231, 0.15, 1.1, 150, 260);
  if (Math.abs(voltage - 220) < 0.05) voltage = 221.3;
  state.voltage = Number(voltage.toFixed(1));

  if (running) state.runHours += tickSec / 3600;

  const heaterTarget = ahu.hasHeater && running && state.supplyTemp < ahu.setpoint - 1.5 ? 55 : 0;
  state.heaterOutput = walk(state.heaterOutput, heaterTarget, 0.3, 2, 0, 100);

  return state;
}

async function simulateAhu(ahu: AhuRow, device: DeviceRow, tickSec: number) {
  const ov = getOverride(ahu.id);
  if (ov.commLoss) return; // heartbeat lost on purpose -> FR-14 COMMUNICATION alarm

  const lastRows = await db
    .select()
    .from(telemetry)
    .where(eq(telemetry.ahuId, ahu.id))
    .orderBy(sql`${telemetry.timestamp} desc`)
    .limit(1);
  const state = await loadState(ahu, lastRows[0]);
  buildFrame(ahu, state, ov, tickSec);
  simStates.set(ahu.id, state);

  const installed = new Set(ahu.installedSensors);
  const all: Record<ParamKey, number> = {
    roomTemp: Number(state.roomTemp.toFixed(1)),
    supplyTemp: Number(state.supplyTemp.toFixed(1)),
    returnTemp: Number(state.returnTemp.toFixed(1)),
    humidity: Number(state.humidity.toFixed(1)),
    filterDiffPressure: Math.round(state.filterDp),
    fanSpeed: Math.round(state.fanSpeed),
    coilTemp: Number(state.coilTemp.toFixed(1)),
    damperPosition: Math.round(state.damper),
    current: state.current,
    voltage: state.voltage,
    runHours: Number(state.runHours.toFixed(2)),
    heaterOutput: Math.round(state.heaterOutput),
  };
  const parameters: Record<string, number> = {};
  for (const key of Object.keys(all) as ParamKey[]) {
    if (installed.has(key)) parameters[key] = all[key];
  }

  // small chance of a dropped parameter -> NULL / UNAVAILABLE demonstration (NFR-06.2)
  if (Math.random() < 0.06) {
    const keys = Object.keys(parameters);
    if (keys.length > 4) delete parameters[keys[Math.floor(Math.random() * keys.length)]];
  }

  await ingestTelemetry(device.token, {
    ahuId: ahu.id,
    messageId: randomId(),
    timestamp: new Date().toISOString(),
    parameters,
    runState: ov.forcedFault ? "STOP" : ahu.desiredRunState === "RUN" && state.fanSpeed > 2 ? "RUN" : "STOP",
    faultCode: ov.forcedFault,
    setpoint: ahu.setpoint,
    controlMode: ahu.controlMode,
  });
}

export async function simulationTick() {
  if (g.__simRunning) return;
  g.__simRunning = true;
  const tickSec = 5;
  try {
    const allAhus = await db.select().from(ahus);
    const devs = await db
      .select()
      .from(devices)
      .where(and(eq(devices.sourceType, "SIMULATION"), eq(devices.enabled, true)));
    const physical = await db.select({ ahuId: devices.ahuId }).from(devices)
      .where(and(eq(devices.sourceType, "PHYSICAL"), eq(devices.enabled, true)));
    const physicalIds = new Set(physical.map((d) => d.ahuId));
    for (let ahu of allAhus) {
      if (physicalIds.has(ahu.id)) continue;
      const device = devs.find((d) => d.ahuId === ahu.id);
      if (!device) continue;
      // A failure on one unit must never abort the remaining units' telemetry.
      try {
        const ov = getOverride(ahu.id);
        if (ov.rejectCommands && !ov.commLoss) {
          const rejected = await failActiveCommands(db, ahu.id, {
            reason: "Rejected by controller: local selector switch / actuator NACK (FR-26)",
            revertDesiredState: true,
          });
          if (rejected.length > 0) {
            const [reloaded] = await db.select().from(ahus).where(eq(ahus.id, ahu.id)).limit(1);
            if (reloaded) ahu = reloaded;
          }
        }
        // 1) frame first -> confirms commands ACCEPTED on the previous tick (FR-27)
        await simulateAhu(ahu, device, tickSec);
        // 2) then accept newly requested commands (FR-26 lifecycle) unless controller is rejecting commands
        if (!ov.rejectCommands) {
          await acceptPendingCommands(ahu.id);
        }
      } catch (err) {
        console.error(`[simulator] ${ahu.id} tick failed:`, err instanceof Error ? err.message : err);
      }
    }
  } finally {
    g.__simRunning = false;
  }
}

/* ------------------------------------------------------------------ */
/* Monitor tick: comm timeout, command TTL, trend detection, outbox   */
/* ------------------------------------------------------------------ */

/** Trend detection is a 15/30-minute horizon analysis — a 30 s cadence is ample. */
const TREND_EVERY_N_TICKS = 3;
let monitorTickCount = 0;

export async function monitorTick() {
  const all = await db.select().from(ahus);
  monitorTickCount += 1;
  const doTrends = monitorTickCount % TREND_EVERY_N_TICKS === 0;

  // Command TTL sweep is fleet-wide, so run it once per tick (not per AHU).
  try {
    await expireStaleCommands();
  } catch (err) {
    console.error("[monitor] command TTL sweep failed:", err instanceof Error ? err.message : err);
  }

  for (const ahu of all) {
    // Isolate failures: one unhealthy unit must not stop monitoring the fleet.
    try {
      await refreshAhuStatus(ahu.id);
      if (doTrends) await runTrendDetection(ahu.id);
    } catch (err) {
      console.error(`[monitor] ${ahu.id} failed:`, err instanceof Error ? err.message : err);
    }
  }
  try {
    await drainSyncOutbox();
    // Housekeeping: the outbox is a transport queue, not the historical record
    // (FR-09 history lives in `telemetry`), so delivered/expired rows are pruned.
    await db
      .delete(syncOutbox)
      .where(
        and(
          lt(syncOutbox.createdAt, new Date(Date.now() - 15 * 60 * 1000)),
          sql`${syncOutbox.status} <> 'PENDING'`,
        ),
      );
  } catch (err) {
    console.error("[monitor] outbox maintenance failed:", err instanceof Error ? err.message : err);
  }
}

export function startWorkers() {
  if (g.__workersStarted) return;
  g.__workersStarted = true;
  const simInterval = Number(process.env.SIMULATION_INTERVAL_MS ?? 5000);
  const monitorInterval = Number(process.env.MONITOR_INTERVAL_MS ?? 10000);
  if (process.env.SIMULATION_ENABLED !== "false") {
    const t1 = setInterval(() => {
      void simulationTick().catch((e) => console.error("[simulator]", e));
    }, simInterval);
    t1.unref?.();
    void simulationTick().catch((e) => console.error("[simulator:prime]", e));
  }
  const t2 = setInterval(() => {
    void monitorTick().catch((e) => console.error("[monitor]", e));
  }, monitorInterval);
  t2.unref?.();
  void monitorTick().catch((e) => console.error("[monitor:prime]", e));
  console.log(
    `[AHU] workers started (simulation ${process.env.SIMULATION_ENABLED === "false" ? "disabled" : `every ${simInterval} ms`}, monitor every ${monitorInterval} ms)`,
  );
}

export { PARAM_MAP };