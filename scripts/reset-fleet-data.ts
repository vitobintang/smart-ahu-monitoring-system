/**
 * reset-fleet-data.ts — one-shot: wipe seeded/simulated FLEET data from the
 * APP database (YOUR project). Use this if an older code version auto-seeded
 * the legacy demo fleet (AHU-01..AHU-07) or if you want a clean registry.
 *
 * DELETES (only if present): ahus, gateways, thresholds, telemetry,
 * telemetryLatest, commands, commandActive, alarms, alarmsActive,
 * alarmBreachTimers, trendAlerts, facility.
 *
 * NEVER touched: users/, usernames/, emails/ (accounts), loginAttempts/,
 * auditLogs/ (history) — and the OWNER devices project is not connected at
 * all: this script physically cannot reach it.
 *
 * Safety: refuses to run when the app-data database URL looks like the
 * collaborator project (daikinsmart). Dry-run by default — pass --apply.
 *
 * Env: FIREBASE_SERVICE_ACCOUNT_PATH (+ FIREBASE_DATABASE_URL if the JSON
 * lacks it), RTDB_PATH_PREFIX if you use a namespace.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/reset-fleet-data.ts           # dry run
 *   node --env-file=.env --import tsx scripts/reset-fleet-data.ts --apply   # delete
 */

import { readFileSync } from "node:fs";

const FLEET_NODES = [
  // legacy layout (pre-mirror)
  "ahus",
  "gateways",
  "telemetry",
  "telemetryLatest",
  // mirrored Daikin layout (rebuilt automatically by the sampler)
  "devices",
  "deviceHistory",
  // engine + feature nodes
  "thresholds",
  "commands",
  "commandActive",
  "alarms",
  "alarmsActive",
  "alarmBreachTimers",
  "trendAlerts",
  "facility",
] as const;

/** Nodes this script will never delete, listed so the dry run can show them. */
const PRESERVED_NODES = ["users", "usernames", "emails", "loginAttempts", "auditLogs"] as const;

function die(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!path) die("Set FIREBASE_SERVICE_ACCOUNT_PATH to the APP database service-account .json file.");
const databaseUrl = (
  process.env.FIREBASE_DATABASE_URL ??
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ??
  ""
).trim();
if (!databaseUrl) die("Set FIREBASE_DATABASE_URL (or NEXT_PUBLIC_FIREBASE_DATABASE_URL).");
if (/daikinsmart/i.test(databaseUrl)) {
  die(
    `Refusing: ${databaseUrl} looks like the COLLABORATOR device project. ` +
      "This script only ever resets YOUR app database (FIREBASE_DATABASE_URL must point at your own project).",
  );
}

const apply = process.argv.includes("--apply");

const { initializeApp, cert } = await import("firebase-admin/app");
const { getDatabase } = await import("firebase-admin/database");
const { createAdminRtdbAdapter } = await import("../src/lib/rtdb/store");
const { resolveRtdbPathPrefix } = await import("../src/lib/rtdb/store");

const app = initializeApp(
  { credential: cert(JSON.parse(readFileSync(path, "utf8"))), databaseURL: databaseUrl.replace(/\/+$/, "") },
  `reset-fleet-${Date.now()}`,
);
const rtdb = createAdminRtdbAdapter(getDatabase(app));
const prefix = resolveRtdbPathPrefix();

const node = (name: string): string => (prefix ? `${prefix}/${name}` : name);

console.log(`database : ${databaseUrl}`);
console.log(`namespace: ${prefix || "(root)"}`);
console.log(`mode     : ${apply ? "APPLY — fleet data will be DELETED" : "DRY RUN (pass --apply to delete)"}`);
console.log("");

let total = 0;
const found: string[] = [];
for (const name of FLEET_NODES) {
  const value = await rtdb.get<unknown>(node(name));
  if (value === null || value === undefined) {
    console.log(`  ${name.padEnd(16)} — empty`);
    continue;
  }
  const keys = typeof value === "object" ? Object.keys(value as Record<string, unknown>).length : 1;
  const preview =
    typeof value === "object"
      ? Object.keys(value as Record<string, unknown>)
          .slice(0, 6)
          .map((k) => `${k}`)
          .join(", ")
      : "(scalar)";
  console.log(`  ${name.padEnd(16)} — ${keys} key(s): ${preview}${keys > 6 ? ", …" : ""}`);
  found.push(name);
  total += keys;
}

console.log("");
console.log(`preserved (never deleted): ${PRESERVED_NODES.join(", ")}`);
console.log("");

if (found.length === 0) {
  console.log("Nothing to delete — the fleet nodes are already empty.");
  process.exit(0);
}
if (!apply) {
  console.log(`Dry run: ${found.length} node(s), ${total} top-level key(s) would be deleted. Re-run with --apply.`);
  process.exit(0);
}

for (const name of found) {
  await rtdb.remove(node(name));
  console.log(`✓ deleted ${node(name)}`);
}
console.log("");
console.log("Fleet data reset. Re-seed with provision-registry.ts (it seeds only GTM-DAIKIN-001).");
