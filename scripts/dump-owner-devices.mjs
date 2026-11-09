#!/usr/bin/env node
/**
 * dump-owner-devices.mjs — print the FULL contents of the owner's root
 * `devices/` (and `deviceOwners/`) trees so the Daikin integration can be
 * verified against real data before trusting it.
 *
 * These nodes are AC live-state (temps, setpoint, fan, rssi) — no tokens,
 * passwords or emails live there, so the output is safe to paste in chat.
 * Read-only: nothing is written.
 *
 * Usage:
 *   node --env-file=.env scripts/dump-owner-devices.mjs
 *
 * Tip: run it twice a few minutes apart (or while the AC changes state) and
 * paste both — the DIFF tells us which fields actually move over time.
 */

import { readFileSync } from "node:fs";

const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!path) {
  console.error("Set FIREBASE_SERVICE_ACCOUNT_PATH to the service-account .json file.");
  process.exit(1);
}
const databaseUrl = (process.env.FIREBASE_DATABASE_URL ?? process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ?? "").trim();
if (!databaseUrl) {
  console.error("Set FIREBASE_DATABASE_URL (or NEXT_PUBLIC_FIREBASE_DATABASE_URL).");
  process.exit(1);
}

const { initializeApp, cert } = await import("firebase-admin/app");
const { getDatabase } = await import("firebase-admin/database");

const app = initializeApp(
  { credential: cert(JSON.parse(readFileSync(path, "utf8"))), databaseURL: databaseUrl.replace(/\/+$/, "") },
  `dump-owner-${Date.now()}`,
);
const db = getDatabase(app);

console.log("==================== OWNER-NODE DUMP (safe to paste) ====================");
console.log(`database: ${databaseUrl}`);
console.log(`dumpedAt: ${new Date().toISOString()}`);

for (const node of ["devices", "deviceOwners"]) {
  const value = (await db.ref(node).get()).val();
  console.log(`\n--- ${node}/ ---`);
  console.log(value === null ? "(empty)" : JSON.stringify(value, null, 2));
}
console.log("\n==================== END DUMP ====================");
