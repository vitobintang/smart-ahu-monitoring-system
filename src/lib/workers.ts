import { randomId } from "@/lib/ids";
import type { AhuRow, DeviceRow } from "@/lib/types";
import { acceptPendingCommands, expireStaleCommands, failActiveCommands, refreshAhuStatus } from "@/lib/engine";
import { runTrendDetection } from "@/lib/trends";
import { PARAM_MAP, type ParamKey } from "@/lib/domain";
import { tryGetAhuRtdb } from "@/lib/rtdb/live-read";
import { readRtdbAhus } from "@/lib/rtdb/registry";
import { getLatestTelemetry } from "@/lib/rtdb/telemetry";
import type { RtdbAdapter } from "@/lib/rtdb/store";

async function requireRtdb(): Promise<RtdbAdapter> {
  const rtdb = await tryGetAhuRtdb();
  if (!rtdb) throw new Error("Firebase RTDB is not configured");
  return rtdb;
}

function summarizeErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toLatestRowShape(latest: { roomTemp: number | null; supplyTemp: number | null; returnTemp: number | null; humidity: number | null; filterDiffPressure: number | null; fanSpeed: number | null; coilTemp: number | null; damperPosition: number | null; current: number | null; voltage: number | null; runHours: number | null; heaterOutput: number | null; runState: string | null }) {
  return {
    roomTemp: latest.roomTemp ?? undefined,
    supplyTemp: latest.supplyTemp ?? undefined,
    returnTemp: latest.returnTemp ?? undefined,
    humidity: latest.humidity ?? undefined,
    filterDiffPressure: latest.filterDiffPressure ?? undefined,
    fanSpeed: latest.fanSpeed ?? undefined,
    coilTemp: latest.coilTemp ?? undefined,
    damperPosition: latest.damperPosition ?? undefined,
    current: latest.current ?? undefined,
    voltage: latest.voltage ?? undefined,
    runHours: latest.runHours ?? undefined,
    heaterOutput: latest.heaterOutput ?? undefined,
  };
}

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
  __daikinInterval?: NodeJS.Timeout;
  __dbBackoffUntil?: number;
  __dbBackoffStreak?: number;
  __dbDegradedLogged?: boolean;
};

const simStates: Map<string, SimState> = (g.__simStates ??= new Map());
export const simOverrides: Map<string, SimOverride> = (g.__simOverrides ??= new Map());

function engageDbBackoff(tag: string, err: unknown): void {
  console.error(`[${tag}] worker failed — skipping this tick:`, summarizeErr(err));
}
function clearDbBackoffIfRecovered(): void {}


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

async function loadState(ahu: AhuRow, last: Partial<Record<"roomTemp" | "supplyTemp" | "returnTemp" | "humidity" | "filterDiffPressure" | "fanSpeed" | "coilTemp" | "damperPosition" | "current" | "voltage" | "runHours" | "heaterOutput", number>> | undefined): Promise<SimState> {
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
  let lastRow: Record<string, unknown> | undefined;
  if (!simStates.has(ahu.id)) {
    const latest = await getLatestTelemetry(await requireRtdb(), ahu.id);
    if (latest) {
      lastRow = { ...toLatestRowShape(latest) };
    }
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

  // Fabricated node in the VERIFIED owner format: devices/{id}/status with
  // simulated:true marking it as simulator data.
  const status: Record<string, unknown> = {
    power: ov.forcedFault ? false : roundedFan > 0,
    setpoint: ahu.setpoint,
    mode: ahu.controlMode === "MANUAL" ? "manual" : "cool",
    fan: parameters.fanSpeed ?? 0,
    online: true,
    s21_connected: true,
    state_valid: true,
    simulated: true,
    timestamp: Date.now(),
  };
  if (parameters.roomTemp !== undefined) status.room_temp = parameters.roomTemp;
  if (parameters.supplyTemp !== undefined) status.supply_temp = parameters.supplyTemp;
  if (parameters.returnTemp !== undefined) status.return_temp = parameters.returnTemp;
  if (parameters.humidity !== undefined) status.humidity = parameters.humidity;
  if (parameters.filterDiffPressure !== undefined) status.filter_diff_pressure = parameters.filterDiffPressure;
  if (parameters.coilTemp !== undefined) status.coil_temp = parameters.coilTemp;
  if (parameters.damperPosition !== undefined) status.damper_position = parameters.damperPosition;
  if (parameters.current !== undefined) status.current = parameters.current;
  if (parameters.voltage !== undefined) status.voltage = parameters.voltage;
  if (parameters.runHours !== undefined) status.run_hours = parameters.runHours;
  if (parameters.heaterOutput !== undefined) status.heater_output = parameters.heaterOutput;
  if (ov.forcedFault) status.fault = ov.forcedFault;
  const node: Record<string, unknown> = { status };

  const rtdb2 = await requireRtdb();
  const { processDaikinSnapshotRtdb } = await import("@/lib/rtdb/lifecycle");
  const result = await processDaikinSnapshotRtdb(rtdb2, ahu.id, node);
  if (!result.ok) console.error(`[simulator] ${ahu.id} snapshot rejected:`, result.body.error);
}

export async function simulationTick() {
  if (g.__simRunning) return;
  g.__simRunning = true;
  g.__lastSimTickAt = Date.now();
  const tickSec = 5;
  try {
    const rtdb = await requireRtdb();
    const registry = await readRtdbAhus(rtdb);
    // Units fed by the owner's live tree win — the simulator never fabricates
    // data over real device data.
    const { tryGetOwnerRtdb } = await import("@/lib/firebase/admin");
    const owner = await tryGetOwnerRtdb();
    const ownerIds = new Set(Object.keys(((await owner?.get<Record<string, unknown>>("devices")) ?? {})));

    for (const record of [...registry.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      const ahu = record as unknown as AhuRow;
      if (ownerIds.has(ahu.id)) continue;
      if ((record as { enabled?: boolean }).enabled === false) continue;
      // Local-fleet units are driven by their own device-tree tick, not the
      // generic simulator (which would fabricate values over the tree feed).
      if ((record as { fleetSource?: string }).fleetSource === "local") continue;
      try {
        const ov = getOverride(ahu.id);
        if (ov.rejectCommands && !ov.commLoss) {
          await failActiveCommands(rtdb, ahu.id, {
            reason: "Rejected by controller: local selector switch / actuator NACK (FR-26)",
            revertDesiredState: true,
          });
        }
        await simulateAhu(ahu, { id: `sim-${ahu.id}` } as unknown as DeviceRow, tickSec);
        if (!ov.rejectCommands) {
          await acceptPendingCommands(ahu.id);
        }
      } catch (err) {
        engageDbBackoff("simulator", err);
        console.error(`[simulator] ${ahu.id} tick failed:`, summarizeErr(err));
      }
    }
    clearDbBackoffIfRecovered();
  } catch (err) {
    engageDbBackoff("simulator", err);
    return;
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

/**
 * Daikin S21 integration sampler: reads the OWNER's `devices/{ahuId}` bridge
 * node (root tree) for every registered unit and feeds mapped samples through
 * the normal ingest pipeline — telemetry history, latest pointer, threshold
 * alarms and trends all flow from the owner's live data. Timestamp-keyed
 * message ids make unchanged bridge states a natural dedup.
 */
export async function syncDaikinDevices(now = new Date()): Promise<number> {
  const rtdb = await requireRtdb();
  const { processDaikinSnapshotRtdb } = await import("@/lib/rtdb/lifecycle");
  const { readDeviceSource, localFleetTick, LOCAL_DEVICES_NODE } = await import("@/lib/rtdb/local-fleet");
  const source = await readDeviceSource(rtdb);

  // LOCAL fleet: tick the fictional device nodes (telemetry-only) then ingest
  // the app-DB localDevices tree through the SAME daikin-shaped pipeline.
  if (source === "local") {
    await localFleetTick(rtdb);
    const tree = (await rtdb.get<Record<string, unknown>>(LOCAL_DEVICES_NODE)) ?? {};
    let localIngested = 0;
    for (const [ahuId, node] of Object.entries(tree)) {
      if (!node || typeof node !== "object" || Array.isArray(node)) continue;
      try {
        const result = await processDaikinSnapshotRtdb(rtdb, ahuId, node as Record<string, unknown>, now.getTime());
        if (result.ok && (result.status === 201 || result.status === 200)) localIngested += 1;
      } catch (err) {
        console.error(`[local-fleet] sync failed for ${ahuId}:`, summarizeErr(err));
      }
    }
    return localIngested;
  }

  const { tryGetOwnerRtdb } = await import("@/lib/firebase/admin");
  const owner = await tryGetOwnerRtdb();
  if (!owner) return 0;

  // Enumerate the OWNER tree verbatim and mirror every device node into the
  // app database (devices/{id} + deviceHistory/...). Units paused via
  // app meta are skipped inside the processor.
  const tree = (await owner.get<Record<string, unknown>>("devices")) ?? {};
  let ingested = 0;
  for (const [ahuId, node] of Object.entries(tree)) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    try {
      const result = await processDaikinSnapshotRtdb(rtdb, ahuId, node as Record<string, unknown>, now.getTime());
      if (result.ok && (result.status === 201 || result.status === 200)) ingested += 1;
    } catch (err) {
      console.error(`[daikin] sync failed for ${ahuId}:`, summarizeErr(err));
    }
  }
  return ingested;
}

export async function monitorTick() {
  if (g.__monitorRunning) return;
  g.__monitorRunning = true;
  try {
    const rtdb = await requireRtdb();
    // Status sweep + trend detection cover the ACTIVE fleet only
    // (Daikin DB ⇄ My DB switch) — the idle source must stay SILENT:
    // no heartbeat-lost alarms, no trend warnings, no notifications.
    const { readActiveFleetRecords } = await import("@/lib/rtdb/local-fleet");
    const active = [...(await readActiveFleetRecords(rtdb)).values()].sort((a, b) => a.id.localeCompare(b.id));
    const all = [...(await readRtdbAhus(rtdb)).values()].sort((a, b) => a.id.localeCompare(b.id));
    monitorTickCount += 1;
    const doTrends = monitorTickCount % TREND_EVERY_N_TICKS === 0;

    try {
      await expireStaleCommands(new Date());
    } catch (err) {
      engageDbBackoff("monitor", err);
      return;
    }

    for (const record of active) {
      const ahuId = record.id;
      try {
        await refreshAhuStatus(ahuId, new Date());
        if (doTrends) await runTrendDetection(ahuId, new Date());
      } catch (err) {
        engageDbBackoff("monitor", err);
        console.error(`[monitor] ${ahuId} failed:`, summarizeErr(err));
      }
    }

    // Phase 5c: the legacy outbox is gone — retention is RTDB-only.
    try {
      const { pruneTelemetryShards } = await import("@/lib/rtdb/telemetry");
      const daysToKeep = Number(process.env.TELEMETRY_RETENTION_DAYS ?? 30);
      if (Number.isFinite(daysToKeep) && daysToKeep > 0) {
        const ids = all.map((r) => r.id);
        const removed = await pruneTelemetryShards(rtdb, ids, Math.min(366, daysToKeep));
        if (removed > 0) console.log(`[monitor] pruned ${removed} telemetry shard(s)`);
      }
    } catch (err) {
      console.error("[monitor] retention sweep failed:", summarizeErr(err));
    }

    clearDbBackoffIfRecovered();
  } catch (err) {
    engageDbBackoff("monitor", err);
    return;
  } finally {
    g.__monitorRunning = false;
  }
}

export function startWorkers() {
  if (g.__workersStarted) return;
  g.__workersStarted = true;
  const simInterval = Number(process.env.SIMULATION_INTERVAL_MS ?? 5000);
  const monitorInterval = Number(process.env.MONITOR_INTERVAL_MS ?? 10000);

  // Daikin S21 bridge sampler (owner's live devices tree → ingest pipeline).
  if (g.__daikinInterval === undefined) {
    const daikinInterval = Number(process.env.DAIKIN_SYNC_INTERVAL_MS ?? 5000);
    g.__daikinInterval = setInterval(() => {
      void runSerializedWorker(async () => {
        await syncDaikinDevices();
      }).catch((e) => console.error("[daikin]", summarizeErr(e)));
    }, daikinInterval);
    g.__daikinInterval.unref?.();
  }

  if (process.env.SIMULATION_ENABLED !== "false") {
    const t1 = setInterval(() => {
      if (g.__simRunning) return;
      void runSerializedWorker(() => simulationTick()).catch((e) =>
        console.error("[simulator]", summarizeErr(e)),
      );
    }, simInterval);
    t1.unref?.();
    void runSerializedWorker(() => simulationTick()).catch((e) =>
      console.error("[simulator:prime]", summarizeErr(e)),
    );
  }

  const t2 = setInterval(() => {
    if (g.__monitorRunning) return;
    void runSerializedWorker(() => monitorTick()).catch((e) =>
      console.error("[monitor]", summarizeErr(e)),
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
    console.error("[monitor:prime]", summarizeErr(e)),
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
  const last = g.__lastSimTickAt ?? 0;
  if (!g.__simRunning && Date.now() - last >= minIntervalMs) {
    void runSerializedWorker(() => simulationTick()).catch((e) =>
      console.error("[simulator:pulse]", summarizeErr(e)),
    );
  }
}

export { PARAM_MAP };
