import type { App } from "firebase-admin/app";
import type { Auth } from "firebase-admin/auth";
import type { Database } from "firebase-admin/database";
import type { RtdbAdapter } from "@/lib/rtdb/store";

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
 *
 * NOTE: every firebase-admin import here is a function-scoped dynamic import so
 * that Edge bundles (Next instrumentation/proxy graphs) never include Node-only
 * code statically. Node runtime is the only supported execution path.
 */

const globalForFirebaseAdmin = globalThis as typeof globalThis & {
  __ahFirebaseAdminApp?: App;
};

async function readServiceAccountJson(env: NodeJS.ProcessEnv): Promise<object> {
  const path = env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  const inline = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (path) {
    // Lazy AND bundler-invisible: webpackIgnore/turbopackKeep the Edge bundles
    // from ever resolving "node:fs", while plain ESM runtimes (tsx tests,
    // scripts) execute the real import. (A bare require("node:fs") works only
    // under Next's CommonJS shim and crashes with "require is not defined"
    // in pure ESM — which is exactly what the emulator test suite hit.)
    const fsModule = "node:fs";
    const { readFileSync } = (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ fsModule
    )) as typeof import("node:fs");
    return JSON.parse(readFileSync(path, "utf8")) as object;
  }
  if (inline) {
    return JSON.parse(inline) as object;
  }
  throw new Error(
    "Firebase Admin is not configured: set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON",
  );
}

function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const url = env.FIREBASE_DATABASE_URL?.trim() || env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "Firebase Realtime Database URL is not configured. Set NEXT_PUBLIC_FIREBASE_DATABASE_URL " +
        "(e.g. https://<project>-default-rtdb.<region>.firebasedatabase.app) in .env.local",
    );
  }
  if (!/^https:\/\/.+\.firebasedatabase\.app\/?$/.test(url) && !/^https:\/\/.+\.firebaseio\.com\/?$/.test(url)) {
    throw new Error(`NEXT_PUBLIC_FIREBASE_DATABASE_URL does not look like a Firebase RTDB URL: ${url}`);
  }
  return url.replace(/\/$/, "");
}

async function getApp_(env: NodeJS.ProcessEnv): Promise<App> {
  if (globalForFirebaseAdmin.__ahFirebaseAdminApp) return globalForFirebaseAdmin.__ahFirebaseAdminApp;
  const { cert, getApp, getApps, initializeApp } = await import("firebase-admin/app");
  const existing = getApps().find((app) => app.name === "ahu-admin");
  // databaseURL MUST be explicit: regional RTDB instances are never inferable
  // from the service account alone (the SDK would throw "Can't determine
  // Firebase Database URL").
  const app =
    existing ??
    initializeApp(
      { credential: cert(await readServiceAccountJson(env)), databaseURL: resolveDatabaseUrl(env) },
      "ahu-admin",
    );
  globalForFirebaseAdmin.__ahFirebaseAdminApp = app;
  return app;
}

/** Admin Auth — session cookies, ID-token verification, user management. */
export async function getFirebaseAuth(env: NodeJS.ProcessEnv = process.env): Promise<Auth> {
  const { getAuth } = await import("firebase-admin/auth");
  return getAuth(await getApp_(env));
}

/** Admin Realtime Database — full server-side data access (rules do not apply). */
export async function getFirebaseDb(env: NodeJS.ProcessEnv = process.env): Promise<Database> {
  const { getDatabase } = await import("firebase-admin/database");
  return getDatabase(await getApp_(env));
}

/** Shared RTDB repository adapter (tests use InMemoryRtdb via the same interface). */
export async function getAhuRtdb(env: NodeJS.ProcessEnv = process.env): Promise<RtdbAdapter> {
  const { createAdminRtdbAdapter } = await import("@/lib/rtdb/store");
  return createAdminRtdbAdapter(await getFirebaseDb(env));
}
