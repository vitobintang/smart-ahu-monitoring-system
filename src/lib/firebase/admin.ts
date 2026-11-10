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
  __ahAuthFirebaseApp?: App;
  __ahAuthServiceAccount?: object;
  __ahOwnerFirebaseApp?: App;
  __ahOwnerServiceAccount?: object;
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
  const { cert, getApps, initializeApp } = await import("firebase-admin/app");
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

/* ------------------------------------------------------------------------- */
/* AUTH project (identity)                                                     */
/*                                                                           */
/* Auth accounts live in whichever project the PUBLIC web config belongs to.  */
/* The admin-side Auth operations (session cookies, token verification, user  */
/* management) must therefore use THAT project\'s service account — cascading */
/* FIREBASE_AUTH_SERVICE_ACCOUNT_* -> OWNER_DEVICES_SERVICE_ACCOUNT_* -> the  */
/* main app account. Single-project mode resolves to the main account anyway. */
/* ------------------------------------------------------------------------- */

async function readAuthServiceAccountJson(env: NodeJS.ProcessEnv): Promise<object> {
  if (globalForFirebaseAdmin.__ahAuthServiceAccount) return globalForFirebaseAdmin.__ahAuthServiceAccount;
  const authPath = env.FIREBASE_AUTH_SERVICE_ACCOUNT_PATH?.trim();
  const ownerPath = env.OWNER_DEVICES_SERVICE_ACCOUNT_PATH?.trim();
  const mainPath = env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  const inline =
    env.FIREBASE_AUTH_SERVICE_ACCOUNT_JSON?.trim() ||
    env.OWNER_DEVICES_SERVICE_ACCOUNT_JSON?.trim() ||
    env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const path = authPath || ownerPath || mainPath;
  let parsed: object;
  if (path) {
    const fsModule = "node:fs";
    const { readFileSync } = (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ fsModule
    )) as typeof import("node:fs");
    parsed = JSON.parse(readFileSync(path, "utf8")) as object;
  } else if (inline) {
    parsed = JSON.parse(inline) as object;
  } else {
    parsed = await readServiceAccountJson(env);
  }
  globalForFirebaseAdmin.__ahAuthServiceAccount = parsed;
  return parsed;
}

async function getAuthApp_(env: NodeJS.ProcessEnv): Promise<App> {
  if (globalForFirebaseAdmin.__ahAuthFirebaseApp) return globalForFirebaseAdmin.__ahAuthFirebaseApp;
  const { cert, getApps, initializeApp } = await import("firebase-admin/app");
  const existing = getApps().find((app) => app.name === "ahu-auth");
  const app =
    existing ??
    initializeApp(
      { credential: cert(await readAuthServiceAccountJson(env)), databaseURL: resolveDatabaseUrl(env) },
      "ahu-auth",
    );
  globalForFirebaseAdmin.__ahAuthFirebaseApp = app;
  return app;
}

/** Admin Auth — session cookies, token verification, user management (AUTH project). */
export async function getFirebaseAuth(env: NodeJS.ProcessEnv = process.env): Promise<Auth> {
  const { getAuth } = await import("firebase-admin/auth");
  return getAuth(await getAuthApp_(env));
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

/* ------------------------------------------------------------------------- */
/* OWNER devices project (two-project mode)                                   */
/*                                                                           */
/* The device integrator runs its OWN Firebase project holding ONLY:          */
/*   devices/{id}      — live device state written by the S21 bridge          */
/*   deviceOwners/{id} — the device's pre-shared bearer token (scalar)        */
/* Everything app-owned (users, telemetry history, thresholds, alarms, audit) */
/* lives in THIS project. When OWNER_DEVICES_* is unset, both roles fall back */
/* to the main project (single-project mode).                                 */
/* ------------------------------------------------------------------------- */

function resolveOwnerDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const url = env.OWNER_DEVICES_DATABASE_URL?.trim();
  if (!url) return resolveDatabaseUrl(env);
  if (!/^https:\/\/.+\.firebasedatabase\.app\/?$/.test(url) && !/^https:\/\/.+\.firebaseio\.com\/?$/.test(url)) {
    throw new Error(`OWNER_DEVICES_DATABASE_URL does not look like a Firebase RTDB URL: ${url}`);
  }
  return url.replace(/\/$/, "");
}

/** Same bundler-invisible fs import contract as readServiceAccountJson. */
async function readOwnerServiceAccountText(path: string): Promise<string> {
  const fsModule = "node:fs";
  const { readFileSync } = (await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ fsModule
  )) as typeof import("node:fs");
  return readFileSync(path, "utf8");
}

async function readOwnerServiceAccountJson(env: NodeJS.ProcessEnv): Promise<object> {
  const path = env.OWNER_DEVICES_SERVICE_ACCOUNT_PATH?.trim();
  const inline = env.OWNER_DEVICES_SERVICE_ACCOUNT_JSON?.trim();
  if (globalForFirebaseAdmin.__ahOwnerServiceAccount) return globalForFirebaseAdmin.__ahOwnerServiceAccount;
  let parsed: object;
  if (path) {
    parsed = JSON.parse(await readOwnerServiceAccountText(path)) as object;
  } else if (inline) {
    parsed = JSON.parse(inline) as object;
  } else {
    parsed = await readServiceAccountJson(env);
  }
  globalForFirebaseAdmin.__ahOwnerServiceAccount = parsed;
  return parsed;
}

async function getOwnerApp_(env: NodeJS.ProcessEnv): Promise<App> {
  if (globalForFirebaseAdmin.__ahOwnerFirebaseApp) return globalForFirebaseAdmin.__ahOwnerFirebaseApp;
  const { cert, getApps, initializeApp } = await import("firebase-admin/app");
  const existing = getApps().find((app) => app.name === "ahu-owner");
  const app =
    existing ??
    initializeApp(
      { credential: cert(await readOwnerServiceAccountJson(env)), databaseURL: resolveOwnerDatabaseUrl(env) },
      "ahu-owner",
    );
  globalForFirebaseAdmin.__ahOwnerFirebaseApp = app;
  return app;
}

/**
 * RTDB adapter for the OWNER devices project (root layout, never prefixed —
 * the device tree shape is the integrator's contract). Falls back to the main
 * project when OWNER_DEVICES_* is unset.
 */
export async function getOwnerRtdb(env: NodeJS.ProcessEnv = process.env): Promise<RtdbAdapter> {
  const { getDatabase } = await import("firebase-admin/database");
  const { createAdminRtdbAdapter } = await import("@/lib/rtdb/store");
  return createAdminRtdbAdapter(getDatabase(await getOwnerApp_(env)), "");
}

/** Like getOwnerRtdb but null-safe for optional integration paths. */
export async function tryGetOwnerRtdb(env: NodeJS.ProcessEnv = process.env): Promise<RtdbAdapter | null> {
  try {
    return await getOwnerRtdb(env);
  } catch (err) {
    console.error("[owner-rtdb] unavailable:", err instanceof Error ? err.message : err);
    return null;
  }
}
