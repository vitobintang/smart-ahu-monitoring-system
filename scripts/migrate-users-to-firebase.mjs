#!/usr/bin/env node
/**
 * One-time migration: Supabase (PostgreSQL + Auth) → Firebase (Auth + RTDB).
 *
 * 1. Reads legacy accounts from Supabase:
 *      auth.users            (id, email, bcrypt password hash)
 *      ahu_private.users     (username, full_name, role)
 * 2. Imports them into Firebase Auth via importUsers with BCRYPT password
 *    hashes — **existing passwords keep working**, nobody is locked out.
 * 3. Writes the RTDB auth-profile tree (users/{uid}, usernames/, emails/).
 *    PG rows are untouched (admin UI keeps reading them until Phase 2/3).
 *
 * Required env (same values the app uses):
 *   DATABASE_URL                      Supabase PostgreSQL connection string
 *   FIREBASE_SERVICE_ACCOUNT_PATH     service-account JSON path (or _JSON inline)
 *
 * Dry run first:  node scripts/migrate-users-to-firebase.mjs --dry-run
 * Real run:       node scripts/migrate-users-to-firebase.mjs
 *
 * Supabase is NOT modified and NOT disabled by this script — it stays the
 * source for audit/rate-limit/device/telemetry data until later phases.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

import pg from "pg";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const databaseUrl = process.env.DATABASE_URL;
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (!databaseUrl) {
  console.error("DATABASE_URL is required (Supabase PostgreSQL connection string).");
  process.exit(1);
}
if (!serviceAccountPath && !serviceAccountJson) {
  console.error("FIREBASE_SERVICE_ACCOUNT_PATH (or FIREBASE_SERVICE_ACCOUNT_JSON) is required.");
  process.exit(1);
}

const firebaseDatabaseUrl = (process.env.FIREBASE_DATABASE_URL ?? process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ?? "").trim();
if (!firebaseDatabaseUrl) {
  console.error(
    "NEXT_PUBLIC_FIREBASE_DATABASE_URL is required (the https://...firebasedatabase.app URL from .env.local).",
  );
  process.exit(1);
}

const app = initializeApp({
  credential: serviceAccountPath
    ? cert(JSON.parse(readFileSync(serviceAccountPath, "utf8")))
    : cert(JSON.parse(serviceAccountJson)),
  databaseURL: firebaseDatabaseUrl,
});
const auth = getAuth(app);
const rtdb = getDatabase(app);
const pgClient = new pg.Client({ connectionString: databaseUrl, ssl: /sslmode=require/.test(databaseUrl) ? { rejectUnauthorized: false } : undefined });

const emailKey = (email) => Buffer.from(email.trim().toLowerCase(), "utf8").toString("base64url");
const validRole = (r) => ["Admin", "Engineering", "Operator"].includes(r);

async function main() {
  await pgClient.connect();

  const legacy = await pgClient.query(`
    SELECT u.id, u.email, u.username, u.full_name, u.role,
           a.encrypted_password, a.email_confirmed_at
    FROM ahu_private.users u
    LEFT JOIN auth.users a ON a.id = u.id
    ORDER BY u.created_at ASC
  `);
  console.log(`Found ${legacy.rows.length} legacy user(s) in Supabase.`);
  if (dryRun) {
    for (const row of legacy.rows) {
      console.log(`  - ${row.email} (${row.role}) username=${row.username} hash=${row.encrypted_password ? "present" : "MISSING"}`);
    }
    console.log("Dry run only — re-run without --dry-run to migrate.");
    return;
  }

  // ── 1 · Firebase Auth import (BCRYPT hashes keep existing passwords valid) ──
  const importBatch = [];
  const expectedUids = new Set();
  const skipped = [];
  for (const row of legacy.rows) {
    if (!row.email) { skipped.push([row.id, "no email"]); continue; }
    if (!validRole(row.role)) { skipped.push([row.email, `unsupported role ${row.role}`]); continue; }
    if (!row.encrypted_password) { skipped.push([row.email, "no password hash"]); continue; }
    expectedUids.add(row.id);
    importBatch.push({
      uid: row.id,
      email: row.email.trim().toLowerCase(),
      emailVerified: Boolean(row.email_confirmed_at),
      displayName: row.full_name || undefined,
      passwordHash: Buffer.from(row.encrypted_password.replace(/^\$2y\$/, "$2b$")).toString("base64"),
    });
  }

  const existing = await auth.listUsers(1000);
  const alreadyImported = new Set(existing.users.map((u) => u.uid));
  const toImport = importBatch.filter((u) => !alreadyImported.has(u.uid));

  let importedCount = 0;
  for (let i = 0; i < toImport.length; i += 500) {
    const batch = toImport.slice(i, i + 500);
    const result = await auth.importUsers(
      batch.map((u) => ({ ...u, passwordHash: u.passwordHash })),
      { hash: { algorithm: "BCRYPT" } },
    );
    importedCount += batch.length - result.errors.length;
    for (const err of result.errors) {
      console.error(`  import error idx=${err.index}: ${err.error.message}`);
    }
  }
  console.log(`Firebase Auth: ${importedCount} imported, ${alreadyImported.size} already present.`);

  // ── 2 · RTDB profile tree (same layout src/lib/rtdb/users.ts writes) ──
  let profileCount = 0;
  for (const row of legacy.rows) {
    if (!expectedUids.has(row.id)) continue;
    const uid = row.id;
    const email = row.email.trim().toLowerCase();
    const username = String(row.username || "").toLowerCase();
    const record = {
      id: uid,
      email,
      username,
      fullName: row.full_name || null,
      role: row.role,
      createdAt: new Date(row.created_at ?? Date.now()).getTime(),
      updatedAt: Date.now(),
    };
    const ref = rtdb.ref(`users/${uid}`);
    const snap = await ref.get();
    if (!snap.exists()) {
      await ref.set(record);
      await rtdb.ref(`usernames/${username}`).transaction((cur) => (cur === null ? uid : undefined)).catch(() => null);
      await rtdb.ref(`emails/${emailKey(email)}`).transaction((cur) => (cur === null ? uid : undefined)).catch(() => null);
      profileCount += 1;
    }
  }
  console.log(`RTDB: ${profileCount} profile(s) written (existing ones left untouched).`);

  for (const [id, reason] of skipped) {
    console.warn(`  SKIPPED ${id}: ${reason}`);
  }
  console.log("\nDone. Passwords carried over — users log in exactly as before.");
  console.log("NOTE: audit logs, login rate limiting, browser authorization and telemetry");
  console.log("still read Supabase PostgreSQL until the remaining migration phases land.");
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
