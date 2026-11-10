#!/usr/bin/env node
/**
 * dump-app-devices.mjs — print the APP database's mirrored fleet
 * (devices/{id} incl. the app/ metadata subtree) + a deviceHistory summary.
 * READ-ONLY. Safe to paste (contains no tokens; the owner project is never
 * contacted).
 *
 *   node --env-file=.env scripts/dump-app-devices.mjs
 */

import { readFileSync } from "node:fs";

const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!path) {
  console.error("Set FIREBASE_SERVICE_ACCOUNT_PATH to YOUR app database's service-account .json file.");
  process.exit(1);
}
const databaseUrl = (
  process.env.FIREBASE_DATABASE_URL ??
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ??
  ""
).trim();
if (!databaseUrl) {
  console.error("Set FIREBASE_DATABASE_URL (your app database URL).");
  process.exit(1);
}

const { initializeApp, cert } = await import("firebase-admin/app");
const { getDatabase } = await import("firebase-admin/database");

const app = initializeApp(
  { credential: cert(JSON.parse(readFileSync(path, "utf8"))), databaseURL: databaseUrl.replace(/\/+$/, "") },
  `dump-app-${Date.now()}`,
);
const db = getDatabase(app);

console.log("==================== APP-NODE DUMP (safe to paste) ====================");
console.log("database:", databaseUrl);
console.log("dumpedAt:", new Date().toISOString());
console.log("");
console.log("--- devices/ (mirrored fleet + app meta) ---");
const devices = (await db.ref("devices").get()).val() ?? {};
console.log(JSON.stringify(devices, null, 2));
console.log("");
console.log("--- deviceHistory/ summary ---");
const history = (await db.ref("deviceHistory").get()).val() ?? {};
for (const [id, days] of Object.entries(history)) {
  const dayKeys = Object.keys(days ?? {});
  const newest = dayKeys.sort().at(-1);
  const count = newest ? Object.keys(days[newest] ?? {}).length : 0;
  console.log(`  ${id}: ${dayKeys.length} day shard(s); newest ${newest ?? "-"} (${count} snapshot(s) in newest shard)`);
}
if (Object.keys(history).length === 0) console.log("  (empty — the sampler has not written yet)");
console.log("");
console.log("--- alarmsActive ---");
const active = (await db.ref("alarmsActive").get()).val() ?? {};
console.log(JSON.stringify(active, null, 2));
console.log("==================== END DUMP ====================");
process.exit(0);
