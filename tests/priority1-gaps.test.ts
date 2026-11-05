import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  accessDevices,
  ahuCommands,
  ahus,
  alarmBreachTimers,
  alarms,
  auditLogs,
  devices,
  sensorThresholds,
  users,
} from "../src/db/schema";
import {
  acceptPendingCommands,
  createCommand,
  expireStaleCommands,
  ingestTelemetry,
  readAuthoritativeSource,
  reconcileAhuSourceTransition,
  refreshAhuStatus,
} from "../src/lib/engine";
import {
  canonicalizeClientIp,
  deriveLoginIpRateKey,
  releaseLoginAttempt,
  reserveLoginAttempt,
} from "../src/lib/login-rate-limiter";
import {
  removeManagedUser,
  revokeAllUserSessions,
  updateManagedUser,
} from "../src/lib/user-management";
import { resetSimulatorUnit, setOverride, simulationTick } from "../src/lib/workers";

const MIGRATION_FILES = [
  "0000_cuddly_sabretooth.sql",
  "0001_numerous_lucky_pierre.sql",
  "0002_nebulous_exiles.sql",
  "0003_add_users_username.sql",
];

async function createMigratedTestDb() {
  const pg = new PGlite();
  for (const file of MIGRATION_FILES) {
    const sqlText = readFileSync(path.join(process.cwd(), "drizzle", file), "utf8");
    await pg.exec(sqlText.replaceAll("--> statement-breakpoint", ""));
  }
  const testDb = pgliteDrizzle(pg) as unknown as NodePgDatabase;
  return { pg, testDb };
}

function withInjectedGlobalDb<T>(testDb: NodePgDatabase, fn: () => Promise<T>): Promise<T> {
  const g = globalThis as typeof globalThis & { __ahuDrizzleDb?: NodePgDatabase };
  const prev = g.__ahuDrizzleDb;
  g.__ahuDrizzleDb = testDb;
  return fn().finally(() => {
    if (prev === undefined) delete g.__ahuDrizzleDb;
    else g.__ahuDrizzleDb = prev;
  });
}

test("FR-26 / FR-27 / FR-29: controller FAULT aborts active non-STOP command to FAILED while allowing STOP to SUCCEED", async () => {
  const { pg, testDb } = await createMigratedTestDb();
  try {
    await withInjectedGlobalDb(testDb, async () => {
      const now = new Date();
      await testDb.insert(users).values({
        id: "op-1",
        email: "token-op-1@token.local",
        fullName: "Shift Operator",
        role: "Operator",
      });
      await testDb.insert(ahus).values({
        id: "AHU-01",
        name: "Cleanroom AHU 01",
        location: "Zone A",
        installedSensors: ["roomTemp", "supplyTemp", "fanSpeed", "humidity"],
        commTimeoutSec: 30,
        currentStatus: "STOP",
        controlMode: "AUTO",
        setpoint: 22,
        desiredRunState: "STOP",
        lastSeenAt: now,
      });
      await testDb.insert(devices).values({
        id: "dev-sim-1",
        ahuId: "AHU-01",
        label: "AHU-01 Sim",
        token: "sim_ahu01_test_token",
        sourceType: "SIMULATION",
        enabled: true,
      });

      // Seed fresh STOP reading so AHU-01 is online (STOP)
      const seedRes = await ingestTelemetry("sim_ahu01_test_token", {
        ahuId: "AHU-01",
        messageId: "msg-seed-stop",
        timestamp: now.toISOString(),
        parameters: { roomTemp: 23.1, supplyTemp: 15.2, fanSpeed: 0, humidity: 50 },
        runState: "STOP",
        faultCode: null,
        setpoint: 22,
        controlMode: "AUTO",
      });
      assert.equal(seedRes.ok, true);

      // Operator issues START -> REQUESTED -> ACCEPTED
      const startCmd = await createCommand({
        ahuId: "AHU-01",
        commandType: "START",
        userId: "op-1",
        userEmail: "token-op-1@token.local",
        ipAddress: "127.0.0.1",
      });
      assert.equal(startCmd.ok, true);
      if (!startCmd.ok) throw new Error("expected START command creation");
      await acceptPendingCommands("AHU-01");

      // Controller trips into FAULT before reaching RUN -> active START command must transition to FAILED
      const faultAt = new Date(now.getTime() + 2000);
      const faultRes = await ingestTelemetry("sim_ahu01_test_token", {
        ahuId: "AHU-01",
        messageId: "msg-fault-trip",
        timestamp: faultAt.toISOString(),
        parameters: { roomTemp: 23.4, supplyTemp: 18.0, fanSpeed: 0, humidity: 52 },
        runState: "STOP",
        faultCode: "E14_MOTOR_OVERLOAD",
        setpoint: 22,
        controlMode: "AUTO",
      });
      assert.equal(faultRes.ok, true);

      const [abortedStart] = await testDb
        .select()
        .from(ahuCommands)
        .where(eq(ahuCommands.id, startCmd.commandId));
      assert.equal(abortedStart.status, "FAILED");
      assert.match(abortedStart.rejectionReason ?? "", /E14_MOTOR_OVERLOAD/);

      const [ahuAfterFault] = await testDb.select().from(ahus).where(eq(ahus.id, "AHU-01"));
      assert.equal(ahuAfterFault.currentStatus, "FAULT");
      assert.equal(ahuAfterFault.desiredRunState, "STOP");

      // Because START transitioned to FAILED, the partial unique index slot is free so STOP is immediately allowed during FAULT (FR-27)
      const stopCmd = await createCommand({
        ahuId: "AHU-01",
        commandType: "STOP",
        userId: "op-1",
        userEmail: "token-op-1@token.local",
        ipAddress: "127.0.0.1",
      });
      assert.equal(stopCmd.ok, true);
      if (!stopCmd.ok) throw new Error("expected STOP command permitted in FAULT");
      await acceptPendingCommands("AHU-01");

      const confirmStopAt = new Date(now.getTime() + 4000);
      await ingestTelemetry("sim_ahu01_test_token", {
        ahuId: "AHU-01",
        messageId: "msg-fault-stop-confirm",
        timestamp: confirmStopAt.toISOString(),
        parameters: { roomTemp: 23.5, supplyTemp: 18.4, fanSpeed: 0, humidity: 52 },
        runState: "STOP",
        faultCode: "E14_MOTOR_OVERLOAD",
        setpoint: 22,
        controlMode: "AUTO",
      });

      const [confirmedStop] = await testDb
        .select()
        .from(ahuCommands)
        .where(eq(ahuCommands.id, stopCmd.commandId));
      assert.equal(confirmedStop.status, "SUCCEEDED");

      const audits = await testDb.select().from(auditLogs);
      assert.equal(
        audits.some((a) => a.action === "COMMAND_FAILED" && a.entity === `command:${startCmd.commandId}`),
        true,
      );
    });
  } finally {
    await pg.close();
  }
});

test("FR-26 / FR-28: simulator rejectCommands NACK fails active SETPOINT command, reverts setpoint, and keeps commLoss EXPIRED path intact", async () => {
  const { pg, testDb } = await createMigratedTestDb();
  try {
    await withInjectedGlobalDb(testDb, async () => {
      resetSimulatorUnit("AHU-01");
      const now = new Date();
      await testDb.insert(users).values({
        id: "eng-1",
        email: "eng@ahu.local",
        fullName: "Controls Engineer",
        role: "Engineering",
      });
      await testDb.insert(ahus).values({
        id: "AHU-01",
        name: "Cleanroom AHU 01",
        location: "Zone A",
        installedSensors: ["roomTemp", "supplyTemp", "fanSpeed", "humidity"],
        commTimeoutSec: 30,
        currentStatus: "RUN",
        controlMode: "AUTO",
        setpoint: 22,
        desiredRunState: "RUN",
        lastSeenAt: now,
      });
      await testDb.insert(devices).values({
        id: "dev-sim-nack",
        ahuId: "AHU-01",
        label: "AHU-01 Sim",
        token: "sim_ahu01_nack_token",
        sourceType: "SIMULATION",
        enabled: true,
      });

      await ingestTelemetry("sim_ahu01_nack_token", {
        ahuId: "AHU-01",
        messageId: "msg-nack-seed",
        timestamp: now.toISOString(),
        parameters: { roomTemp: 22.4, supplyTemp: 14.5, fanSpeed: 76, humidity: 50 },
        runState: "RUN",
        faultCode: null,
        setpoint: 22,
        controlMode: "AUTO",
      });

      setOverride("AHU-01", { rejectCommands: true });
      const spCmd = await createCommand({
        ahuId: "AHU-01",
        commandType: "SETPOINT",
        payload: { setpoint: 18.5 },
        userId: "eng-1",
        userEmail: "eng@ahu.local",
        ipAddress: "127.0.0.1",
      });
      assert.equal(spCmd.ok, true);
      if (!spCmd.ok) throw new Error("expected SETPOINT command creation");

      await simulationTick();

      const [failedCmd] = await testDb
        .select()
        .from(ahuCommands)
        .where(eq(ahuCommands.id, spCmd.commandId));
      assert.equal(failedCmd.status, "FAILED");
      assert.match(failedCmd.rejectionReason ?? "", /NACK/i);

      const [ahuRow] = await testDb.select().from(ahus).where(eq(ahus.id, "AHU-01"));
      assert.equal(ahuRow.setpoint, 22);

      // Verify EXPIRED path remains separate when commLoss prevents acknowledgement past TTL
      setOverride("AHU-01", { rejectCommands: false, commLoss: true });
      const modeCmd = await createCommand({
        ahuId: "AHU-01",
        commandType: "MODE_MANUAL",
        userId: "eng-1",
        userEmail: "eng@ahu.local",
        ipAddress: "127.0.0.1",
      });
      assert.equal(modeCmd.ok, true);
      if (!modeCmd.ok) throw new Error("expected MODE_MANUAL command creation");

      const expiredCount = await expireStaleCommands(new Date(Date.now() + 65_000));
      assert.equal(expiredCount, 1);
      const [expiredRow] = await testDb
        .select()
        .from(ahuCommands)
        .where(eq(ahuCommands.id, modeCmd.commandId));
      assert.equal(expiredRow.status, "EXPIRED");
      resetSimulatorUnit("AHU-01");
    });
  } finally {
    await pg.close();
  }
});

test("NFR-02: per-IP login rate limiter enforces 10/15min/IP, normalizes IPv4-mapped IPv6, isolates IPs, and prevents token-login counter reset", async () => {
  const { pg, testDb } = await createMigratedTestDb();
  try {
    assert.equal(canonicalizeClientIp("203.0.113.42:51920"), "203.0.113.42");
    assert.equal(canonicalizeClientIp("::ffff:203.0.113.42"), "203.0.113.42");
    assert.equal(canonicalizeClientIp("[2001:db8::abcd]:443"), "2001:db8::abcd");
    assert.equal(canonicalizeClientIp(null), "unknown");

    const attackerKeyV4 = await deriveLoginIpRateKey("203.0.113.42:50000");
    const attackerKeyMapped = await deriveLoginIpRateKey("::ffff:203.0.113.42");
    assert.equal(attackerKeyV4, attackerKeyMapped);

    const officeAdminKey = await deriveLoginIpRateKey("198.51.100.10");
    const t0 = new Date("2026-11-05T02:00:00.000Z");

    // 9 failed password attempts from attacker IP
    for (let i = 1; i <= 9; i++) {
      const r = await reserveLoginAttempt(attackerKeyV4, { client: testDb, now: t0 });
      assert.equal(r.allowed, true);
      assert.equal(r.count, i);
    }

    // Attacker logs in once with a valid low-privilege token: reserves #10 (allowed) then releases ONLY that 1 reservation
    const validTokenAttempt = await reserveLoginAttempt(attackerKeyV4, { client: testDb, now: t0 });
    assert.equal(validTokenAttempt.allowed, true);
    assert.equal(validTokenAttempt.count, 10);
    await releaseLoginAttempt(attackerKeyV4, { client: testDb });

    // Attacker resumes guessing Admin passwords: #10 is the final permitted attempt, #11 is blocked (429)
    const tenthFailed = await reserveLoginAttempt(attackerKeyV4, { client: testDb, now: t0 });
    assert.equal(tenthFailed.allowed, true);
    assert.equal(tenthFailed.count, 10);

    const eleventhBlocked = await reserveLoginAttempt(attackerKeyV4, {
      client: testDb,
      now: new Date(t0.getTime() + 30_000),
    });
    assert.equal(eleventhBlocked.allowed, false);
    assert.equal(eleventhBlocked.retryAfterSec, 870);

    // Legitimate Admin on another IP is completely unaffected (no cross-IP lockout DoS)
    const adminAttempt = await reserveLoginAttempt(officeAdminKey, { client: testDb, now: t0 });
    assert.equal(adminAttempt.allowed, true);
    assert.equal(adminAttempt.count, 1);

    // 25 consecutive valid logins on localhost never exhaust the bucket
    const localhostKey = await deriveLoginIpRateKey("127.0.0.1");
    for (let i = 0; i < 25; i++) {
      const res = await reserveLoginAttempt(localhostKey, { client: testDb, now: t0 });
      assert.equal(res.allowed, true);
      await releaseLoginAttempt(localhostKey, { client: testDb });
    }

    // After 15 minutes expire, attacker IP window rolls over cleanly
    const afterWindow = await reserveLoginAttempt(attackerKeyV4, {
      client: testDb,
      now: new Date(t0.getTime() + 15 * 60 * 1000 + 1000),
    });
    assert.equal(afterWindow.allowed, true);
    assert.equal(afterWindow.count, 1);
  } finally {
    await pg.close();
  }
});

test("FR-04 / FR-13 / FR-21: authoritative source transitions resolve stale alarms, clear breach timers, fail incompatible commands, and transition disabled units to OFFLINE", async () => {
  const { pg, testDb } = await createMigratedTestDb();
  try {
    await withInjectedGlobalDb(testDb, async () => {
      const now = new Date();
      await testDb.insert(users).values({
        id: "admin-1",
        email: "vizobintang@gmail.com",
        fullName: "Primary Admin",
        role: "Admin",
      });
      await testDb.insert(ahus).values({
        id: "AHU-02",
        name: "Sterile Corridor AHU 02",
        location: "Zone B",
        installedSensors: ["roomTemp", "humidity", "fanSpeed"],
        commTimeoutSec: 30,
        currentStatus: "FAULT",
        faultCode: "SIM-FAULT-FAN-OVERLOAD",
        controlMode: "AUTO",
        setpoint: 21,
        desiredRunState: "RUN",
        lastSeenAt: now,
      });
      await testDb.insert(sensorThresholds).values({
        id: "th-hum-2",
        ahuId: "AHU-02",
        parameter: "humidity",
        highLimit: 65,
        delaySec: 0,
        priority: "HIGH",
        enabled: true,
        trendEnabled: true,
      });
      await testDb.insert(devices).values({
        id: "dev-sim-2",
        ahuId: "AHU-02",
        label: "AHU-02 Sim",
        token: "sim_ahu02_tok",
        sourceType: "SIMULATION",
        enabled: true,
      });

      // Seed active simulation alarm, breach timer, and in-flight command
      await testDb.insert(alarmBreachTimers).values({
        id: "AHU-02:roomTemp",
        firstAt: now,
      });
      await testDb.insert(alarms).values({
        id: "alm-sim-hum",
        ahuId: "AHU-02",
        parameter: "humidity",
        breachDirection: "HIGH",
        priority: "HIGH",
        message: "Simulated humidity spike",
        observedValue: 84,
        thresholdValue: 65,
        isActive: true,
        triggeredAt: now,
      });
      await testDb.insert(ahuCommands).values({
        id: "cmd-sim-active",
        ahuId: "AHU-02",
        userId: "admin-1",
        userEmail: "vizobintang@gmail.com",
        commandType: "SETPOINT",
        payload: { setpoint: 20 },
        status: "ACCEPTED",
        createdAt: now,
        expiresAt: new Date(now.getTime() + 50_000),
        updatedAt: now,
      });

      // Transition 1: Provision & enable PHYSICAL device (SIMULATION -> PHYSICAL)
      const prev1 = await readAuthoritativeSource(testDb, "AHU-02");
      assert.equal(prev1, "SIMULATION");
      await testDb.insert(devices).values({
        id: "dev-phy-2",
        ahuId: "AHU-02",
        label: "AHU-02 Modbus Gateway",
        token: "phy_ahu02_tok",
        sourceType: "PHYSICAL",
        enabled: true,
      });
      const next1 = await readAuthoritativeSource(testDb, "AHU-02");
      assert.equal(next1, "PHYSICAL");

      const rec1 = await reconcileAhuSourceTransition(testDb, {
        ahuId: "AHU-02",
        prevSource: prev1,
        nextSource: next1,
        userId: "admin-1",
        userEmail: "vizobintang@gmail.com",
        now,
      });
      assert.equal(rec1.timersCleared, 1);
      assert.equal(rec1.alarmsResolved, 1);
      assert.equal(rec1.commandsFailed, 1);

      const remainingTimers = await testDb.select().from(alarmBreachTimers);
      assert.equal(remainingTimers.length, 0);

      const [resolvedAlarm] = await testDb.select().from(alarms).where(eq(alarms.id, "alm-sim-hum"));
      assert.equal(resolvedAlarm.isActive, false);
      assert.notEqual(resolvedAlarm.resolvedAt, null);

      const [failedCmd] = await testDb.select().from(ahuCommands).where(eq(ahuCommands.id, "cmd-sim-active"));
      assert.equal(failedCmd.status, "FAILED");
      assert.match(failedCmd.rejectionReason ?? "", /physical/i);

      const [clearedAhu] = await testDb.select().from(ahus).where(eq(ahus.id, "AHU-02"));
      assert.equal(clearedAhu.faultCode, null);

      // Transition 2: Disable all devices -> AHU-02 immediately refreshes to OFFLINE
      await testDb.update(devices).set({ enabled: false }).where(eq(devices.ahuId, "AHU-02"));
      const next2 = await readAuthoritativeSource(testDb, "AHU-02");
      assert.equal(next2, null);
      const statusInfo = await refreshAhuStatus("AHU-02", now);
      assert.equal(statusInfo?.status, "OFFLINE");
    });
  } finally {
    await pg.close();
  }
});

test("FR-20 / FR-29: user lifecycle management updates member roles, revokes sessions, enforces self/last-Admin lockout protection, and preserves audit logs on removal", async () => {
  const { pg, testDb } = await createMigratedTestDb();
  try {
    const now = new Date();
    const primaryAdmin = { id: "admin-primary", email: "vizobintang@gmail.com" };
    await testDb.insert(users).values([
      {
        id: primaryAdmin.id,
        email: primaryAdmin.email,
        fullName: "Primary Admin",
        role: "Admin",
      },
      {
        id: "member-op",
        email: "shift-op-member-op@token.local",
        fullName: "Shift Operator",
        role: "Operator",
      },
    ]);
    await testDb.insert(accessDevices).values({
      id: "ad-op-1",
      userId: "member-op",
      label: "Control Room Browser",
      invitationHash: "inv_hash_op_1",
      invitationExpiresAt: new Date(now.getTime() + 3600_000),
      deviceHash: "dev_hash_op_1",
      claimedAt: now,
      expiresAt: new Date(now.getTime() + 86_400_000),
    });

    // 1. Update role Operator -> Engineering and assign username
    const promoted = await updateManagedUser(
      {
        actor: primaryAdmin,
        targetUserId: "member-op",
        role: "Engineering",
        username: "Shift.Op",
        ipAddress: "127.0.0.1",
      },
      testDb,
    );
    assert.equal(promoted.ok, true);
    if (promoted.ok) {
      assert.equal(promoted.data.user.role, "Engineering");
      assert.equal(promoted.data.user.username, "shift.op");
    }

    // 2. Enforce case-insensitive username uniqueness across accounts
    await updateManagedUser(
      {
        actor: primaryAdmin,
        targetUserId: primaryAdmin.id,
        username: "vizobintang",
      },
      testDb,
    );
    const duplicateUsername = await updateManagedUser(
      {
        actor: primaryAdmin,
        targetUserId: "member-op",
        username: "VizoBintang",
      },
      testDb,
    );
    assert.equal(duplicateUsername.ok, false);
    if (!duplicateUsername.ok) assert.equal(duplicateUsername.status, 409);

    // 3. Reject self-demotion & self-removal of active Admin
    const selfDemote = await updateManagedUser(
      {
        actor: primaryAdmin,
        targetUserId: primaryAdmin.id,
        role: "Viewer",
      },
      testDb,
    );
    assert.equal(selfDemote.ok, false);
    if (!selfDemote.ok) assert.equal(selfDemote.status, 409);

    const selfRemove = await removeManagedUser(
      {
        actor: primaryAdmin,
        targetUserId: primaryAdmin.id,
      },
      testDb,
    );
    assert.equal(selfRemove.ok, false);
    if (!selfRemove.ok) assert.equal(selfRemove.status, 409);

    // 4. Revoke all active sessions for member-op without deleting account
    const revoked = await revokeAllUserSessions(
      {
        actor: primaryAdmin,
        targetUserId: "member-op",
        now,
      },
      testDb,
    );
    assert.equal(revoked.ok, true);
    if (revoked.ok) assert.equal(revoked.data.revokedCount, 1);

    // 5. Remove member-op -> cascades access_devices while keeping audit_logs intact
    const removedMember = await removeManagedUser(
      {
        actor: primaryAdmin,
        targetUserId: "member-op",
      },
      testDb,
    );
    assert.equal(removedMember.ok, true);
    const remainingDevices = await testDb
      .select()
      .from(accessDevices)
      .where(eq(accessDevices.userId, "member-op"));
    assert.equal(remainingDevices.length, 0);

    // 6. Secondary Admin can be removed when >1 Admin exists, invoking Supabase Auth cleanup
    await testDb.insert(users).values({
      id: "admin-secondary",
      email: "backup-admin@ahu.local",
      fullName: "Backup Admin",
      role: "Admin",
    });
    let deletedAuthId: string | null = null;
    const removedSecondary = await removeManagedUser(
      {
        actor: primaryAdmin,
        targetUserId: "admin-secondary",
        deleteSupabaseAuthUser: async (uid) => {
          deletedAuthId = uid;
        },
      },
      testDb,
    );
    assert.equal(removedSecondary.ok, true);
    assert.equal(deletedAuthId, "admin-secondary");

    // 7. Verify full audit trail exists for every user lifecycle event
    const logs = await testDb.select().from(auditLogs);
    const actions = new Set(logs.map((l) => l.action));
    assert.equal(actions.has("USER_ROLE_CHANGED"), true);
    assert.equal(actions.has("USER_SESSIONS_REVOKED"), true);
    assert.equal(actions.has("USER_REMOVED"), true);
  } finally {
    await pg.close();
  }
});
