"use client";

/**
 * Browser-side Firebase initialization — used ONLY for the Google Sign-In popup
 * on /login. All other data flows through the app's own authenticated APIs.
 * Loaded lazily so the firebase client chunk never touches server-only code.
 */

import { getFirebaseClientConfig, type FirebaseClientConfig } from "./config";

let configCache: FirebaseClientConfig | null = null;

export function readClientConfig(): FirebaseClientConfig {
  configCache ??= getFirebaseClientConfig();
  return configCache;
}

export async function signInWithGooglePopup(): Promise<{ idToken: string }> {
  const [{ initializeApp, getApps, getApp }, { getAuth, GoogleAuthProvider, signInWithPopup }] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ]);
  const app = getApps().length ? getApp() : initializeApp(readClientConfig());
  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const credential = await signInWithPopup(auth, provider);
  const idToken = await credential.user.getIdToken();
  return { idToken };
}

/** Exchanges a one-time server relink token for an ID token of the ORIGINAL account. */
export async function relinkWithCustomToken(customToken: string): Promise<string> {
  const [{ initializeApp, getApps, getApp }, { getAuth, signInWithCustomToken }] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ]);
  const app = getApps().length ? getApp() : initializeApp(readClientConfig());
  const credential = await signInWithCustomToken(getAuth(app), customToken);
  return credential.user.getIdToken();
}

/** Signs the browser out of Firebase (the app session cookie is cleared server-side). */
export async function signOutFirebaseClient(): Promise<void> {
  const [{ getApps, getApp }, { getAuth }] = await Promise.all([import("firebase/app"), import("firebase/auth")]);
  if (!getApps().length) return;
  await getAuth(getApp()).signOut();
}
