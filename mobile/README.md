# Smart AHU Mobile

Capacitor-based Android and iOS client. This is a bundled React app; it does not load the production website in a remote WebView.

## Current mobile scope

- Firebase-authenticated sign-in (email or username) with persisted Firebase client session.
- Live fleet overview, device status, active alarms, and alarm acknowledgement.
- Every protected API request carries a short-lived Firebase ID-token bearer credential. The server verifies it with Firebase Admin and loads authorization roles from RTDB; the app never supplies its own role claims.
- The first native release intentionally omits START/STOP and configuration controls. Those workflows need a separate safety review before being exposed on a second client.

## Setup

1. Copy `.env.example` to `.env.local` in this directory.
2. Set `VITE_API_BASE_URL` to the deployed Next.js API origin, for example `https://monitoring.example.com` (no trailing slash).
3. Set the four `VITE_FIREBASE_AUTH_*` public web-app values from the AUTH/identity Firebase project (`daikinsmart-efeb7`, the project holding user sign-in). The APP-DATA (`smart-monitoring-ahu`) and OWNER/device Firebase projects are server-side only: their `FIREBASE_DATABASE_URL` / `FIREBASE_SERVICE_ACCOUNT_*` and `OWNER_DEVICES_*` settings stay on the Next.js API and are never bundled into the mobile app. This client deliberately does not connect directly to either RTDB.
4. On the API deployment, include the Capacitor origins in CORS. Defaults are `capacitor://localhost` (iOS) and `https://localhost` (Android). Add only trusted exact origins to `MOBILE_APP_ORIGINS`; do not use `*`.
5. Install/build the web client and sync native projects:

   ```sh
   cd mobile
   npm install
   npm run build
   npx cap add android   # once
   npx cap add ios       # once
   npx cap sync
   ```

   For browser development, start the main Next.js server on port 3000, then run `npm run dev` here. Vite proxies `/api` to that server.

## Native builds

- Android: open `mobile/android` in Android Studio, or run `npx cap open android`; build a debug APK for device testing and a signed release bundle for Play distribution.
- iOS: on a Mac with Xcode, run `npx cap open ios`, select a simulator/device, and configure the app signing team and bundle identifier before archiving.

`com.smartahu.monitoring` is a provisional bundle identifier and should be changed to the organization’s final reverse-domain identifier before distribution. The Arena build workspace does not include Android Studio/SDK or macOS/Xcode, so it can validate the web/API code but cannot produce signed store artifacts itself.
