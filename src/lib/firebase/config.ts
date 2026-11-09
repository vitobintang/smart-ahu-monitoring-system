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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing Firebase configuration: ${name} is not set`);
  }
  return value.trim();
}

export function getFirebaseClientConfig(env: NodeJS.ProcessEnv = process.env): FirebaseClientConfig {
  const config: FirebaseClientConfig = {
    apiKey: requireEnv("NEXT_PUBLIC_FIREBASE_API_KEY"),
    authDomain: requireEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
    databaseURL: requireEnv("NEXT_PUBLIC_FIREBASE_DATABASE_URL"),
    projectId: requireEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
    storageBucket: requireEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: requireEnv("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"),
    appId: requireEnv("NEXT_PUBLIC_FIREBASE_APP_ID"),
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
