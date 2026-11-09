import { and, eq, lt, sql } from "drizzle-orm";
import { randomId } from "@/lib/ids";
import { dbWork, isOfflineNetworkError, isTransientDbError, summarizeDbError } from "@/db";
import { ahus, devices, syncOutbox, telemetry } from "@/db/schema";
import type { AhuRow, DeviceRow } from "@/db/schema";
import { acceptPendingCommands, expireStaleCommands, failActiveCommands, refreshAhuStatus } from "@/lib/engine";
import { ingestTelemetry } from "@/lib/ingest";
import { runTrendDetection } from "@/lib/trends";
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
  __monitorRunning?: boolean;
  __workerChain?: Promise<void>;
  __lastSimTickAt?: number;
  __dbBackoffUntil?: number;
  __dbBackoffStreak?: number;
  __dbDegradedLogged?: boolean;
};

const simStates: Map<string, SimState> = (g.__simStates ??= new Map());
export const simOverrides: Map<string, SimOverride> = (g.__simOverrides ??= new Map());

function engageDbBackoff(tag: string, err: unknown): void {
  const streak = (g.__dbBackoffStreak ?? 0) + 1;
  g.__dbBackoffStreak = streak;
  const cooldownMs = Math.min(30_000, 10_000 + streak * 5_000);
  g.__dbBackoffUntil = Date.now() + cooldownMs;
  if (!g.__dbDegradedLogged || streak % 4 === 1) {
    g.__dbDegradedLogged = true;
    console.warn(
      `[${tag}] database unavailable (${summarizeDbError(err)}) — pausing background worker for ${Math.round(cooldownMs / 1000)}s`,
    );
  }
}

function clearDbBackoffIfRecovered(): void {
  if (g.__dbDegradedLogged) {
    console.log("[AHU][workers] database connectivity restored — resuming normal telemetry & monitoring cadence");
  }
  g.__dbBackoffStreak = 0;
  g.__dbBackoffUntil = 0;
  g.__dbDegradedLogged = false;
}

function isDbCircuitOpen(): boolean {
  return Boolean(g.__dbBackoffUntil && Date.now() < g.__dbBackoffUntil);
}

/** Runs background worker ticks one-at-a-time so simulator & monitor never contend for pool slots simultaneously. */
function runSerializedWorker(fn: () => Promise<void>): Promise<void> {
  const prev = g.__workerChain ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  g.__workerChain = next;
  return next;
}

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

  if (faulted) {
    state.fanSpeed = 0;
    state.damper = 0;
  } else if (running) {
    state.fanSpeed = Math.max(22, walk(state.fanSpeed, fanTarget, 0.48, 1.2, 15, 100));
    state.damper = Math.max(18, walk(state.damper, damperTarget, 0.42, 1.0, 12, 100));
  } else {
    state.fanSpeed = state.fanSpeed <= 26 ? 0 : Math.max(0, state.fanSpeed * 0.25 - 8);
    state.damper = state.damper <= 26 ? 0 : Math.max(0, state.damper * 0.25 - 8);
  }

  const coolingTarget = running ? ahu.setpoint - 2.2 : state.roomTemp;
  state.coilTemp = walk(state.coilTemp, running ? 7.5 : 16, 0.25, 0.5, 2, 30);
  state.supplyTemp = walk(state.supplyTemp, coolingTarget, 0.28, 0.25, 4, 45);
  state.roomTemp = walk(state.roomTemp, running ? ahu.setpoint + 1.4 : 28.5, 0.05, 0.08, 12, 45);
  state.returnTemp = walk(state.returnTemp, state.roomTemp * 0.7 + state.supplyTemp * 0.3, 0.2, 0.15, 5, 45);

  const humTarget = ov.humiditySpike ? 88 : running ? 52 : 62;
  state.humidity = walk(state.humidity, humTarget, ov.humiditySpike ? 0.25 : 0.06, 0.6, 5, 99);

  const fouling = ov.rapidFilterFouling ? 1.6 : 0.12;
  state.filterDp = clamp(state.filterDp + fouling + noise(0.6), 10, 900);

  const loadFactor = state.fanSpeed / 100;
  const currentTarget = ov.currentOverload ? 34 : faulted ? 0 : running ? 2.4 + loadFactor * 13.5 : 0.35;
  let current = running || ov.currentOverload ? walk(state.current, currentTarget, 0.3, 0.25, 0, 400) : currentTarget;
  if (Math.abs(current - 1) < 0.02) current = 1.05;
  state.current = Number(current.toFixed(2));

  let voltage = walk(state.voltage, ov.currentOverload ? 205 : 231, 0.15, 1.1, 150, 260);
  if (Math.abs(voltage - 220) < 0.05) voltage = 221.3;
  state.voltage = Number(voltage.toFixed(1));

  if (running) state.runHours += tickSec / 3600;

  const heaterTarget = ahu.hasHeater && running && state.supplyTemp < ahu.setpoint - 1.5 ? 55 : 0;
  state.heaterOutput = heaterTarget === 0 ? 0 : walk(state.heaterOutput, heaterTarget, 0.3, 2, 0, 100);

  return state;
}

async function simulateAhu(ahu: AhuRow, device: DeviceRow, tickSec: number) {
  const ov = getOverride(ahu.id);
  if (ov.commLoss) return;

  // Only query historical telemetry once when cold-starting simStates for this AHU!
  let lastRow: typeof telemetry.$inferSelect | undefined;
  if (!simStates.has(ahu.id)) {
    const lastRows = await dbWork
      .select()
      .from(telemetry)
      .where(eq(telemetry.ahuId, ahu.id))
      .orderBy(sql`${telemetry.timestamp} desc`)
      .limit(1);
    lastRow = lastRows[0];
  }

  const state = await loadState(ahu, lastRow);
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

  if (Math.random() < 0.06) {
    const keys = Object.keys(parameters).filter((k) => k !== "fanSpeed");
    if (keys.length > 4) delete parameters[keys[Math.floor(Math.random() * keys.length)]];
  }

  const roundedFan = Math.round(state.fanSpeed);

  await ingestTelemetry(device.token, {
    ahuId: ahu.id,
    messageId: randomId(),
    timestamp: new Date().toISOString(),
    parameters,
    runState: ov.forcedFault ? "STOP" : roundedFan > 0 ? "RUN" : "STOP",
    faultCode: ov.forcedFault,
    setpoint: ahu.setpoint,
    controlMode: ahu.controlMode,
  }, dbWork);
}

export async function simulationTick() {
  if (g.__simRunning) return;
  g.__simRunning = true;
  g.__lastSimTickAt = Date.now();
  const tickSec = 5;
  try {
    const allAhus = await dbWork.select().from(ahus);
    const devs = await dbWork
      .select()
      .from(devices)
      .where(and(eq(devices.sourceType, "SIMULATION"), eq(devices.enabled, true)));
    const physical = await dbWork
      .select({ ahuId: devices.ahuId })
      .from(devices)
      .where(and(eq(devices.sourceType, "PHYSICAL"), eq(devices.enabled, true)));
    const physicalIds = new Set(physical.map((d) => d.ahuId));

    for (let ahu of allAhus) {
      if (physicalIds.has(ahu.id)) continue;
      const device = devs.find((d) => d.ahuId === ahu.id);
      if (!device) continue;
      try {
        const ov = getOverride(ahu.id);
        if (ov.rejectCommands && !ov.commLoss) {
          const rejected = await failActiveCommands(dbWork, ahu.id, {
            reason: "Rejected by controller: local selector switch / actuator NACK (FR-26)",
            revertDesiredState: true,
          });
          if (rejected.length > 0) {
            const [reloaded] = await dbWork.select().from(ahus).where(eq(ahus.id, ahu.id)).limit(1);
            if (reloaded) ahu = reloaded;
          }
        }
        await simulateAhu(ahu, device, tickSec);
        if (!ov.rejectCommands) {
          await acceptPendingCommands(ahu.id, dbWork);
        }
      } catch (err) {
        if (isOfflineNetworkError(err) || isTransientDbError(err)) {
          engageDbBackoff("simulator", err);
          return;
        }
        console.error(`[simulator] ${ahu.id} tick failed:`, summarizeDbError(err));
      }
    }
    clearDbBackoffIfRecovered();
  } catch (err) {
    if (isOfflineNetworkError(err) || isTransientDbError(err)) {
      engageDbBackoff("simulator", err);
      return;
    }
    throw err;
  } finally {
    g.__simRunning = false;
  }
}

/* ------------------------------------------------------------------ */
/* Monitor tick: comm timeout, command TTL, trend detection, outbox   */
/* ------------------------------------------------------------------ */

const TREND_EVERY_N_TICKS = 3;
let monitorTickCount = 0;

export async function monitorTick() {
  if (g.__monitorRunning) return;
  g.__monitorRunning = true;
  try {
    const all = await dbWork.select().from(ahus);
    monitorTickCount += 1;
    const doTrends = monitorTickCount % TREND_EVERY_N_TICKS === 0;

    try {
      await expireStaleCommands(new Date(), dbWork);
    } catch (err) {
      if (isOfflineNetworkError(err) || isTransientDbError(err)) {
        engageDbBackoff("monitor", err);
        return;
      }
      console.error("[monitor] command TTL sweep failed:", summarizeDbError(err));
    }

    for (const ahu of all) {
      try {
        await refreshAhuStatus(ahu.id, new Date(), dbWork);
        if (doTrends) await runTrendDetection(ahu.id, new Date(), dbWork);
      } catch (err) {
        if (isOfflineNetworkError(err) || isTransientDbError(err)) {
          engageDbBackoff("monitor", err);
          return;
        }
        console.error(`[monitor] ${ahu.id} failed:`, summarizeDbError(err));
      }
    }

    try {
      await drainSyncOutbox();
      await dbWork
        .delete(syncOutbox)
        .where(
          and(
            lt(syncOutbox.createdAt, new Date(Date.now() - 15 * 60 * 1000)),
            sql`${syncOutbox.status} <> 'PENDING'`,
          ),
        );
    } catch (err) {
      if (isOfflineNetworkError(err) || isTransientDbError(err)) {
        engageDbBackoff("monitor", err);
        return;
      }
      console.error("[monitor] outbox maintenance failed:", summarizeDbError(err));
    }

    clearDbBackoffIfRecovered();
  } catch (err) {
    if (isOfflineNetworkError(err) || isTransientDbError(err)) {
      engageDbBackoff("monitor", err);
      return;
    }
    throw err;
  } finally {
    g.__monitorRunning = false;
  }
}

export function startWorkers() {
  if (g.__workersStarted) return;
  g.__workersStarted = true;
  const simInterval = Number(process.env.SIMULATION_INTERVAL_MS ?? 5000);
  const monitorInterval = Number(process.env.MONITOR_INTERVAL_MS ?? 10000);

  if (process.env.SIMULATION_ENABLED !== "false") {
    const t1 = setInterval(() => {
      if (isDbCircuitOpen() || g.__simRunning) return;
      void runSerializedWorker(() => simulationTick()).catch((e) =>
        console.error("[simulator]", summarizeDbError(e)),
      );
    }, simInterval);
    t1.unref?.();
    void runSerializedWorker(() => simulationTick()).catch((e) =>
      console.error("[simulator:prime]", summarizeDbError(e)),
    );
  }

  const t2 = setInterval(() => {
    if (isDbCircuitOpen() || g.__monitorRunning) return;
    void runSerializedWorker(() => monitorTick()).catch((e) =>
      console.error("[monitor]", summarizeDbError(e)),
    );
  }, monitorInterval);
  t2.unref?.();

  // Phase 3: RTDB telemetry retention — prune day shards older than
  // TELEMETRY_RETENTION_DAYS (default 30) every RETENTION_CHECK_MS (default 6 h).
  // No-op unless Firebase env vars are configured.
  const retentionDays = Number(process.env.TELEMETRY_RETENTION_DAYS ?? 30);
  const retentionCheckMs = Number(process.env.RETENTION_CHECK_MS ?? 6 * 3600_000);
  const t3 = setInterval(() => {
    void (async () => {
      const { firebaseEnvConfigured } = await import("@/lib/rtdb/live-read");
      if (!firebaseEnvConfigured()) return;
      const { getAhuRtdb } = await import("@/lib/firebase/admin");
      const { pruneTelemetryShards } = await import("@/lib/rtdb/telemetry");
      const { AHU_IDS } = await import("@/lib/domain");
      const removed = await pruneTelemetryShards(await getAhuRtdb(), AHU_IDS, retentionDays);
      if (removed > 0) console.log(`[retention] pruned ${removed} RTDB telemetry day shard(s)`);
    })().catch((e) => console.error("[retention]", e instanceof Error ? e.message : e));
  }, retentionCheckMs);
  t3.unref?.();
  void runSerializedWorker(() => monitorTick()).catch((e) =>
    console.error("[monitor:prime]", summarizeDbError(e)),
  );

  console.log(
    `[AHU] workers started (simulation ${process.env.SIMULATION_ENABLED === "false" ? "disabled" : `every ${simInterval} ms`}, monitor every ${monitorInterval} ms)`,
  );
}

/**
 * Fire-and-forget simulator kick used by interactive API routes: it enqueues a simulation tick on
 * the serialized worker chain WITHOUT awaiting it, so a dashboard/save request never blocks on a
 * full telemetry cycle (the 5 s interval keeps its own cadence; this only nudges idle periods).
 */
export function maybePulseWorkers(minIntervalMs = 4800): void {
  if (process.env.SIMULATION_ENABLED === "false") return;
  if (isDbCircuitOpen()) return;
  const last = g.__lastSimTickAt ?? 0;
  if (!g.__simRunning && Date.now() - last >= minIntervalMs) {
    void runSerializedWorker(() => simulationTick()).catch((e) =>
      console.error("[simulator:pulse]", summarizeDbError(e)),
    );
  }
}

export { PARAM_MAP };
