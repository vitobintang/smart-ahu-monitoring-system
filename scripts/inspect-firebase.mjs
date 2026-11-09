#!/usr/bin/env node
/**
 * inspect-firebase.mjs — safe structural report of a Firebase project.
 *
 * Purpose: understand an EXISTING Firebase project (e.g. a friend's) before
 * pointing the Smart AHU app at it — without the Firebase Console.
 *
 * What it prints (all REDACTED, safe to paste in chat):
 *   - project id + RTDB region/URL in use
 *   - RTDB tree: node names, child counts, day-shard keys, and for sample
 *     records only FIELD NAMES + types. Values are printed for a small
 *     allowlist of non-sensitive fields (role, status, enabled, ...).
 *   - Auth users: uid, MASKED email, providers, verified/disabled flags
 *   - security rules: top-level shape only (is the database locked?)
 *
 * What it NEVER prints: token values, the service-account JSON, unmasked
 * emails/usernames, message/telemetry values.
 *
 * Usage (PowerShell, from the repo root):
 *   $env:FIREBASE_SERVICE_ACCOUNT_PATH = "E:\path\to\friend-service-account.json"
 *   $env:FIREBASE_DATABASE_URL = "https://<project>-default-rtdb.<region>.firebasedatabase.app"  # optional — auto-derived if omitted
 *   node scripts/inspect-firebase.mjs
 *
 * Paste everything between the SAFE-TO-PASTE banners.
 */

import { readFileSync } from "node:fs";

/* ── credential loading (never echoed) ──────────────────────────────────── */

function loadServiceAccount() {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim().startsWith("{")) return JSON.parse(raw);
  if (path) return JSON.parse(readFileSync(path, "utf8"));
  console.error("Set FIREBASE_SERVICE_ACCOUNT_PATH (or GOOGLE_APPLICATION_CREDENTIALS) to the service-account .json file.");
  console.error("NEVER paste the JSON itself into chat — this script's output is the safe alternative.");
  process.exit(1);
}

const serviceAccount = loadServiceAccount();
const projectId = serviceAccount.project_id;

/* ── database URL resolution (known URL, else probe candidates) ─────────── */

const REGION_CANDIDATES = [
  null, // legacy us-central1 host: NAME-default-rtdb.firebaseio.com
  "asia-southeast1",
  "asia-southeast2",
  "asia-east1",
  "europe-west1",
  "us-central1",
  "northamerica-northeast1",
];

function candidateUrls() {
  const envUrl = (process.env.FIREBASE_DATABASE_URL ?? process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ?? "").trim();
  const urls = [];
  if (envUrl) urls.push(envUrl.replace(/\/+$/, ""));
  const name = `${projectId}-default-rtdb`;
  for (const region of REGION_CANDIDATES) {
    const host = region ? `${name}.${region}.firebasedatabase.app` : `${name}.firebaseio.com`;
    urls.push(`https://${host}`);
  }
  return [...new Set(urls)];
}

async function probe(url, token) {
  try {
    const res = await fetch(`${url}/.json?shallow=true`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),
    });
    return res.ok ? true : false;
  } catch {
    return false;
  }
}

/* ── firebase-admin bootstrap ────────────────────────────────────────────── */

const { initializeApp, cert } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");

const app = initializeApp(
  { credential: cert(serviceAccount), projectId, databaseURL: candidateUrls()[0] },
  `inspect-${Date.now()}`,
);
const token = (await app.options.credential.getAccessToken()).access_token;

let baseUrl = (process.env.FIREBASE_DATABASE_URL ?? process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ?? "").trim().replace(/\/+$/, "");
if (baseUrl) {
  if (!(await probe(baseUrl, token))) {
    console.error(`\nThe URL in FIREBASE_DATABASE_URL did not respond: ${baseUrl}`);
    console.error("Check the region in the host, or unset the variable and let the script probe common regions.");
    process.exit(1);
  }
} else {
  baseUrl = "";
  for (const candidate of candidateUrls()) {
    if (await probe(candidate, token)) {
      baseUrl = candidate;
      break;
    }
  }
  if (!baseUrl) {
    console.error("\nCould not reach a Realtime Database for this project (tried common regions).");
    console.error("Ask the project owner for the exact databaseURL from their firebaseConfig and set FIREBASE_DATABASE_URL.");
    process.exit(1);
  }
}

/* ── redaction helpers ───────────────────────────────────────────────────── */

const SAFE_VALUES = new Set([
  "role", "status", "enabled", "sourceType", "isActive", "parameter", "priority",
  "currentStatus", "desiredRunState", "commandType", "runState", "isCustom",
  "acknowledged", "type", "mode", "label", "id", "ahuId",
]);

const maskEmail = (v) =>
  typeof v === "string" && v.includes("@") ? `${v.slice(0, 2)}***@${v.split("@").slice(1).join("@")}` : "***";
const mask = (v) => (typeof v === "string" && v.length > 2 ? `${v.slice(0, 2)}***` : "***");

function typeName(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return `array[${v.length}]`;
  if (typeof v === "object") return "object";
  return typeof v;
}

/** One sample record → "field:type" list; values only for the SAFE allowlist. */
function describeRecord(record) {
  if (record === null || typeof record !== "object") return `scalar ${typeName(record)}`;
  if (Array.isArray(record)) return `array[${record.length}]`;
  const entries = Object.entries(record);
  const shown = entries.slice(0, 30).map(([k, v]) => {
    if (SAFE_VALUES.has(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
      return `${k}: ${String(v).slice(0, 40)}`;
    }
    return `${k}: ${typeName(v)}`;
  });
  return shown.join(", ") + (entries.length > 30 ? `, …+${entries.length - 30} more` : "");
}

/* ── shallow RTDB walking (cheap even for huge trees) ────────────────────── */

async function shallowKeys(path) {
  const u = `${baseUrl}/${path ? `${path}/` : ""}.json?shallow=true`;
  const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} at ${path || "/"}`);
  const data = await res.json();
  if (data === null) return { leaf: true, keys: [] };
  if (typeof data === "object" && !Array.isArray(data)) return { leaf: false, keys: Object.keys(data).sort() };
  return { leaf: true, keys: [] };
}

async function fullGet(path) {
  const res = await fetch(`${baseUrl}/${path}.json`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} at ${path}`);
  return res.json();
}

const show = (keys, cap = 12) =>
  keys.slice(0, cap).join(", ") + (keys.length > cap ? `, …+${keys.length - cap} more` : "");

/* ── node-specific summaries ─────────────────────────────────────────────── */

async function summarizeUsers() {
  const { leaf, keys } = await shallowKeys("users");
  if (leaf) return `  users/: scalar (${typeName(await fullGet("users"))})`;
  let out = `  users/: ${keys.length} account(s) → ${show(keys, 20)}`;
  if (keys.length > 0) {
    try {
      const sample = await fullGet(`users/${keys[0]}`);
      out += `\n    sample fields: ${describeRecord(sample)}`;
    } catch { /* ignore */ }
  }
  return out;
}

async function summarizeMirrors(node, maskFn) {
  const { leaf, keys } = await shallowKeys(node);
  if (leaf) return `  ${node}/: (empty)`;
  return `  ${node}/: ${keys.length} entr(ies) → ${show(keys.map(maskFn), 8)}`;
}

async function summarizeAhus() {
  const { leaf, keys } = await shallowKeys("ahus");
  if (leaf) return "  ahus/: (empty)";
  let out = `  ahus/: ${keys.length} unit(s) → ${show(keys, 20)}`;
  try {
    const sample = await fullGet(`ahus/${keys[0]}`);
    out += `\n    sample fields: ${describeRecord(sample)}`;
  } catch { /* ignore */ }
  return out;
}

async function summarizeDevices() {
  const { leaf, keys } = await shallowKeys("devices");
  if (leaf) return "  devices/: (empty)";
  let out = `  devices/: ${keys.length} AHU group(s) → ${show(keys, 12)}`;
  for (const ahuId of keys.slice(0, 3)) {
    try {
      const { keys: deviceIds } = await shallowKeys(`devices/${ahuId}`);
      out += `\n    ${ahuId}: ${deviceIds.length} device(s)`;
      if (deviceIds.length > 0) {
        const sample = await fullGet(`devices/${ahuId}/${deviceIds[0]}`);
        out += ` — sample fields: ${describeRecord(sample)}`;
      }
    } catch (err) {
      out += `\n    ${ahuId}: read failed (${err.message})`;
    }
  }
  return out;
}

async function summarizeThresholds() {
  const { leaf, keys } = await shallowKeys("thresholds");
  if (leaf) return "  thresholds/: (empty)";
  let out = `  thresholds/: ${keys.length} AHU group(s) → ${show(keys, 12)}`;
  try {
    const { keys: params } = await shallowKeys(`thresholds/${keys[0]}`);
    out += `\n    ${keys[0]}: parameters → ${show(params, 20)}`;
  } catch { /* ignore */ }
  return out;
}

async function summarizeTelemetry() {
  const { leaf, keys } = await shallowKeys("telemetry");
  if (leaf) return "  telemetry/: (empty — no history)";
  let out = `  telemetry/: ${keys.length} AHU stream(s) → ${show(keys, 12)}`;
  for (const ahuId of keys.slice(0, 4)) {
    try {
      const { keys: shards } = await shallowKeys(`telemetry/${ahuId}`);
      const sorted = shards.sort();
      out += `\n    ${ahuId}: ${shards.length} day shard(s)${sorted.length ? ` (${sorted[0]} … ${sorted[sorted.length - 1]})` : ""}`;
      for (const shard of sorted.slice(-2)) {
        const { keys: messages } = await shallowKeys(`telemetry/${ahuId}/${shard}`);
        out += `\n      ${shard}: ~${messages.length} message(s)`;
      }
    } catch (err) {
      out += `\n    ${ahuId}: read failed (${err.message})`;
    }
  }
  return out;
}

async function summarizeLatest() {
  const { leaf, keys } = await shallowKeys("telemetryLatest");
  if (leaf) return "  telemetryLatest/: (empty)";
  let out = `  telemetryLatest/: ${keys.length} unit(s) → ${show(keys, 12)}`;
  try {
    const sample = await fullGet(`telemetryLatest/${keys[0]}`);
    out += `\n    sample fields: ${describeRecord(sample)}`;
  } catch { /* ignore */ }
  return out;
}

async function summarizeGeneric(node) {
  const { leaf, keys } = await shallowKeys(node);
  if (leaf) return `  ${node}/: (empty or scalar)`;
  let out = `  ${node}/: ${keys.length} child key(s) → ${show(keys, 10)}`;
  if (keys.length > 0) {
    try {
      const sample = await fullGet(`${node}/${keys[0]}`);
      out += `\n    sample fields: ${describeRecord(sample)}`;
    } catch { /* ignore */ }
  }
  return out;
}

const KNOWN_NODES = {
  users: summarizeUsers,
  usernames: () => summarizeMirrors("usernames", mask),
  emails: () => summarizeMirrors("emails", maskEmail),
  ahus: summarizeAhus,
  devices: summarizeDevices,
  thresholds: summarizeThresholds,
  telemetry: summarizeTelemetry,
  telemetryLatest: summarizeLatest,
  commands: (n = "commands") => summarizeGeneric(n),
  alarms: (n = "alarms") => summarizeGeneric(n),
};

/* ── security rules verdict ──────────────────────────────────────────────── */

async function summarizeRules() {
  try {
    const res = await fetch(`${baseUrl}/.settings/rules.json`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return `  (rules not readable with this service account — HTTP ${res.status})`;
    const rules = await res.json();
    const root = rules?.rules ?? {};
    const verdicts = [];
    if (root[".read"] === true) verdicts.push("WARNING: root .read is TRUE — the whole database is world-readable!");
    if (root[".write"] === true) verdicts.push("WARNING: root .write is TRUE — the whole database is world-writable!");
    if (root[".read"] === false && root[".write"] === false) verdicts.push("root locked (.read/.write false) — server-only access, matches our contract");
    const branches = Object.keys(root).filter((k) => !k.startsWith("."));
    return `  ${verdicts.join("; ")}\n  rule branches: ${show(branches, 12)}`;
  } catch (err) {
    return `  (rules check failed: ${err.message})`;
  }
}

/* ── auth users ──────────────────────────────────────────────────────────── */

async function summarizeAuth() {
  const auth = getAuth(app);
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken && users.length < 5000);

  let out = `  ${users.length} Auth user(s)`;
  for (const u of users.slice(0, 30)) {
    out += `\n    ${u.uid} | ${maskEmail(u.email)} | providers: ${(u.providerData.map((p) => p.providerId).join("+") || "none")} | verified: ${u.emailVerified} | disabled: ${u.disabled} | created: ${u.metadata.creationTime}`;
  }
  if (users.length > 30) out += `\n    …+${users.length - 30} more`;
  return out;
}

/* ── report ──────────────────────────────────────────────────────────────── */

const host = new URL(baseUrl).host;
const region = host.endsWith(".firebaseio.com") ? "us-central1 (legacy host)" : host.split(".").slice(1, -1).join(".") || "unknown";

console.log("Review the output below, then paste everything between the banners.");
console.log("==================== SAFE-TO-PASTE START ====================");
console.log(`project: ${projectId}`);
console.log(`database: ${baseUrl}`);
console.log(`region: ${region}`);
console.log("");

try {
  const root = await shallowKeys("");
  console.log(`RTDB root: ${root.leaf ? "(scalar)" : `${root.keys.length} top-level node(s)`}`);
  for (const node of root.keys) {
    try {
      const handler = KNOWN_NODES[node];
      console.log(handler ? await handler(node) : await summarizeGeneric(node));
    } catch (err) {
      console.log(`  ${node}/: read failed (${err.message})`);
    }
  }
  if (root.keys.length === 0) console.log("  (the Realtime Database is completely empty — a fresh start)");

  console.log("");
  console.log("Security rules:");
  console.log(await summarizeRules());

  console.log("");
  console.log("Firebase Auth:");
  console.log(await summarizeAuth());
} catch (err) {
  console.log(`\nReport failed partway: ${err.message}`);
  console.log("(partial output above is still valid — paste what printed)");
}
console.log("==================== SAFE-TO-PASTE END ======================");
