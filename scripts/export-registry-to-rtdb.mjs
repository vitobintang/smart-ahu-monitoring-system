#!/usr/bin/env node
/**
 * One-time backfill: Supabase PostgreSQL registry/config → Firebase RTDB.
 *
 * Copies the Phase-5b configuration-plane tables into their RTDB trees so
 * the RTDB-first reads (with PostgreSQL fallback) serve real data before the
 * Phase 5c teardown:
 *   ahus               → ahus/{ahuId}
 *   devices            → devices/{ahuId}/{deviceId}
 *   sensor_thresholds  → thresholds/{ahuId}/{parameter}
 *   facility_floorplan → facility/floorplan
 *   trend_alerts       → trendAlerts/{id}
 *
 * Skipped on purpose: alarm_breach_timers (transient engine state, rebuilt
 * automatically) and access_devices (vestigial since browser-token login was
 * removed — no grants are ever created).
 *
 * Required env (same values the app uses):
 *   DATABASE_URL                      Supabase PostgreSQL connection string
 *   FIREBASE_SERVICE_ACCOUNT_PATH     service-account JSON (or _JSON inline)
 *   NEXT_PUBLIC_FIREBASE_DATABASE_URL regional RTDB URL
 *
 * Dry run:  node scripts/export-registry-to-rtdb.mjs --dry-run
 * Idempotent — re-running rewrites the same keys. PostgreSQL is untouched.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

import pg from "pg";
import { cert, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");

const databaseUrl = process.env.DATABASE_URL;
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const firebaseDatabaseUrl = (process.env.FIREBASE_DATABASE_URL ?? process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ?? "").trim();

for (const [name, value] of [
  ["DATABASE_URL", databaseUrl],
  ["FIREBASE_SERVICE_ACCOUNT_PATH (or _JSON)", serviceAccountPath ?? serviceAccountJson],
  ["NEXT_PUBLIC_FIREBASE_DATABASE_URL", firebaseDatabaseUrl],
]) {
  if (!value) {
    console.error(`${name} is required.`);
    process.exit(1);
  }
}

const app = initializeApp({
  credential: serviceAccountPath
    ? cert(JSON.parse(readFileSync(serviceAccountPath, "utf8")))
    : cert(JSON.parse(serviceAccountJson)),
  databaseURL: firebaseDatabaseUrl,
});
const rtdb = getDatabase(app);
const pgClient = new pg.Client({
  connectionString: databaseUrl,
  ssl: /sslmode=require/.test(databaseUrl) ? { rejectUnauthorized: false } : undefined,
});

const toMs = (d) => (d === null || d === undefined ? null : new Date(d).getTime());
const now = () => Date.now();

function ahuRecord(r) {
  return {
    id: r.id,
    name: r.name,
    location: r.location,
    commTimeoutSec: r.comm_timeout_sec,
    hasHeater: r.has_heater,
    installedSensors: r.installed_sensors ?? [],
    currentStatus: r.current_status,
    lastSeenAt: toMs(r.last_seen_at),
    controlMode: r.control_mode,
    desiredRunState: r.desired_run_state,
    setpoint: r.setpoint,
    faultCode: r.fault_code,
    physicalControlEnabled: r.physical_control_enabled,
    mapX: r.map_x,
    mapZ: r.map_z,
    mapRotation: r.map_rotation,
    mapZone: r.map_zone,
    updatedAt: now(),
  };
}

function deviceRecord(r) {
  return {
    id: r.id,
    ahuId: r.ahu_id,
    label: r.label,
    token: r.token,
    sourceType: r.source_type,
    enabled: r.enabled,
    createdAt: toMs(r.created_at) ?? now(),
  };
}

function thresholdRecord(r) {
  return {
    id: r.id,
    ahuId: r.ahu_id,
    parameter: r.parameter,
    enabled: r.enabled,
    lowLimit: r.low_limit,
    highLimit: r.high_limit,
    delaySec: r.delay_sec,
    priority: r.priority,
    validMin: r.valid_min,
    validMax: r.valid_max,
    unit: r.unit,
    label: r.label,
    trendEnabled: r.trend_enabled,
    updatedAt: now(),
  };
}

function trendRecord(r) {
  return {
    id: r.id,
    ahuId: r.ahu_id,
    parameter: r.parameter,
    estimatedMin: r.estimated_min,
    direction: r.direction,
    isReliable: r.is_reliable,
    unreliabilityReason: r.unreliability_reason,
    sampleCount: r.sample_count,
    variance: r.variance,
    slopePerMin: r.slope_per_min,
    currentValue: r.current_value,
    projectedValue: r.projected_value,
    thresholdValue: r.threshold_value,
    minutesToBreach: r.minutes_to_breach,
    acknowledged: r.acknowledged,
    acknowledgedBy: r.acknowledged_by,
    acknowledgedAt: toMs(r.acknowledged_at),
    createdAt: toMs(r.created_at) ?? now(),
  };
}

async function exportTree(label, rows, pathOf, recordOf) {
  console.log(`  ${label}: ${rows.length} row(s)${dryRun ? "" : " → RTDB"}`);
  if (dryRun || rows.length === 0) return rows.length;
  for (const row of rows) {
    await rtdb.ref(pathOf(row)).set(recordOf(row));
  }
  return rows.length;
}

async function main() {
  await pgClient.connect();
  console.log(`Exporting registry/config tables → Firebase RTDB${dryRun ? " (dry run)" : ""}.`);

  const { rows: ahus } = await pgClient.query(`select * from ahu_private.ahus order by id`);
  const { rows: devices } = await pgClient.query(`select * from ahu_private.devices order by ahu_id, id`);
  const { rows: thresholds } = await pgClient.query(`select * from ahu_private.sensor_thresholds order by ahu_id, parameter`);
  const { rows: floorplan } = await pgClient.query(`select * from ahu_private.facility_floorplan where id = 1`);
  const { rows: trends } = await pgClient.query(`select * from ahu_private.trend_alerts order by created_at`);

  await exportTree("ahus", ahus, (r) => `ahus/${r.id}`, ahuRecord);
  await exportTree("devices", devices, (r) => `devices/${r.ahu_id}/${r.id}`, deviceRecord);
  await exportTree("thresholds", thresholds, (r) => `thresholds/${r.ahu_id}/${r.parameter}`, thresholdRecord);
  await exportTree("trendAlerts", trends, (r) => `trendAlerts/${r.id}`, trendRecord);

  if (floorplan.length > 0) {
    const fp = floorplan[0];
    console.log(`  facilityFloorplan: 1 row${dryRun ? "" : " → RTDB"}`);
    if (!dryRun) {
      await rtdb.ref("facility/floorplan").set({
        id: 1,
        vertices: fp.vertices,
        updatedBy: fp.updated_by,
        updatedAt: toMs(fp.updated_at) ?? now(),
      });
    }
  } else {
    console.log("  facilityFloorplan: none (app falls back to the built-in default room)");
  }

  console.log(
    `Done. ${ahus.length} AHU(s), ${devices.length} device(s), ${thresholds.length} threshold(s), ` +
      `${trends.length} trend alert(s)${floorplan.length ? ", 1 floorplan" : ""}${dryRun ? " (dry run — nothing written)" : " written"}.
Skipped by design: alarm_breach_timers (transient) and access_devices (vestigial).`,
  );
  if (!dryRun) console.log("Registry backfill complete — the app's RTDB-first reads now serve this data.");
}

main()
  .then(async () => {
    await pgClient.end();
    process.exit(0);
  })
  .catch((err) => {
    console.error("Export failed:", err);
    process.exit(1);
  });
