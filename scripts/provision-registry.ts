/**
 * provision-registry.ts — one-shot: create the 7-AHU fleet (units, thresholds,
 * simulation gateway devices) directly in Firebase RTDB.
 *
 * Port of the former PostgreSQL seed (src/db/seed.ts, removed in the Phase 5c
 * cutover) for adopting a FRESH/EXISTING Firebase project without PostgreSQL.
 * Idempotent: existing AHUs/thresholds/devices are left untouched, so it is
 * safe to re-run.
 *
 * Reads .env.local values from the environment (never reads the file itself):
 *   FIREBASE_SERVICE_ACCOUNT_PATH  the service-account JSON (server-only)
 *   FIREBASE_DATABASE_URL          or NEXT_PUBLIC_FIREBASE_DATABASE_URL
 *   RTDB_PATH_PREFIX               optional shared-database namespace
 *
 * Usage (from the repo root):
 *   node --env-file=.env.local --import tsx scripts/provision-registry.ts
 *   # or set the env vars manually and drop --env-file
 *
 * The script prints created records and the SIMULATION bearer tokens once —
 * store them somewhere safe (they are the gateway credentials).
 */

import { readFileSync } from "node:fs";

import { PARAMETERS, type ParamKey } from "../src/lib/domain";
import { DEFAULT_AHU_PLACEMENTS } from "../src/lib/facility-layout";
import { randomHex, randomId } from "../src/lib/ids";
import { createAdminRtdbAdapter, resolveRtdbPathPrefix, type RtdbAdapter } from "../src/lib/rtdb/store";
import {
  writeRtdbAhu,
  setRtdbDevice,
  setRtdbThreshold,
  readRtdbAhus,
  readRtdbDevices,
  readRtdbThresholds,
} from "../src/lib/rtdb/registry";

/* ── seed data (verbatim port of the former src/db/seed.ts) ─────────────── */

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

const AHU_SEEDS: AhuSeed[] = [
  { id: "AHU-01", name: "AHU-01 Cleanroom Supply", location: "Building A — Level 2 · ISO 7 Cleanroom", hasHeater: true, commTimeoutSec: 30, sensors: ALL, setpoint: 21.5, desiredRunState: "RUN" },
  { id: "AHU-02", name: "AHU-02 Assembly Hall", location: "Building A — Level 1 · Assembly Hall", hasHeater: true, commTimeoutSec: 30, sensors: ALL, setpoint: 22.0, desiredRunState: "RUN" },
  { id: "AHU-03", name: "AHU-03 Laboratory Wing", location: "Building B — Level 3 · Laboratory Wing", hasHeater: true, commTimeoutSec: 45, sensors: without("voltage"), setpoint: 20.5, desiredRunState: "RUN" },
  { id: "AHU-04", name: "AHU-04 Packing & Logistics", location: "Building B — Level 1 · Packing Area", hasHeater: true, commTimeoutSec: 60, sensors: without("voltage", "runHours"), setpoint: 23.0, desiredRunState: "RUN" },
  { id: "AHU-05", name: "AHU-05 Warehouse Comfort", location: "Building C — Ground Floor · Warehouse", hasHeater: false, commTimeoutSec: 45, sensors: without("heaterOutput"), setpoint: 24.0, desiredRunState: "RUN" },
  { id: "AHU-06", name: "AHU-06 Office Tower Fresh Air", location: "Building C — Level 5 · Office Tower", hasHeater: false, commTimeoutSec: 30, sensors: without("heaterOutput", "coilTemp"), setpoint: 23.5, desiredRunState: "STOP" },
  { id: "AHU-07", name: "AHU-07 Server Room Precision", location: "Building D — Basement · Server Room", hasHeater: false, commTimeoutSec: 20, sensors: without("heaterOutput", "filterDiffPressure"), setpoint: 19.0, desiredRunState: "RUN" },
];

/* ── bootstrap ───────────────────────────────────────────────────────────── */

function die(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function loadServiceAccount() {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) die("Set FIREBASE_SERVICE_ACCOUNT_PATH to the service-account .json file.");
  return JSON.parse(readFileSync(path, "utf8"));
}

const databaseUrl = (
  process.env.FIREBASE_DATABASE_URL ??
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ??
  ""
).trim();
if (!databaseUrl) die("Set FIREBASE_DATABASE_URL (or NEXT_PUBLIC_FIREBASE_DATABASE_URL).");

const { initializeApp, cert } = await import("firebase-admin/app");
const { getDatabase } = await import("firebase-admin/database");

const app = initializeApp(
  { credential: cert(loadServiceAccount()), databaseURL: databaseUrl.replace(/\/+$/, "") },
  `provision-registry-${Date.now()}`,
);
const rtdb: RtdbAdapter = createAdminRtdbAdapter(getDatabase(app));
const prefix = resolveRtdbPathPrefix();

console.log(`database : ${databaseUrl}`);
console.log(`namespace: ${prefix || "(root — set RTDB_PATH_PREFIX to isolate a shared database)"}`);
console.log("");

/* ── provision ───────────────────────────────────────────────────────────── */

const now = Date.now();
let createdAhus = 0;
let createdThresholds = 0;
let createdDevices = 0;
const simTokens: string[] = [];

const existingAhus = await readRtdbAhus(rtdb);
const existingThresholds = await readRtdbThresholds(rtdb);
const existingThresholdKeys = new Set(existingThresholds.map((t) => t.id));
const existingDevices = await readRtdbDevices(rtdb);
const existingSimAhuIds = new Set(existingDevices.filter((d) => d.sourceType === "SIMULATION").map((d) => d.ahuId));

for (const seed of AHU_SEEDS) {
  if (!existingAhus.has(seed.id)) {
    const mapPos = DEFAULT_AHU_PLACEMENTS[seed.id];
    await writeRtdbAhu(rtdb, {
      id: seed.id,
      name: seed.name,
      location: seed.location,
      commTimeoutSec: seed.commTimeoutSec,
      hasHeater: seed.hasHeater,
      installedSensors: [...seed.sensors],
      currentStatus: "OFFLINE",
      lastSeenAt: null,
      controlMode: "AUTO",
      desiredRunState: seed.desiredRunState,
      setpoint: seed.setpoint,
      faultCode: null,
      physicalControlEnabled: false,
      mapX: mapPos?.x ?? null,
      mapZ: mapPos?.z ?? null,
      mapRotation: mapPos?.rotation ?? 0,
      mapZone: mapPos?.zone ?? null,
      updatedAt: now,
    });
    createdAhus += 1;
    console.log(`+ ahus/${seed.id} — ${seed.name}`);
  } else {
    console.log(`= ahus/${seed.id} already exists — left untouched`);
  }

  for (const p of PARAMETERS) {
    const installed = seed.sensors.includes(p.key);
    const record = {
      id: `${seed.id}:${p.key}`,
      ahuId: seed.id,
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
      updatedAt: now,
    };
    if (!existingThresholdKeys.has(record.id)) {
      await setRtdbThreshold(rtdb, record);
      createdThresholds += 1;
    }
  }

  if (!existingSimAhuIds.has(seed.id)) {
    const token = `sim_${seed.id.toLowerCase().replace("-", "")}_${randomHex(8)}`;
    await setRtdbDevice(rtdb, {
      id: randomId(),
      ahuId: seed.id,
      label: `${seed.id} Simulation Controller`,
      token,
      sourceType: "SIMULATION",
      enabled: true,
      createdAt: now,
    });
    createdDevices += 1;
    simTokens.push(`${seed.id}: ${token}`);
  }
}

console.log("");
console.log(`Done — created ${createdAhus} AHU(s), ${createdThresholds} threshold(s), ${createdDevices} simulation device(s).`);
if (simTokens.length > 0) {
  console.log("");
  console.log("SIMULATION gateway bearer tokens (shown once — keep private):");
  for (const line of simTokens) console.log(`  ${line}`);
}
