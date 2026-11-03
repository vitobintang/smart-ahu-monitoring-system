import { randomHex, randomId } from "@/lib/ids";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ahus, devices, sensorThresholds, syncState, telemetry } from "@/db/schema";
import { AHU_IDS, PARAMETERS, type ParamKey } from "@/lib/domain";

interface AhuSeed {
  id: string;
  name: string;
  location: string;
  hasHeater: boolean;
  commTimeoutSec: number;
  sensors: ParamKey[];
  setpoint: number;
  desiredRunState: "RUN" | "STOP";
}

const ALL: ParamKey[] = PARAMETERS.map((p) => p.key);
const without = (...keys: ParamKey[]) => ALL.filter((k) => !keys.includes(k));

export const AHU_SEEDS: AhuSeed[] = [
  { id: "AHU-01", name: "AHU-01 Cleanroom Supply", location: "Building A — Level 2 · ISO 7 Cleanroom", hasHeater: true, commTimeoutSec: 30, sensors: ALL, setpoint: 21.5, desiredRunState: "RUN" },
  { id: "AHU-02", name: "AHU-02 Assembly Hall", location: "Building A — Level 1 · Assembly Hall", hasHeater: true, commTimeoutSec: 30, sensors: ALL, setpoint: 22.0, desiredRunState: "RUN" },
  { id: "AHU-03", name: "AHU-03 Laboratory Wing", location: "Building B — Level 3 · Laboratory Wing", hasHeater: true, commTimeoutSec: 45, sensors: without("voltage"), setpoint: 20.5, desiredRunState: "RUN" },
  { id: "AHU-04", name: "AHU-04 Packing & Logistics", location: "Building B — Level 1 · Packing Area", hasHeater: true, commTimeoutSec: 60, sensors: without("voltage", "runHours"), setpoint: 23.0, desiredRunState: "RUN" },
  { id: "AHU-05", name: "AHU-05 Warehouse Comfort", location: "Building C — Ground Floor · Warehouse", hasHeater: false, commTimeoutSec: 45, sensors: without("heaterOutput"), setpoint: 24.0, desiredRunState: "RUN" },
  { id: "AHU-06", name: "AHU-06 Office Tower Fresh Air", location: "Building C — Level 5 · Office Tower", hasHeater: false, commTimeoutSec: 30, sensors: without("heaterOutput", "coilTemp"), setpoint: 23.5, desiredRunState: "STOP" },
  { id: "AHU-07", name: "AHU-07 Server Room Precision", location: "Building D — Basement · Server Room", hasHeater: false, commTimeoutSec: 20, sensors: without("heaterOutput", "filterDiffPressure"), setpoint: 19.0, desiredRunState: "RUN" },
];

export async function seed() {
  for (const a of AHU_SEEDS) {
    await db
      .insert(ahus)
      .values({
        id: a.id,
        name: a.name,
        location: a.location,
        commTimeoutSec: a.commTimeoutSec,
        hasHeater: a.hasHeater,
        installedSensors: a.sensors,
        currentStatus: "OFFLINE",
        controlMode: "AUTO",
        desiredRunState: a.desiredRunState,
        setpoint: a.setpoint,
        physicalControlEnabled: false,
      })
      .onConflictDoNothing();
  }

  for (const a of AHU_SEEDS) {
    for (const p of PARAMETERS) {
      const installed = a.sensors.includes(p.key);
      await db
        .insert(sensorThresholds)
        .values({
          id: `${a.id}:${p.key}`,
          ahuId: a.id,
          parameter: p.key,
          enabled: installed && (p.defaultLow !== null || p.defaultHigh !== null),
          lowLimit: p.defaultLow,
          highLimit: p.defaultHigh,
          delaySec: p.key === "current" ? 10 : 5,
          priority: p.defaultPriority,
          validMin: p.validMin,
          validMax: p.validMax,
          unit: p.unit,
          label: p.label,
          trendEnabled: installed && p.trendByDefault,
        })
        .onConflictDoNothing();
    }
  }

  for (const a of AHU_SEEDS) {
    const token = `sim_${a.id.toLowerCase().replace("-", "")}_${randomHex(8)}`;
    const existing = await db
      .select({ id: devices.id })
      .from(devices)
      .where(sql`${devices.ahuId} = ${a.id} and ${devices.sourceType} = 'SIMULATION'`)
      .limit(1);
    if (existing.length === 0) {
      await db.insert(devices).values({
        id: randomId(),
        ahuId: a.id,
        label: `${a.id} Simulation Controller`,
        token,
        sourceType: "SIMULATION",
        enabled: true,
      });
    }
  }

  await db
    .insert(syncState)
    .values({ id: 1, mode: "LOCAL", pollingIntervalSec: 5 })
    .onConflictDoNothing();

  const count = await db.select({ n: sql<number>`count(*)::int` }).from(telemetry);
  if (process.env.SEED_SIMULATED_HISTORY !== "false" && (count[0]?.n ?? 0) === 0) await backfill();

  return { ahus: AHU_IDS.length };
}

async function backfill() {
  const now = Date.now();
  const minutes = 75;
  for (const a of AHU_SEEDS) {
    const rows: (typeof telemetry.$inferInsert)[] = [];
    let filterDp = 95 + Math.random() * 25;
    let room = a.desiredRunState === "RUN" ? a.setpoint + 1.2 : 27.4;
    let supply = a.desiredRunState === "RUN" ? a.setpoint - 2.1 : 26.1;
    let humidity = 51 + Math.random() * 6;
    for (let i = minutes; i >= 0; i -= 1) {
      const t = new Date(now - i * 60_000);
      const running = a.desiredRunState === "RUN";
      const fan = running ? 76 + Math.sin(i / 6) * 4 + (Math.random() * 2 - 1) : 0;
      filterDp = Math.min(900, filterDp + 0.55 + (Math.random() * 0.3 - 0.1));
      room += (running ? a.setpoint + 1.3 - room : 28.6 - room) * 0.08 + (Math.random() * 0.16 - 0.08);
      supply += (running ? a.setpoint - 2.2 - supply : 26.4 - supply) * 0.12 + (Math.random() * 0.2 - 0.1);
      humidity += (running ? 52 - humidity : 63 - humidity) * 0.05 + (Math.random() * 0.7 - 0.35);
      const values: Partial<Record<ParamKey, number>> = {
        roomTemp: Number(room.toFixed(1)),
        supplyTemp: Number(supply.toFixed(1)),
        returnTemp: Number((room * 0.72 + supply * 0.28).toFixed(1)),
        humidity: Number(Math.min(95, Math.max(20, humidity)).toFixed(1)),
        filterDiffPressure: Math.round(filterDp),
        fanSpeed: Math.round(fan),
        coilTemp: Number((running ? 7.4 + Math.random() * 0.8 : 15.8 + Math.random()).toFixed(1)),
        damperPosition: Math.round(running ? 70 + Math.sin(i / 8) * 6 : 0),
        current: Number((running ? 2.4 + (fan / 100) * 13.2 + (Math.random() * 0.4 - 0.2) : 0).toFixed(2)),
        voltage: Number((230.5 + (Math.random() * 2.4 - 1.2)).toFixed(1)),
        runHours: Number((1200 + (minutes - i) / 60).toFixed(2)),
        heaterOutput: Math.round(a.hasHeater && running && supply < a.setpoint - 1.5 ? 48 + Math.random() * 12 : 0),
      };
      const record: Record<string, unknown> = {
        id: undefined,
        ahuId: a.id,
        timestamp: t,
        source: "SIMULATION",
        messageId: randomId(),
        runState: running ? "RUN" : "STOP",
        faultCode: null,
        isCurrentFallback: false,
        isVoltageFallback: false,
        rawPayload: { backfilled: true },
      };
      for (const key of a.sensors) record[key] = values[key] ?? null;
      if (i % 23 === 0) record.roomTemp = null;
      rows.push(record as typeof telemetry.$inferInsert);
    }
    await db.insert(telemetry).values(rows);
  }
}

export { AHU_IDS };