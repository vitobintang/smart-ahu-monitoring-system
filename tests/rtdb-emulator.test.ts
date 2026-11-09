import { test, before, after } from "node:test";
import { deepStrictEqual, equal, notEqual } from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";

/**
 * Phase 4: the critical RTDB scenarios executed against the REAL Firebase
 * Realtime Database emulator (server-side transaction ordering, conflict
 * handling, multi-client races) rather than the in-memory double.
 *
 * Requirements (developer machine): Java 11+ and `npm run emulator` running
 * in a second terminal. When the emulator is not reachable every test here
 * is SKIPped with a clear reason, so `npm test` stays green everywhere else.
 */

const EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? "127.0.0.1:9000";
const NAMESPACE = "smart-monitoring-ahu-default-rtdb";
const DATABASE_URL = `https://${NAMESPACE}.asia-southeast1.firebasedatabase.app`;

async function probeEmulator(): Promise<boolean> {
  try {
    // ANY HTTP response proves the emulator server is up. (It answers 401 for
    // unauthenticated REST because database.rules.json locks reads — the tests
    // themselves connect via the Admin SDK, which bypasses rules entirely.)
    const res = await fetch(`http://${EMULATOR_HOST}/.json?ns=${NAMESPACE}`, {
      signal: AbortSignal.timeout(2500),
    });
    return res.status > 0;
  } catch {
    return false;
  }
}

const emulatorAvailable = await probeEmulator();
const skipReason = `Firebase RTDB emulator not reachable on ${EMULATOR_HOST} — run \`npm run emulator\` (requires Java) in a second terminal`;
const t = (name: string, fn: () => Promise<void> | void) => test(name, { skip: emulatorAvailable ? false : skipReason }, fn);

let savedEnv: Record<string, string | undefined> = {};
let tempDir: string | null = null;
// lazy: the admin SDK module graph must only load after the env vars are set
type Admin = {
  db: import("../src/lib/rtdb/store").RtdbAdapter;
  raw: import("firebase-admin/database").Database;
};
let admin: Admin | null = null;

if (!emulatorAvailable) {
  // keeps the skip visible in the runner output when the emulator is not up
  test("RTDB emulator suite: skipped", { skip: skipReason }, () => {});
}

if (emulatorAvailable) {
  before(async () => {
    savedEnv = {
      FIREBASE_DATABASE_EMULATOR_HOST: process.env.FIREBASE_DATABASE_EMULATOR_HOST,
      FIREBASE_SERVICE_ACCOUNT_PATH: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
      FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
      NEXT_PUBLIC_FIREBASE_DATABASE_URL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    };

    // A throwaway RSA keypair is generated at runtime so no key material is
    // ever committed. The emulator ignores the credential entirely — it only
    // needs to be well-formed enough for cert() to accept.
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    tempDir = mkdtempSync(join(tmpdir(), "ahu-emulator-sa-"));
    const saPath = join(tempDir, "emulator-service-account.json");
    writeFileSync(
      saPath,
      JSON.stringify({
        type: "service_account",
        project_id: "smart-monitoring-ahu",
        private_key: pem,
        client_email: "emulator-test@smart-monitoring-ahu.iam.gserviceaccount.com",
        client_id: "000000000000000000000",
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
      }),
    );

    process.env.FIREBASE_DATABASE_EMULATOR_HOST = EMULATOR_HOST;
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH = saPath;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL = DATABASE_URL;
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "smart-monitoring-ahu";

    const { getAhuRtdb } = await import("../src/lib/firebase/admin");
    const { getFirebaseDb } = await import("../src/lib/firebase/admin");
    const raw = await getFirebaseDb();
    admin = { db: await getAhuRtdb(), raw };
  });

  after(async () => {
    // wipe the namespace and tear the app down so nothing leaks across files.
    // NOTE: the wipe MUST go through the Admin SDK — it bypasses security
    // rules (docs: "the app has access to read and write all data, regardless
    // of Security Rules"). A raw REST DELETE is subject to the locked rules
    // and silently 401s.
    try {
      await admin?.raw.ref().remove();
    } catch {
      /* best effort */
    }
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete (process.env as Record<string, unknown>)[key];
      else process.env[key] = value;
    }
  });

  // Clears the whole namespace through the Admin SDK, which bypasses security
  // rules. (A raw REST DELETE would be denied by the locked database.rules.json
  // and the wipe would silently do nothing — that bug made the prune test see
  // shards leaked from the telemetry test.)
  const wipe = async () => {
    await admin!.raw.ref().remove();
  };

  /* ---------------------------------------------------------------- */
  /* The same critical scenarios as the in-memory suites, real backend */
  /* ---------------------------------------------------------------- */

  t("emulator: transaction claim race — exactly ONE of 8 parallel claims wins", async () => {
    await wipe();
    const { claimActiveCommand, activeSlotFor, commandActiveNode } = await import("../src/lib/rtdb/commands");
    const now = Date.now();
    const slot = (i: number) =>
      activeSlotFor({
        id: `race-cmd-${i}`,
        ahuId: "AHU-01",
        userId: "uid-1",
        userEmail: null,
        commandType: "START",
        payload: null,
        status: "REQUESTED",
        rejectionReason: null,
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 60_000,
        confirmedAt: null,
      });

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => claimActiveCommand(admin!.db, "AHU-01", slot(i), now)),
    );
    const winners = results.filter((r) => r.committed);
    equal(winners.length, 1, "server-side transactions serialize: one winner");
    const holder = await admin!.db.get<{ commandId: string }>(commandActiveNode("AHU-01"));
    notEqual(holder, null);
    const winnerIndex = results.findIndex((r) => r.committed);
    equal(holder!.commandId, `race-cmd-${winnerIndex}`, "the stored slot belongs to the committed claim");
  });

  t("emulator: username claim uniqueness", async () => {
    await wipe();
    const { createRtdbUser, UsernameTakenError } = await import("../src/lib/rtdb/users");
    await createRtdbUser(admin!.db, {
      uid: "emu-uid-1",
      email: "emu-one@example.invalid",
      username: "emuuser",
      fullName: "Emu One",
      role: "Admin",
    });
    await import("../src/lib/rtdb/users").then((m) => m.UsernameTakenError); // type warm-up
    let conflict = false;
    try {
      await createRtdbUser(admin!.db, {
        uid: "emu-uid-2",
        email: "emu-two@example.invalid",
        username: "EMUUSER",
        fullName: "Emu Two",
        role: "Operator",
      });
    } catch (err) {
      conflict = err instanceof UsernameTakenError;
    }
    equal(conflict, true, "case-insensitive username uniqueness enforced by the real backend");
  });

  t("emulator: telemetry mirror, latest pointer, range read across day shards", async () => {
    await wipe();
    const { writeTelemetryMirror } = await import("../src/lib/rtdb/telemetry");
    const { readTelemetryRange } = await import("../src/lib/rtdb/history");
    const DAY = 86_400_000;
    const base = Date.UTC(2026, 10, 9, 0, 0, 0);
    const record = (messageId: string, timestamp: number) => ({
      ahuId: "AHU-01",
      messageId,
      source: "SIMULATION" as const,
      timestamp,
      receivedAt: timestamp,
      roomTemp: 24,
      supplyTemp: 14,
      returnTemp: 23,
      humidity: 60,
      filterDiffPressure: 120,
      fanSpeed: 2,
      coilTemp: 12,
      damperPosition: 70,
      current: 5,
      isCurrentFallback: false,
      voltage: 400,
      isVoltageFallback: false,
      runHours: 10,
      heaterOutput: 0,
      runState: "RUN",
      faultCode: null,
    });

    await writeTelemetryMirror(admin!.db, record("emu-m1", base + 1_000));
    await writeTelemetryMirror(admin!.db, record("emu-m2", base + DAY + 2_000));
    await writeTelemetryMirror(admin!.db, record("emu-m3", base - 500)); // late/historical

    const latest = await admin!.db.get<Record<string, unknown>>("telemetryLatest/AHU-01");
    equal(latest?.messageId, "emu-m2", "latest never regresses on historical writes");

    // Range covers Nov 9 00:00:00.000 → Nov 11 00:00:00.000 inclusive:
    // emu-m1 (Nov 9 +1s) and emu-m2 (Nov 10 +2s) are inside; emu-m3
    // (Nov 8 23:59:59.500) is before the start and must stay excluded.
    const range = await readTelemetryRange(admin!.db, "AHU-01", base, base + 2 * DAY);
    deepStrictEqual(
      range.map((r) => r.messageId),
      ["emu-m1", "emu-m2"],
      "cross-day range read from real shards",
    );
    equal(range.some((r) => r.messageId === "emu-m3"), false, "sample before the range start stays excluded");
  });

  t("emulator: alarm lifecycle keeps the active index honest", async () => {
    await wipe();
    const { writeRtdbAlarm, applyAlarmAck, applyAlarmResolve, readActiveAlarmRecords } = await import(
      "../src/lib/rtdb/alarms"
    );
    const now = Date.now();
    await writeRtdbAlarm(admin!.db, {
      id: "emu-alm-1",
      ahuId: "AHU-01",
      parameter: "supplyTemp",
      priority: "HIGH",
      message: "emulator breach",
      breachDirection: "HIGH",
      observedValue: 18.5,
      thresholdValue: 16,
      isActive: true,
      acknowledged: false,
      acknowledgedBy: null,
      acknowledgedAt: null,
      triggeredAt: now,
      resolvedAt: null,
    });
    equal((await readActiveAlarmRecords(admin!.db)).length, 1);
    await applyAlarmAck(admin!.db, "emu-alm-1", "emu-admin", now + 1_000);
    await applyAlarmResolve(admin!.db, "emu-alm-1", now + 2_000);
    equal((await readActiveAlarmRecords(admin!.db)).length, 0, "resolved alarm left the active index");
    const stored = await admin!.db.get<{ acknowledged: boolean; isActive: boolean; resolvedAt: number }>(
      "alarms/emu-alm-1",
    );
    equal(stored!.acknowledged, true);
    equal(stored!.isActive, false);
  });

  t("emulator: audit append + newest-first filter", async () => {
    await wipe();
    const { writeRtdbAuditLog } = await import("../src/lib/rtdb/audit");
    const { filterAuditEntries } = await import("../src/lib/rtdb/audit");
    const now = Date.now();
    await writeRtdbAuditLog(admin!.db, {
      id: "emu-aud-1",
      userId: "u1",
      userEmail: null,
      action: "COMMAND_REQUESTED",
      entity: "command:c1",
      details: { ahuId: "AHU-01" },
      ipAddress: null,
      createdAt: now,
    });
    await writeRtdbAuditLog(admin!.db, {
      id: "emu-aud-2",
      userId: "u1",
      userEmail: null,
      action: "ALARM_TRIGGERED",
      entity: "alarm:a1",
      details: {},
      ipAddress: null,
      createdAt: now + 5,
    });
    const tree =
      (await admin!.db.get<Record<string, import("../src/lib/rtdb/audit").RtdbAuditRecord>>("auditLogs")) ?? {};
    const filtered = filterAuditEntries(Object.values(tree), { action: "COMMAND" });
    deepStrictEqual(filtered.map((e) => e.id), ["emu-aud-1"]);
    deepStrictEqual(Object.values(tree).sort((a, b) => b.createdAt - a.createdAt).map((e) => e.id), [
      "emu-aud-2",
      "emu-aud-1",
    ]);
  });

  t("emulator: prune removes only expired day shards", async () => {
    await wipe();
    const { writeTelemetryMirror, pruneTelemetryShards } = await import("../src/lib/rtdb/telemetry");
    const base = Date.UTC(2026, 10, 7, 5, 0, 0);
    const record = (messageId: string, timestamp: number) => ({
      ahuId: "AHU-01",
      messageId,
      source: "SIMULATION" as const,
      timestamp,
      receivedAt: timestamp,
      roomTemp: null,
      supplyTemp: null,
      returnTemp: null,
      humidity: null,
      filterDiffPressure: null,
      fanSpeed: null,
      coilTemp: null,
      damperPosition: null,
      current: null,
      isCurrentFallback: false,
      voltage: null,
      isVoltageFallback: false,
      runHours: null,
      heaterOutput: null,
      runState: null,
      faultCode: null,
    });
    await writeTelemetryMirror(admin!.db, record("prune-old", base));
    await writeTelemetryMirror(admin!.db, record("prune-new", base + 3 * 86_400_000));
    const removed = await pruneTelemetryShards(admin!.db, ["AHU-01"], 1, base + 3 * 86_400_000 + 3600_000, "2026-11-07");
    equal(removed, 1);
    equal(await admin!.db.get("telemetry/AHU-01/2026-11-07"), null);
    notEqual(await admin!.db.get("telemetry/AHU-01/2026-11-10"), null);
  });
}
