import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_AUTH_API_KEY?.trim(),
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim(),
  projectId: import.meta.env.VITE_FIREBASE_AUTH_PROJECT_ID?.trim(),
  appId: import.meta.env.VITE_FIREBASE_AUTH_APP_ID?.trim(),
};

export const firebaseConfigured = Object.values(firebaseConfig).every(Boolean);
export const auth: Auth | null = firebaseConfigured
  ? getAuth(getApps().length ? getApp() : initializeApp(firebaseConfig))
  : null;
