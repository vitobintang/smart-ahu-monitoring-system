/**
 * bootstrap-admin-user.ts — create the FIRST Admin account when identity lives
 * on YOUR OWN Firebase project (FIREBASE_AUTH_* or single-project mode).
 * If identity lives on the collaborator project (the recommended two-project
 * layout), use seed-adoption-profiles.ts instead — no Auth is created here.
 *
 * Env (or CLI flags): BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD
 *   node --env-file=.env --import tsx scripts/bootstrap-admin-user.ts
 *
 * Creates: Firebase Auth user (Email/Password) + RTDB users/{uid} profile
 * with role Admin + usernames/emails mirrors + an audit entry.
 */
import { readFileSync } from "node:fs";

function die(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const email = (process.argv.find((a, i) => process.argv[i - 1] === "--email") ?? process.env.BOOTSTRAP_ADMIN_EMAIL ?? "").trim().toLowerCase();
const password = process.argv.find((a, i) => process.argv[i - 1] === "--password") ?? process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) die("Provide a valid email (--email … or BOOTSTRAP_ADMIN_EMAIL).");
if (password.length < 8) die("Password must be at least 8 characters (--password … or BOOTSTRAP_ADMIN_PASSWORD).");

const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!path) die("Set FIREBASE_SERVICE_ACCOUNT_PATH (the APP project's service account).");
const databaseUrl = (process.env.FIREBASE_DATABASE_URL ?? process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ?? "").trim();
if (!databaseUrl) die("Set FIREBASE_DATABASE_URL (or NEXT_PUBLIC_FIREBASE_DATABASE_URL).");

const { initializeApp, cert } = await import("firebase-admin/app");
const app = initializeApp(
  { credential: cert(JSON.parse(readFileSync(path, "utf8"))), databaseURL: databaseUrl.replace(/\/+$/, "") },
  `bootstrap-admin-${Date.now()}`,
);
const { getAuth } = await import("firebase-admin/auth");
const { getDatabase } = await import("firebase-admin/database");
const { createAdminRtdbAdapter } = await import("../src/lib/rtdb/store");
const { createRtdbUser, EmailTakenError, UsernameTakenError } = await import("../src/lib/rtdb/users");
const { writeRtdbAuditLog } = await import("../src/lib/rtdb/audit");
const { randomId } = await import("../src/lib/ids");

const rtdb = createAdminRtdbAdapter(getDatabase(app), "");

let uid: string;
try {
  const user = await getAuth(app).createUser({ email, password, emailVerified: true, displayName: email.split("@")[0] });
  uid = user.uid;
  console.log(`✓ Auth user created: ${email} (${uid})`);
} catch (err) {
  if ((err as { code?: string }).code === "auth/email-already-exists") {
    die(`An Auth user with ${email} already exists — sign in instead, or promote that user via seed-adoption-profiles.`);
  }
  throw err;
}

const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]+/g, ".").slice(0, 32).replace(/^\.+|\.+$/g, "") || "admin";
let username = base.length >= 3 ? base : base.padEnd(3, "0");
try {
  const record = await createRtdbUser(rtdb, { uid, email, username, fullName: null, role: "Admin" });
  console.log(`✓ Admin profile created: users/${uid} (username "${record.username}")`);
  await writeRtdbAuditLog(rtdb, {
    id: randomId(),
    userId: uid,
    userEmail: email,
    action: "USER_CREATED",
    entity: `user:${uid}`,
    ipAddress: null,
    details: { email, username: record.username, role: "Admin", authMethod: "bootstrap", provider: "password" },
    createdAt: Date.now(),
  });
  console.log("");
  console.log("Done — sign in at /login with this email + password.");
} catch (err) {
  await getAuth(app).deleteUser(uid).catch(() => undefined);
  if (err instanceof EmailTakenError) die(`Profile email conflict: ${email}. Check users/ + emails/ in RTDB.`);
  if (err instanceof UsernameTakenError) die(`Username "${username}" is taken — free it in RTDB and re-run.`);
  throw err;
}
