#!/usr/bin/env node
/**
 * One-time backfill: Supabase PostgreSQL telemetry → Firebase RTDB history.
 *
 * Copies ahu_private.telemetry rows into the RTDB day-shard tree
 * (telemetry/{ahuId}/{YYYY-MM-DD}/{messageId}) so pre-migration data-logger
 * history survives the Phase 5 cutover and reports keep serving old dates.
 * Rows without a messageId get a deterministic `pg-{id}` key (idempotent).
 * After the copy, telemetryLatest/{ahuId} is advanced to the newest record
 * per unit (transactionally, never regressing live values).
 *
 * Required env (same values the app uses):
 *   DATABASE_URL                      Supabase PostgreSQL connection string
 *   FIREBASE_SERVICE_ACCOUNT_PATH     service-account JSON (or _JSON inline)
 *   NEXT_PUBLIC_FIREBASE_DATABASE_URL regional RTDB URL
 *
 * Dry run:  node scripts/export-history-to-rtdb.mjs --dry-run
 * Range:    --from 2026-10-01 --to 2026-11-09   (defaults: last 31 days)
 * One AHU:  --ahu AHU-03
 *
 * Idempotent — re-running rewrites the same keys. PostgreSQL is untouched.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

import pg from "pg";
import { cert, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const argOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

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

const to = argOf("--to") ? new Date(`${argOf("--to")}T23:59:59.999Z`) : new Date();
const from = argOf("--from")
  ? new Date(`${argOf("--from")}T00:00:00.000Z`)
  : new Date(to.getTime() - 31 * 86_400_000);
const ahuFilter = argOf("--ahu");
const BATCH = Number(argOf("--batch") ?? 500);

if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
  console.error("Invalid --from/--to range.");
  process.exit(1);
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

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

function toRecord(row) {
  return {
    ahuId: row.ahu_id,
    messageId: row.message_id ?? `pg-${row.id}`,
    source: row.source,
    timestamp: row.timestamp.getTime(),
    receivedAt: row.timestamp.getTime(),
    roomTemp: row.room_temp,
    supplyTemp: row.supply_temp,
    returnTemp: row.return_temp,
    humidity: row.humidity,
    filterDiffPressure: row.filter_diff_pressure,
    fanSpeed: row.fan_speed,
    coilTemp: row.coil_temp,
    damperPosition: row.damper_position,
    current: row.current,
    isCurrentFallback: row.is_current_fallback,
    voltage: row.voltage,
    isVoltageFallback: row.is_voltage_fallback,
    runHours: row.run_hours,
    heaterOutput: row.heater_output,
    runState: row.run_state,
    faultCode: row.fault_code,
  };
}

async function main() {
  await pgClient.connect();
  const params = [from, to];
  let ahuCond = "";
  if (ahuFilter) {
    ahuCond = " and ahu_id = $3";
    params.push(ahuFilter);
  }
  const { rows: counted } = await pgClient.query(
    `select count(*)::int as n from ahu_private.telemetry where timestamp >= $1 and timestamp <= $2${ahuCond}`,
    params,
  );
  console.log(`Backfilling ${counted[0].n} telemetry row(s) from ${from.toISOString()} to ${to.toISOString()}${ahuFilter ? ` for ${ahuFilter}` : ""}${dryRun ? " (dry run)" : ""}.`);
  if (dryRun) {
    const { rows: preview } = await pgClient.query(
      `select ahu_id, count(*)::int as n, min(timestamp) as oldest, max(timestamp) as newest
       from ahu_private.telemetry where timestamp >= $1 and timestamp <= $2${ahuCond}
       group by ahu_id order by ahu_id`,
      params,
    );
    for (const r of preview) {
      console.log(`  - ${r.ahu_id}: ${r.n} rows, ${r.oldest?.toISOString()} → ${r.newest?.toISOString()}`);
    }
    console.log("Dry run only — re-run without --dry-run to export.");
    return;
  }

  let cursor = 0;
  let exported = 0;
  const newestPerAhu = new Map();
  for (;;) {
    const { rows } = await pgClient.query(
      `select * from ahu_private.telemetry where timestamp >= $1 and timestamp <= $2${ahuCond} and id > $3 order by id limit ${BATCH}`,
      [...params, cursor],
    );
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    // multi-path update: one RTDB write per batch
    const update = {};
    for (const row of rows) {
      const record = toRecord(row);
      update[`telemetry/${record.ahuId}/${dayKey(record.timestamp)}/${record.messageId}`] = record;
      const best = newestPerAhu.get(record.ahuId);
      if (!best || record.timestamp > best.timestamp) newestPerAhu.set(record.ahuId, record);
    }
    await rtdb.ref().update(update);
    exported += rows.length;
    if (exported % (BATCH * 10) === 0 || rows.length < BATCH) {
      console.log(`  exported ${exported}/${counted[0].n}`);
    }
    if (rows.length < BATCH) break;
  }

  for (const [ahuId, record] of newestPerAhu) {
    await rtdb
      .ref(`telemetryLatest/${ahuId}`)
      .transaction((current) => (!current || record.timestamp >= current.timestamp ? record : current));
  }
  console.log(`Done. ${exported} row(s) mirrored; telemetryLatest advanced for ${newestPerAhu.size} AHU(s).`);
  console.log("Reports over the exported range now serve from Firebase (PostgreSQL stays authoritative until cutover).");
}

main()
  .catch((err) => {
    console.error("Export failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pgClient.end().catch(() => {});
    await app.delete().catch(() => {});
    process.exit(process.exitCode ?? 0);
  });
