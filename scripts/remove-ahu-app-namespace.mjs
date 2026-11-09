#!/usr/bin/env node
/**
 * remove-ahu-app-namespace.mjs — one-shot cleanup after the Daikin integration:
 * deletes ONLY the `ahu-app` subtree this app created earlier (while the
 * RTDB_PATH_PREFIX namespace was set). The owner's root nodes
 * (`devices/`, `deviceOwners/`) are NEVER touched.
 *
 * Re-create the data at the root FIRST (idempotent, with the prefix unset):
 *   node --env-file=.env --import tsx scripts/seed-adoption-profiles.ts --apply --admin sh
 *   node --env-file=.env --import tsx scripts/provision-registry.ts
 * Then remove the old namespace copy:
 *   node --env-file=.env scripts/remove-ahu-app-namespace.mjs ahu-app
 *
 * Safety: the subtree name must be passed explicitly and match /^ahu-app$/.
 */

import { readFileSync } from "node:fs";

const target = process.argv[2] ?? "";
if (!/^ahu-app$/.test(target)) {
  console.error('Refusing to run: pass the exact namespace to delete, e.g.  node scripts/remove-ahu-app-namespace.mjs ahu-app');
  process.exit(1);
}

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
  `remove-ns-${Date.now()}`,
);
const db = getDatabase(app);

const existing = (await db.ref(target).get()).val();
if (existing === null) {
  console.log(`${target}/ does not exist — nothing to remove.`);
  process.exit(0);
}
const keys = Object.keys(existing);
console.log(`${target}/ currently holds: ${keys.join(", ")}`);
console.log("Root devices/ and deviceOwners/ are NOT part of this subtree and stay untouched.");
await db.ref(target).remove();
console.log(`✓ removed ${target}/ — the app now works directly with the project's root trees.`);
