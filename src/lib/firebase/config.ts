/**
 * Public Firebase web-app configuration (safe to expose — Firebase web API keys
 * identify the project, they do not grant access; RTDB rules + server-side
 * verification are the actual security boundary).
 *
 * Required environment variables (see .env.example):
 *   NEXT_PUBLIC_FIREBASE_API_KEY
 *   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
 *   NEXT_PUBLIC_FIREBASE_DATABASE_URL
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID
 *   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
 *   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
 *   NEXT_PUBLIC_FIREBASE_APP_ID
 */

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

// NEXT_PUBLIC_* values reach the BROWSER bundle only through static member
// access (`process.env.NEXT_PUBLIC_X`) — bundlers inline those literals at
// build time. A dynamic lookup like `process.env[name]` cannot be inlined,
// so in the browser it is always undefined even when .env.local is correct.
// This snapshot is inlined for client code; server code reads the live env.
const STATIC_PUBLIC_CONFIG = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
} as const;

function requireValue(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Missing Firebase configuration: ${name} is not set`);
  }
  return trimmed;
}

export function getFirebaseClientConfig(env: NodeJS.ProcessEnv = process.env): FirebaseClientConfig {
  const config: FirebaseClientConfig = {
    apiKey: requireValue("NEXT_PUBLIC_FIREBASE_API_KEY", env.NEXT_PUBLIC_FIREBASE_API_KEY ?? STATIC_PUBLIC_CONFIG.apiKey),
    authDomain: requireValue("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? STATIC_PUBLIC_CONFIG.authDomain),
    databaseURL: requireValue("NEXT_PUBLIC_FIREBASE_DATABASE_URL", env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ?? STATIC_PUBLIC_CONFIG.databaseURL),
    projectId: requireValue("NEXT_PUBLIC_FIREBASE_PROJECT_ID", env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? STATIC_PUBLIC_CONFIG.projectId),
    storageBucket: requireValue("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? STATIC_PUBLIC_CONFIG.storageBucket),
    messagingSenderId: requireValue("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? STATIC_PUBLIC_CONFIG.messagingSenderId),
    appId: requireValue("NEXT_PUBLIC_FIREBASE_APP_ID", env.NEXT_PUBLIC_FIREBASE_APP_ID ?? STATIC_PUBLIC_CONFIG.appId),
  };

  // Web API keys are `AIza` + 33 chars of base64url. This is a shape check so a
  // mis-pasted value fails loudly at startup instead of at first sign-in.
  if (!/^AIza[0-9A-Za-z_-]{33}$/.test(config.apiKey)) {
    throw new Error("Invalid Firebase configuration: NEXT_PUBLIC_FIREBASE_API_KEY has an unexpected format");
  }
  if (!/^https:\/\/[a-z0-9-]+(-[a-z0-9]+)*(\.[-a-z0-9]+)*\.firebasedatabase\.app\/?$/.test(config.databaseURL)) {
    throw new Error("Invalid Firebase configuration: NEXT_PUBLIC_FIREBASE_DATABASE_URL must be a *.firebasedatabase.app URL");
  }
  if (!/^[a-z0-9-]{4,40}$/.test(config.projectId)) {
    throw new Error("Invalid Firebase configuration: NEXT_PUBLIC_FIREBASE_PROJECT_ID has an unexpected format");
  }
  return config;
}
