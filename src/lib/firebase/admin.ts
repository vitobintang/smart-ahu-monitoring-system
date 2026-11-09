import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getDatabase, type Database } from "firebase-admin/database";
import { readFileSync } from "node:fs";

/**
 * Server-side Firebase Admin SDK bootstrap (Auth + Realtime Database).
 *
 * Credentials come from exactly one of:
 *   FIREBASE_SERVICE_ACCOUNT_PATH  — path to the downloaded service-account JSON
 *   FIREBASE_SERVICE_ACCOUNT_JSON  — the full JSON inlined (for hosts without a filesystem)
 *
 * These are SERVER-ONLY secrets: never prefix them with NEXT_PUBLIC_ and never
 * commit the JSON. The Admin SDK bypasses RTDB security rules by design — all
 * application data access is supposed to flow through this trusted server.
 */

function readServiceAccountJson(env: NodeJS.ProcessEnv = process.env): object {
  const path = env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  const inline = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (path) {
    return JSON.parse(readFileSync(path, "utf8")) as object;
  }
  if (inline) {
    return JSON.parse(inline) as object;
  }
  throw new Error(
    "Firebase Admin is not configured: set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON",
  );
}

const globalForFirebaseAdmin = globalThis as typeof globalThis & {
  __ahFirebaseAdminApp?: App;
};

export function getFirebaseAdminApp(env: NodeJS.ProcessEnv = process.env): App {
  if (globalForFirebaseAdmin.__ahFirebaseAdminApp) return globalForFirebaseAdmin.__ahFirebaseAdminApp;
  const existing = getApps().find((app) => app.name === "ahu-admin");
  const app = existing ?? initializeApp({ credential: cert(readServiceAccountJson(env)) }, "ahu-admin");
  globalForFirebaseAdmin.__ahFirebaseAdminApp = app;
  return app;
}

/** Admin Auth — session cookies, ID-token verification, user management. */
export function getFirebaseAuth(env: NodeJS.ProcessEnv = process.env): Auth {
  return getAuth(getFirebaseAdminApp(env));
}

/** Admin Realtime Database — full server-side data access (rules do not apply). */
export function getFirebaseDb(env: NodeJS.ProcessEnv = process.env): Database {
  return getDatabase(getFirebaseAdminApp(env));
}
