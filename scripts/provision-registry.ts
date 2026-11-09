/**
 * provision-registry.ts — one-shot: create the AHU registry (units, thresholds,
 * simulation gateway devices) directly in Firebase RTDB.
 *
 * Sized for the ADOPTED project: the fleet is the single real unit
 * `GTM-DAIKIN-001` (the friend's Daikin S21 monitor) living under the
 * RTDB_PATH_PREFIX namespace — the owner's own root nodes are never touched.
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

/**
 * The single real unit on the adopted project. All 12 parameters are installed
 * so the full app (thresholds, trends, reports) works out of the box; trim the
 * per-sensor toggles in Admin → Config when a sensor is not physically present.
 *
 * physicalControlEnabled is TRUE: the app IS the commissioned controller for
 * this unit — accepted START/STOP/SETPOINT commands write power/setpoint
 * directly into the owner's root `devices/GTM-DAIKIN-001` node (rtdb/daikin.ts),
 * and workers sync its live state back through the ingest pipeline.
 */
const AHU_SEEDS: AhuSeed[] = [
  {
    id: "GTM-DAIKIN-001",
    name: "GTM-DAIKIN-001 · Daikin S21 AC",
    location: "GTM — Daikin S21 monitored unit",
    hasHeater: false,
    commTimeoutSec: 30,
    sensors: ALL,
    setpoint: 24.0,
    desiredRunState: "RUN",
  },
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
    // The 3D facility catalog keeps its original placement keys; the real unit
    // reuses the primary spot.
    const mapPos = DEFAULT_AHU_PLACEMENTS[seed.id] ?? DEFAULT_AHU_PLACEMENTS["AHU-01"];
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
      physicalControlEnabled: true,
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

  const existingBridge = existingDevices.find((d) => d.ahuId === seed.id && d.sourceType === "PHYSICAL");
  if (!existingBridge) {
    const token = `s21_${seed.id.toLowerCase().replace(/-/g, "")}_${randomHex(8)}`;
    await setRtdbDevice(rtdb, {
      id: randomId(),
      ahuId: seed.id,
      label: `${seed.id} Daikin S21 Bridge (system)`,
      token,
      sourceType: "PHYSICAL",
      enabled: true,
      createdAt: now,
    });
    createdDevices += 1;
    simTokens.push(`${seed.id} (physical bridge): ${token}`);
  }
  if (!existingSimAhuIds.has(seed.id)) {
    const token = `sim_${seed.id.toLowerCase().replace(/-/g, "")}_${randomHex(8)}`;
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
    simTokens.push(`${seed.id} (simulation): ${token}`);
  }
}

console.log("");
console.log(`Done — created ${createdAhus} AHU(s), ${createdThresholds} threshold(s), ${createdDevices} simulation device(s).`);
if (simTokens.length > 0) {
  console.log("");
  console.log("SIMULATION gateway bearer tokens (shown once — keep private):");
  for (const line of simTokens) console.log(`  ${line}`);
}
