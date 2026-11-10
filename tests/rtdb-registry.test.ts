import { test } from "node:test";
import { deepStrictEqual, equal, rejects } from "node:assert/strict";

import { InMemoryRtdb } from "../src/lib/rtdb/store";
import { alarmToRow } from "../src/lib/rtdb/alarms";
import { commandToRow } from "../src/lib/rtdb/commands";
import {
  readRtdbAhu,
  readRtdbAhus,
  readRtdbDevices,
  readRtdbEnabledSourceTypes,
  readRtdbThresholds,
  ahuToRow,
  deviceToRow,
  patchRtdbAhu,
  removeRtdbThreshold,
  setRtdbThreshold,
  thresholdToRow,
  writeRtdbAhu,
  type RtdbAhuRecord,
  type RtdbDeviceRecord,
  type RtdbThresholdRecord,
} from "../src/lib/rtdb/registry";
import { writeDeviceSnapshot } from "../src/lib/rtdb/telemetry";
import {
  ackRtdbTrendAlert,
  readRtdbTrendCounts,
  readRtdbTrendHistory,
  readRtdbUnackedTrends,
  trendToRow,
  writeRtdbTrendAlert,
  type RtdbTrendRecord,
} from "../src/lib/rtdb/trends";
import { releaseRtdbLoginAttempt, reserveRtdbLoginAttempt } from "../src/lib/rtdb/security";
import { readRtdbFloorplan, removeRtdbFloorplan, writeRtdbFloorplan } from "../src/lib/rtdb/facility";
import {
  readRtdbBreachTimer,
  removeRtdbBreachTimersForAhu,
  removeRtdbBreachTimer,
  writeRtdbBreachTimer,
} from "../src/lib/rtdb/alarms";

const T0 = 1_794_182_400_000; // 2026-11-09T00:00:00Z

function ahu(id: string, overrides: Partial<RtdbAhuRecord> = {}): RtdbAhuRecord {
  return {
    id,
    name: `Unit ${id}`,
    location: "Rooftop",
    commTimeoutSec: 30,
    hasHeater: false,
    installedSensors: ["roomTemp", "supplyTemp"],
    currentStatus: "OFFLINE",
    lastSeenAt: null,
    controlMode: "AUTO",
    desiredRunState: "STOP",
    setpoint: 22,
    faultCode: null,
    physicalControlEnabled: false,
    mapX: null,
    mapZ: null,
    mapRotation: 0,
    mapZone: null,
    updatedAt: T0,
    ...overrides,
  };
}

function threshold(ahuId: string, parameter: string, overrides: Partial<RtdbThresholdRecord> = {}): RtdbThresholdRecord {
  return {
    id: `${ahuId}:${parameter}`,
    ahuId,
    parameter,
    enabled: true,
    lowLimit: 16,
    highLimit: 30,
    delaySec: 0,
    priority: "MEDIUM",
    validMin: null,
    validMax: null,
    unit: "°C",
    label: parameter,
    trendEnabled: false,
    updatedAt: T0,
    ...overrides,
  };
}

/* ── registry ─────────────────────────────────────────────────────── */

test("registry writes never contain undefined (RTDB rejects them — provision bug regression)", async () => {
  const db = new InMemoryRtdb();
  const { defaultAhuRecord } = await import("../src/lib/rtdb/registry");
  // this exact shape crashed the real provision script (id: undefined)
  await writeRtdbAhu(db, defaultAhuRecord("GTM-DAIKIN-001"));
  const stored = await db.get<Record<string, unknown>>("devices/GTM-DAIKIN-001/app");
  equal("id" in (stored ?? {}), false, "id is the path key, not a stored field");
  equal(stored?.physicalControlEnabled, false);

  // the adapter itself mirrors the real SDK's undefined rejection
  await rejects(() => db.set("devices/X/app", { a: 1, b: undefined }), /contains undefined/);
  await rejects(() => db.update("devices/X/app", { a: undefined }), /contains undefined/);
  // nested undefined is caught too
  await rejects(() => db.set("devices/X/app", { nested: { deep: undefined } }), /contains undefined/);
  // nulls remain legal (stripped by the real backend)
  await db.set("devices/X/app", { lastSeenAt: null, name: "ok" });
});

test("ahu registry: write, patch and read round-trip; ahuToRow maps Dates", async () => {
  const db = new InMemoryRtdb();
  await writeRtdbAhu(db, ahu("AHU-01"));
  await patchRtdbAhu(db, "AHU-01", { currentStatus: "RUN", lastSeenAt: T0 + 5_000, setpoint: 24 });

  const rec = await readRtdbAhu(db, "AHU-01");
  equal(rec?.currentStatus, "RUN");
  equal(rec?.setpoint, 24);
  equal(rec?.controlMode, "AUTO", "unpatched fields survive the merge");
  equal(rec?.lastSeenAt, T0 + 5_000);

  const all = await readRtdbAhus(db);
  equal(all.size, 1);

  const row = ahuToRow(rec!) as { lastSeenAt: Date; updatedAt?: unknown };
  equal(row.lastSeenAt instanceof Date, true);
  equal(row.lastSeenAt.getTime(), T0 + 5_000);
  equal("updatedAt" in row, false, "updatedAt is RTDB bookkeeping, not a PG column");
});

test("fleet: mirror-discovered devices synthesize defaults; app meta merges; sources gate", async () => {
  const db = new InMemoryRtdb();
  // a device discovered on the mirror tree, before any registration
  await writeDeviceSnapshot(db, "AHU-01", { power: true, fan: 2, room_temp: 25, timestamp: T0 });
  const discovered = await readRtdbAhu(db, "AHU-01");
  equal(discovered?.name, "AHU-01", "defaults synthesized from the mirror node");
  equal(discovered?.physicalControlEnabled, false);

  // registration writes app meta; reads merge meta over defaults
  await writeRtdbAhu(db, ahu("AHU-01", { physicalControlEnabled: true, enabled: true }));
  await writeDeviceSnapshot(db, "AHU-01", { power: false, room_temp: 26, timestamp: T0 + 1_000 });
  const rec = await readRtdbAhu(db, "AHU-01");
  equal(rec?.name, "Unit AHU-01", "app meta wins over defaults");
  equal(rec?.physicalControlEnabled, true);
  equal(rec?.lastSeenAt, null, "registry fields live in app meta only");

  deepStrictEqual(await readRtdbEnabledSourceTypes(db, "AHU-01"), ["PHYSICAL", "SIMULATION"]);
  await patchRtdbAhu(db, "AHU-01", { enabled: false });
  deepStrictEqual(await readRtdbEnabledSourceTypes(db, "AHU-01"), [], "paused units expose no sources");

  const rows = await readRtdbDevices(db);
  equal(rows.length, 1);
  equal(rows[0]?.sourceType, "PHYSICAL");
  const row = deviceToRow(rows[0]!) as { createdAt: Date; token: string };
  equal(row.createdAt instanceof Date, true);
  equal(row.token.includes("pre-shared"), true, "tokens are never exposed");
});

test("thresholds: set/remove, per-AHU and fleet reads, row mapper", async () => {
  const db = new InMemoryRtdb();
  await setRtdbThreshold(db, threshold("AHU-01", "supplyTemp"));
  await setRtdbThreshold(db, threshold("AHU-01", "roomTemp", { highLimit: 28 }));
  await setRtdbThreshold(db, threshold("AHU-02", "humidity", { unit: "%", lowLimit: null }));

  equal((await readRtdbThresholds(db, "AHU-01")).length, 2);
  equal((await readRtdbThresholds(db)).length, 3);

  await removeRtdbThreshold(db, "AHU-01", "roomTemp");
  deepStrictEqual((await readRtdbThresholds(db, "AHU-01")).map((t) => t.parameter), ["supplyTemp"]);

  const row = thresholdToRow(threshold("AHU-02", "humidity", { unit: "%", lowLimit: null })) as { lowLimit: number | null; unit: string };
  equal(row.lowLimit, null);
  equal(row.unit, "%");
});

/* ── trend alerts ─────────────────────────────────────────────────── */

function trend(id: string, ahuId: string, createdAt: number, overrides: Partial<RtdbTrendRecord> = {}): RtdbTrendRecord {
  return {
    id,
    ahuId,
    parameter: "filterDiffPressure",
    estimatedMin: 45,
    direction: "HIGH",
    isReliable: true,
    unreliabilityReason: null,
    sampleCount: 12,
    variance: 0.4,
    slopePerMin: 0.02,
    currentValue: 0.6,
    projectedValue: 0.9,
    thresholdValue: 0.8,
    minutesToBreach: 15,
    acknowledged: false,
    acknowledgedBy: null,
    acknowledgedAt: null,
    createdAt,
    ...overrides,
  };
}

test("trend alerts: counts, unacked feed, per-AHU history, ack + row mapper", async () => {
  const db = new InMemoryRtdb();
  await writeRtdbTrendAlert(db, trend("t1", "AHU-01", T0));
  await writeRtdbTrendAlert(db, trend("t2", "AHU-01", T0 + 1));
  await writeRtdbTrendAlert(db, trend("t3", "AHU-02", T0 + 2));
  await writeRtdbTrendAlert(db, trend("t4", "AHU-01", T0 + 3, { acknowledged: true, acknowledgedBy: "a", acknowledgedAt: T0 + 4 }));

  deepStrictEqual(
    Object.fromEntries(await readRtdbTrendCounts(db, ["AHU-01", "AHU-02", "AHU-03"])),
    { "AHU-01": 2, "AHU-02": 1, "AHU-03": 0 },
  );
  deepStrictEqual((await readRtdbUnackedTrends(db)).map((t) => t.id), ["t3", "t2", "t1"]);
  deepStrictEqual((await readRtdbTrendHistory(db, "AHU-01")).map((t) => t.id), ["t4", "t2", "t1"]);

  await ackRtdbTrendAlert(db, "t1", "eng@example.invalid", T0 + 9);
  const acked = (await readRtdbUnackedTrends(db)).map((t) => t.id);
  deepStrictEqual(acked, ["t3", "t2"]);

  const row = trendToRow(trend("t5", "AHU-01", T0, { acknowledgedAt: T0 + 6 })) as { createdAt: Date; acknowledgedAt: Date };
  equal(row.createdAt instanceof Date, true);
  equal(row.acknowledgedAt.getTime(), T0 + 6);
});

/* ── login rate limiting ──────────────────────────────────────────── */

test("login limiter: reserve counts, window reset, limit enforced, release deletes", async () => {
  const db = new InMemoryRtdb();
  const key = "a".repeat(64);
  const windowMs = 15 * 60_000;

  const r1 = await reserveRtdbLoginAttempt(db, key, { now: T0, max: 3, windowMs });
  deepStrictEqual([r1.allowed, r1.count, r1.remaining], [true, 1, 2]);
  await reserveRtdbLoginAttempt(db, key, { now: T0 + 1_000, max: 3, windowMs });
  const r3 = await reserveRtdbLoginAttempt(db, key, { now: T0 + 2_000, max: 3, windowMs });
  deepStrictEqual([r3.allowed, r3.count], [true, 3], "3rd attempt exactly at max is still allowed");
  const r4 = await reserveRtdbLoginAttempt(db, key, { now: T0 + 3_000, max: 3, windowMs });
  deepStrictEqual([r4.allowed, r4.count, r4.remaining], [false, 4, 0], "4th attempt over max=3 is blocked");
  equal(r4.retryAfterSec > 0, true);

  const fresh = await reserveRtdbLoginAttempt(db, key, { now: T0 + windowMs + 1, max: 3, windowMs });
  equal(fresh.count, 1, "expired window restarts the counter");

  // fresh window holds count 1 (from `fresh`) → one release deletes the bucket
  await releaseRtdbLoginAttempt(db, key);
  equal(await db.get<{ count: number }>(`loginAttempts/${key}`), null, "release to zero deletes the bucket");
  await releaseRtdbLoginAttempt(db, key); // releasing nothing aborts silently

  await reserveRtdbLoginAttempt(db, key, { now: T0 + windowMs + 2, max: 3, windowMs });
  const r2again = await reserveRtdbLoginAttempt(db, key, { now: T0 + windowMs + 3, max: 3, windowMs });
  equal(r2again.count, 2, "counter increments across reserve calls");
  await releaseRtdbLoginAttempt(db, key);
  const decremented = await db.get<{ count: number }>(`loginAttempts/${key}`);
  equal(decremented?.count, 1, "release decrements without deleting a non-empty bucket");
});

/* ── facility floorplan ───────────────────────────────────────────── */

test("floorplan: write/read round-trip and reset", async () => {
  const db = new InMemoryRtdb();
  equal(await readRtdbFloorplan(db), null);
  await writeRtdbFloorplan(db, [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 6 }], "admin@example.invalid", T0);
  const rec = await readRtdbFloorplan(db);
  equal(rec?.id, 1);
  equal(rec?.vertices.length, 3);
  equal(rec?.updatedBy, "admin@example.invalid");
  await removeRtdbFloorplan(db);
  equal(await readRtdbFloorplan(db), null);
});

/* ── breach timers ────────────────────────────────────────────────── */

test("breach timers: per-key read/write/remove and AHU-wide clear", async () => {
  const db = new InMemoryRtdb();
  equal(await readRtdbBreachTimer(db, "AHU-01", "supplyTemp", "HIGH"), null);
  await writeRtdbBreachTimer(db, "AHU-01", "supplyTemp", "HIGH", T0);
  await writeRtdbBreachTimer(db, "AHU-01", "roomTemp", "LOW", T0 + 1);
  await writeRtdbBreachTimer(db, "AHU-02", "supplyTemp", "HIGH", T0 + 2);

  equal(await readRtdbBreachTimer(db, "AHU-01", "supplyTemp", "HIGH"), T0);
  await removeRtdbBreachTimer(db, "AHU-01", "supplyTemp", "HIGH");
  equal(await readRtdbBreachTimer(db, "AHU-01", "supplyTemp", "HIGH"), null);
  equal(await readRtdbBreachTimer(db, "AHU-01", "roomTemp", "LOW"), T0 + 1);

  await removeRtdbBreachTimersForAhu(db, "AHU-01");
  equal(await readRtdbBreachTimer(db, "AHU-01", "roomTemp", "LOW"), null);
  equal(await readRtdbBreachTimer(db, "AHU-02", "supplyTemp", "HIGH"), T0 + 2, "other AHUs untouched");
});

test("InMemoryRtdb.transaction abort semantics match the adapter contract", async () => {
  const db = new InMemoryRtdb();
  const ok = await db.transaction<{ n: number }>("x/y", (cur) => ({ n: (cur?.n ?? 0) + 1 }));
  equal(ok.committed, true);
  equal(ok.value?.n, 1);
  const aborted = await db.transaction<{ n: number }>("x/y", () => undefined);
  equal(aborted.committed, false, "undefined aborts");
  equal(aborted.value?.n, 1, "value unchanged after abort");
});

/* ── RTDB null-stripping regression (the dashboard toFixed crash) ──── */

test("row mappers normalize RTDB-stripped nulls back to null (sparse records)", async () => {
  // RTDB removes null object fields on write, so real records read back
  // WITHOUT the nullable keys. These fixtures mimic exactly that shape.
  const sparseAlarm = alarmToRow({
    id: "a9",
    ahuId: "AHU-01",
    parameter: "FAULT",
    priority: "CRITICAL",
    message: "Controller fault reported: E3",
    isActive: true,
    acknowledged: false,
    triggeredAt: T0,
  } as unknown as Parameters<typeof alarmToRow>[0]) as Record<string, unknown>;
  equal(sparseAlarm.observedValue, null, "undefined observedValue must map to null — UI guards on !== null");
  equal(sparseAlarm.thresholdValue, null);
  equal(sparseAlarm.acknowledgedBy, null);
  equal(sparseAlarm.acknowledgedAt, null);
  equal(sparseAlarm.resolvedAt, null);
  equal(sparseAlarm.breachDirection, null);

  const sparseTrend = trendToRow({
    id: "t9",
    ahuId: "AHU-01",
    parameter: "roomTemp",
    estimatedMin: 45,
    direction: "HIGH",
    isReliable: false,
    sampleCount: 0,
    acknowledged: false,
    createdAt: T0,
  } as unknown as Parameters<typeof trendToRow>[0]) as Record<string, unknown>;
  equal(sparseTrend.variance, null);
  equal(sparseTrend.slopePerMin, null);
  equal(sparseTrend.minutesToBreach, null);
  equal(sparseTrend.unreliabilityReason, null);

  const sparseCmd = commandToRow({
    id: "c9",
    ahuId: "AHU-01",
    commandType: "START",
    status: "REQUESTED",
    createdAt: T0,
    updatedAt: T0,
    expiresAt: T0 + 60_000,
  } as unknown as Parameters<typeof commandToRow>[0]) as Record<string, unknown>;
  equal(sparseCmd.rejectionReason, null);
  equal(sparseCmd.confirmedAt, null);
  equal(sparseCmd.payload, null);
  equal(sparseCmd.userEmail, null);

  const sparseThreshold = thresholdToRow({
    id: "AHU-01:current",
    ahuId: "AHU-01",
    parameter: "current",
    enabled: true,
    delaySec: 0,
    priority: "HIGH",
    trendEnabled: true,
    updatedAt: T0,
  } as unknown as Parameters<typeof thresholdToRow>[0]) as Record<string, unknown>;
  equal(sparseThreshold.lowLimit, null);
  equal(sparseThreshold.highLimit, null);
  equal(sparseThreshold.unit, null);

  const sparseAhu = ahuToRow({
    id: "AHU-01",
    name: "u",
    location: "r",
    commTimeoutSec: 30,
    hasHeater: false,
    currentStatus: "STOP",
    controlMode: "AUTO",
    desiredRunState: "STOP",
    setpoint: 22,
    physicalControlEnabled: false,
    mapRotation: 0,
    updatedAt: T0,
  } as unknown as Parameters<typeof ahuToRow>[0]) as Record<string, unknown>;
  equal(sparseAhu.lastSeenAt, null);
  equal(sparseAhu.faultCode, null);
  equal(sparseAhu.mapX, null);
  equal(sparseAhu.mapZ, null);
  equal(sparseAhu.mapZone, null);
  deepStrictEqual(sparseAhu.installedSensors, [], "stripped array defaults to empty");
});
