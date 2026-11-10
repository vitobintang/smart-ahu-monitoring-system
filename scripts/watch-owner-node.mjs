#!/usr/bin/env node
/**
 * watch-owner-node.mjs — watch devices/{id}/status at sub-second resolution
 * to catch WHERE command writes land and WHAT happens to them afterwards.
 *
 * Context: accepted commands are written straight into the owner's node
 * (power/setpoint). If another writer (e.g. the "mock" bridge loop) rewrites
 * the node every ~1 s, a manual dump run seconds later can no longer see the
 * app's write. This watcher polls every 200 ms — faster than the mock ticks —
 * and prints every observed change with a timeline, plus a summary.
 *
 * READ-ONLY: only .get() calls, nothing is written.
 *
 * Usage (press START in the site while it runs):
 *   node --env-file=.env scripts/watch-owner-node.mjs
 *   node --env-file=.env scripts/watch-owner-node.mjs 120   # watch 120 s
 */

import { readFileSync } from "node:fs";

const DURATION_MS = Math.max(5_000, Number(process.argv[2] ?? 60_000) || 60_000);
const INTERVAL_MS = 200;

const path =
  process.env.OWNER_DEVICES_SERVICE_ACCOUNT_PATH ||
  process.env.OWNER_DEVICES_SERVICE_ACCOUNT_JSON ||
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!path) {
  console.error("Set OWNER_DEVICES_SERVICE_ACCOUNT_PATH to the DAIKIN project's service-account .json file.");
  process.exit(1);
}
const databaseUrl = (
  process.env.OWNER_DEVICES_DATABASE_URL ??
  process.env.FIREBASE_DATABASE_URL ??
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ??
  ""
).trim();
if (!databaseUrl) {
  console.error("Set OWNER_DEVICES_DATABASE_URL (the daikinsmart database URL).");
  process.exit(1);
}

const { initializeApp, cert } = await import("firebase-admin/app");
const { getDatabase } = await import("firebase-admin/database");

const app = initializeApp(
  { credential: cert(JSON.parse(readFileSync(path, "utf8"))), databaseURL: databaseUrl.replace(/\/+$/, "") },
  `watch-owner-${Date.now()}`,
);
const db = getDatabase(app);

console.log("==================== OWNER-NODE WATCH (read-only, safe to paste) ====================");
console.log(`database: ${databaseUrl}`);
console.log(`startedAt: ${new Date().toISOString()}  — watching for ${DURATION_MS / 1000}s, poll every ${INTERVAL_MS}ms`);

const devices = (await db.ref("devices").get()).val() ?? {};
const ahuIds = Object.keys(devices);
if (ahuIds.length === 0) {
  console.log("devices/ is empty — nothing to watch.");
  process.exit(0);
}
const ahuId = ahuIds[0];
const nodeRef = db.ref(`devices/${ahuId}/status`);
console.log(`watching: devices/${ahuId}/status${ahuIds.length > 1 ? `  (also present: ${ahuIds.slice(1).join(", ")})` : ""}`);
console.log(">>> Press START (or STOP / SETPOINT) in the site NOW — the watcher will catch it. <<<\n");

const FIELDS = ["power", "setpoint", "mode", "fan", "online", "room_temp", "rssi", "s21_connected", "state_valid", "simulated", "source"];
const fmt = (v) => (typeof v === "string" ? `"${v}"` : String(v));
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`;

const t0 = Date.now();
let prev = null;
let reads = 0;
let tsAdvances = 0;
let tsTotalGap = 0;
let lastTs = null;
const powerEvents = []; // { at, from, to }
let lastPowerValue = null;

while (Date.now() - t0 < DURATION_MS) {
  const v = await nodeRef.get().then((s) => s.val());
  reads += 1;
  const now = Date.now();
  if (v && typeof v.timestamp === "number") {
    if (lastTs !== null && v.timestamp > lastTs) {
      tsAdvances += 1;
      tsTotalGap += v.timestamp - lastTs;
    }
    lastTs = v.timestamp;
  }
  if (prev !== null) {
    const changes = [];
    if (v) {
      for (const f of FIELDS) {
        if (JSON.stringify(v[f]) !== JSON.stringify(prev[f]) && v[f] !== undefined) {
          changes.push(`${f}: ${fmt(prev[f] ?? "∅")} → ${fmt(v[f])}`);
        }
      }
      if (prev.timestamp !== v.timestamp) changes.push(`timestamp: +${(v.timestamp ?? 0) - (prev.timestamp ?? 0)} ms`);
    } else {
      changes.push("(node deleted)");
    }
    if (changes.length > 0) console.log(`[${elapsed()}] ${changes.join("  |  ")}`);
    if (v && typeof v.power === "boolean" && v.power !== lastPowerValue) {
      powerEvents.push({ at: (now - t0) / 1000, from: lastPowerValue, to: v.power });
      lastPowerValue = v.power;
    }
  } else if (v) {
    console.log(`[${elapsed()}] baseline: ${JSON.stringify(v)}`);
    if (typeof v.power === "boolean") lastPowerValue = v.power;
  }
  prev = v;
  await new Promise((r) => setTimeout(r, INTERVAL_MS));
}

const avgTick = tsAdvances > 0 ? (tsTotalGap / tsAdvances / 1000).toFixed(2) : null;
console.log("\n==================== SUMMARY ====================");
console.log(`reads: ${reads} over ${((Date.now() - t0) / 1000).toFixed(1)}s (every ~${INTERVAL_MS}ms)`);
console.log(
  avgTick
    ? `timestamp advanced ${tsAdvances}x → another writer updates this node about every ${avgTick}s`
    : "timestamp NEVER advanced → no other writer observed during the window",
);
if (powerEvents.length === 0) {
  console.log("power: NO changes observed — the app's write never became visible on this node.");
  console.log("→ If you pressed START during the window, paste this output: the write is landing elsewhere.");
} else {
  for (let i = 0; i < powerEvents.length; i += 1) {
    const e = powerEvents[i];
    const next = powerEvents[i + 1];
    const survived = next ? `${(next.at - e.at).toFixed(1)}s` : "until the window ended";
    console.log(`power: ${fmt(e.from)} → ${fmt(e.to)} at ${e.at.toFixed(1)}s (held ${survived})`);
  }
  const revert = powerEvents.find((e) => e.to === false && e.from === true);
  if (revert) console.log("→ a true→false flip WITHOUT you pressing STOP means the mock loop erased the app's write.");
}
console.log("==================== END WATCH ====================");
