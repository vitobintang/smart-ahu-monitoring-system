/**
 * seed-adoption-profiles.ts — one-shot: create RTDB role profiles in the APP
 * database for Auth accounts that already exist on the AUTH project.
 *
 * Auth accounts (credentials) are NOT touched and stay wherever identity
 * lives (the collaborator project by default — see FIREBASE_AUTH_* in
 * .env.example). Existing users keep their email + password and can sign in
 * immediately once a `users/{uid}` profile (role/username mirrors) exists in
 * the APP database — which is what this script creates using the app's own
 * claim logic (src/lib/rtdb/users.ts).
 *
 * Reads .env.local values from the environment (never reads the file itself):
 *   FIREBASE_SERVICE_ACCOUNT_PATH        the APP database service account
 *   FIREBASE_AUTH_SERVICE_ACCOUNT_PATH   the AUTH project\'s service account
 *                                        (defaults: OWNER_DEVICES_* then the app one)
 *   FIREBASE_DATABASE_URL                or NEXT_PUBLIC_FIREBASE_DATABASE_URL
 *   RTDB_PATH_PREFIX                     optional namespace
 *
 * Usage:
 *   DRY RUN (default — shows the plan, writes nothing):
 *     node --env-file=.env.local --import tsx scripts/seed-adoption-profiles.ts
 *   APPLY:
 *     node --env-file=.env.local --import tsx scripts/seed-adoption-profiles.ts --apply
 *   Promote matching account(s) to Admin (substring of uid or email):
 *     ... --apply --admin <substring>        (repeat --admin to promote several)
 *
 * Usernames are derived from the email local part; collisions get -2/-3…suffixes.
 * Existing profiles are never modified.
 */

import { readFileSync } from "node:fs";

import { createAdminRtdbAdapter, resolveRtdbPathPrefix, type RtdbAdapter } from "../src/lib/rtdb/store";
import {
  createRtdbUser,
  getRtdbUserByUsername,
  getRtdbUserById,
  UsernameTakenError,
} from "../src/lib/rtdb/users";

/* ── bootstrap ───────────────────────────────────────────────────────────── */

function die(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const dataPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!dataPath) die("Set FIREBASE_SERVICE_ACCOUNT_PATH to the APP database service-account .json file.");
// Auth accounts are listed from the AUTH project (see FIREBASE_AUTH_* in .env.example).
const authPath =
  process.env.FIREBASE_AUTH_SERVICE_ACCOUNT_PATH ??
  process.env.OWNER_DEVICES_SERVICE_ACCOUNT_PATH ??
  dataPath;
const databaseUrl = (
  process.env.FIREBASE_DATABASE_URL ??
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ??
  ""
).trim();
if (!databaseUrl) die("Set FIREBASE_DATABASE_URL (or NEXT_PUBLIC_FIREBASE_DATABASE_URL).");

const apply = process.argv.includes("--apply");
const adminMatches = process.argv
  .map((arg, i) => (arg === "--admin" ? process.argv[i + 1] : null))
  .filter((v): v is string => Boolean(v && v.trim()));

const { initializeApp, cert } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getDatabase } = await import("firebase-admin/database");

const authApp = initializeApp(
  { credential: cert(JSON.parse(readFileSync(authPath, "utf8"))), databaseURL: databaseUrl.replace(/\/+$/, "") },
  `seed-profiles-auth-${Date.now()}`,
);
const dataApp = initializeApp(
  { credential: cert(JSON.parse(readFileSync(dataPath, "utf8"))), databaseURL: databaseUrl.replace(/\/+$/, "") },
  `seed-profiles-data-${Date.now()}`,
);
const rtdb: RtdbAdapter = createAdminRtdbAdapter(getDatabase(dataApp));
const prefix = resolveRtdbPathPrefix();

const maskEmail = (email: string) => {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
};

console.log(`database : ${databaseUrl}`);
console.log(`namespace: ${prefix || "(root)"}`);
console.log(`mode     : ${apply ? "APPLY — profiles will be created" : "DRY RUN (pass --apply to write)"}`);
console.log("");

/* ── plan ────────────────────────────────────────────────────────────────── */

const auth = getAuth(authApp);
const authUsers: Array<{ uid: string; email: string; displayName: string | null }> = [];
let pageToken: string | undefined;
do {
  const page = await auth.listUsers(1000, pageToken);
  for (const u of page.users) {
    if (u.email) authUsers.push({ uid: u.uid, email: u.email, displayName: u.displayName ?? null });
  }
  pageToken = page.pageToken;
} while (pageToken);

if (authUsers.length === 0) die("No Firebase Auth users with an email found on this project.");

function deriveUsername(email: string): string {
  const base = email.split("@")[0].trim().toLowerCase().replace(/[^a-z0-9._-]+/g, ".");
  const trimmed = base.replace(/^\.+|\.+$/g, "").slice(0, 32);
  if (trimmed.length >= 3) return trimmed;
  const padded = `user.${trimmed.replace(/\./g, "")}`;
  return padded.slice(0, 32).padEnd(3, "0");
}

async function freeUsername(candidate: string): Promise<string> {
  if (!(await getRtdbUserByUsername(rtdb, candidate))) return candidate;
  for (let n = 2; n < 100; n += 1) {
    const suffixed = `${candidate.slice(0, 32 - String(n).length - 1)}-${n}`;
    if (!(await getRtdbUserByUsername(rtdb, suffixed))) return suffixed;
  }
  throw new Error(`No free username derived from "${candidate}"`);
}

const isAdminMatch = (uid: string, email: string) =>
  adminMatches.length === 0 ? false : adminMatches.some((m) => uid.includes(m) || email.toLowerCase().includes(m.toLowerCase()));

const plans: Array<{ uid: string; email: string; username: string; role: "Admin" | "Engineering" | "Operator"; fullName: string | null }> = [];
for (const user of authUsers) {
  if (await getRtdbUserById(rtdb, user.uid)) {
    console.log(`= ${maskEmail(user.email)} (${user.uid}) already has a profile — left untouched`);
    continue;
  }
  plans.push({
    uid: user.uid,
    email: user.email,
    username: await freeUsername(deriveUsername(user.email)),
    role: isAdminMatch(user.uid, user.email) ? "Admin" : "Operator",
    fullName: user.displayName,
  });
}

for (const plan of plans) {
  console.log(`+ ${maskEmail(plan.email)} → username "${plan.username}", role ${plan.role}${plan.fullName ? ` (${plan.fullName})` : ""}`);
}

if (adminMatches.length > 0) {
  const matched = plans.filter((p) => isAdminMatch(p.uid, p.email));
  if (matched.length === 0) console.log(`⚠ --admin "${adminMatches.join('", "')}" matched no pending account.`);
}

if (plans.length === 0) {
  console.log("");
  console.log("Nothing to do — every Auth user already has a profile.");
  process.exit(0);
}

if (!apply) {
  console.log("");
  console.log("Dry run only. Re-run with --apply to create the profiles above.");
  process.exit(0);
}

/* ── apply ───────────────────────────────────────────────────────────────── */

console.log("");
const created: Array<{ email: string; role: string; username: string }> = [];
for (const plan of plans) {
  try {
    const record = await createRtdbUser(rtdb, {
      uid: plan.uid,
      email: plan.email,
      username: plan.username,
      fullName: plan.fullName,
      role: plan.role,
    });
    created.push({ email: maskEmail(record.email), role: record.role, username: record.username });
    console.log(`✓ created profile for ${maskEmail(record.email)} (${record.role}, "${record.username}")`);
  } catch (err) {
    if (err instanceof UsernameTakenError) {
      console.error(`✗ username race for ${maskEmail(plan.email)} — re-run the script`);
    } else {
      console.error(`✗ failed for ${maskEmail(plan.email)}:`, err instanceof Error ? err.message : err);
    }
    process.exitCode = 1;
  }
}

console.log("");
console.log(`Created ${created.length} profile(s). These users can now sign in with their EXISTING email + password.`);
if (created.some((c) => c.role === "Admin")) {
  console.log("Admin account(s) created — sign in and manage further users from Admin → Users.");
} else if (created.length > 0) {
  console.log("⚠ No Admin among them. The first admin must be promoted manually (re-run with --admin <match>),");
  console.log("  because the Admin → Users UI requires an admin session.");
}
