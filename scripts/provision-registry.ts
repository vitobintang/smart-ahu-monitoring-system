/**
 * provision-registry.ts — one-shot: seed the fleet registry on YOUR app
 * database: devices/{id}/app metadata + thresholds for the single real unit
 * `GTM-DAIKIN-001` (the collaborator's Daikin S21 monitor). Live data is NOT
 * seeded here — the running app mirrors the owner tree's devices/ verbatim.
 * Idempotent: existing records are left untouched.
 *
 * Reads .env.local values from the environment (never reads the file itself):
 *   FIREBASE_SERVICE_ACCOUNT_PATH  the APP project's service-account JSON
 *   FIREBASE_DATABASE_URL          or NEXT_PUBLIC_FIREBASE_DATABASE_URL
 *   RTDB_PATH_PREFIX               optional namespace (leave empty: your own project)
 *
 * Usage (from the repo root):
 *   node --env-file=.env.local --import tsx scripts/provision-registry.ts
 *   # or set the env vars manually and drop --env-file
 *
 * The script prints created records before writing anything.
 */

/* ── bootstrap ───────────────────────────────────────────────────────────── */

import { readFileSync } from "node:fs";

function die(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const FLEET_ID = "GTM-DAIKIN-001";

function loadServiceAccount() {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) die("Set FIREBASE_SERVICE_ACCOUNT_PATH to the APP database service-account .json file.");
  return JSON.parse(readFileSync(path, "utf8"));
}

const databaseUrl = (
  process.env.FIREBASE_DATABASE_URL ??
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ??
  ""
).trim();
if (!databaseUrl) die("Set FIREBASE_DATABASE_URL (or NEXT_PUBLIC_FIREBASE_DATABASE_URL).");

const apply = process.argv.includes("--apply");

const { initializeApp, cert } = await import("firebase-admin/app");
const { getDatabase } = await import("firebase-admin/database");
const { createAdminRtdbAdapter } = await import("../src/lib/rtdb/store");
const { resolveRtdbPathPrefix } = await import("../src/lib/rtdb/store");
const { defaultAhuRecord, THRESHOLDS_NODE } = await import("../src/lib/rtdb/registry");

const app = initializeApp(
  { credential: cert(loadServiceAccount()), databaseURL: databaseUrl.replace(/\/+$/, "") },
  `provision-fleet-${Date.now()}`,
);
const rtdb = createAdminRtdbAdapter(getDatabase(app));
const prefix = resolveRtdbPathPrefix();
const n = (name: string): string => (prefix ? `${prefix}/${name}` : name);

const maskEmail = (email: string) => {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
};

console.log(`database : ${databaseUrl}`);
console.log(`namespace: ${prefix || "(root)"}`);
console.log(`mode     : ${apply ? "APPLY — registry will be created" : "DRY RUN (pass --apply to write)"}`);
console.log("");

/* ── plan ────────────────────────────────────────────────────────────────── */

const existingMeta = await rtdb.get<Record<string, unknown>>(n(`devices/${FLEET_ID}/app`));
const existingThresholds = (await rtdb.get<Record<string, unknown>>(n(`${THRESHOLDS_NODE}/${FLEET_ID}`))) ?? {};
const thresholdCount = Object.keys(existingThresholds).length;

const fleetMeta = defaultAhuRecord(FLEET_ID);
// The unit's pre-shared token is already in the owner's deviceOwners/ tree:
// the app IS the commissioned controller for it.
fleetMeta.physicalControlEnabled = true;
fleetMeta.location = "Daikin S21 bridge unit";

const thresholdSeed: Array<Record<string, unknown>> = (fleetMeta.installedSensors ?? []).map((parameter: string) => ({
  ahuId: FLEET_ID,
  parameter,
  enabled: true,
  lowLimit: parameter === "roomTemp" ? 18 : parameter === "fanSpeed" ? 0 : null,
  highLimit: parameter === "roomTemp" ? 30 : parameter === "fanSpeed" ? 5 : null,
  delaySec: 60,
  priority: "MEDIUM",
  validMin: null,
  validMax: null,
  unit: parameter === "roomTemp" ? "°C" : parameter === "fanSpeed" ? "speed" : null,
  label: parameter,
  trendEnabled: false,
  updatedAt: Date.now(),
}));

console.log(`fleet unit ${FLEET_ID}:`);
console.log(`  devices/${FLEET_ID}/app — ${existingMeta ? "exists (kept)" : "will be created"}`);
console.log(`  ${THRESHOLDS_NODE}/${FLEET_ID} — ${thresholdCount} existing; ${thresholdSeed.length - thresholdCount} to add`);
for (const t of thresholdSeed) {
  if (!(t.parameter as string in existingThresholds)) {
    console.log(`    + ${(t.parameter as string).padEnd(12)} [${t.lowLimit ?? "–"} … ${t.highLimit ?? "–"}] ${t.unit ?? ""}`);
  }
}
console.log("");
console.log("Note: the device's live data appears automatically once the app runs —");
console.log("the sampler mirrors the owner tree's devices/ into this database.");

if (!apply) {
  console.log("");
  console.log("Dry run complete. Re-run with --apply to write.");
  process.exit(0);
}

if (!existingMeta) {
  // RTDB rejects undefined values — omit `id` (it is the path key) properly.
  const { id: _ignored, ...appMeta } = fleetMeta;
  void _ignored;
  await rtdb.set(n(`devices/${FLEET_ID}/app`), appMeta);
  console.log(`✓ created devices/${FLEET_ID}/app`);
}
for (const t of thresholdSeed) {
  const key = t.parameter as string;
  if (key in existingThresholds) continue;
  await rtdb.set(n(`${THRESHOLDS_NODE}/${FLEET_ID}/${key}`), t);
  console.log(`✓ threshold ${key}`);
}
console.log("");
console.log("Done — start the app; live data syncs within ~5 s.");
