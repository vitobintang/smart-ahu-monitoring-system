import { test } from "node:test";
import { deepStrictEqual, equal, ok } from "node:assert/strict";

import { InMemoryRtdb, type RtdbAdapter } from "../src/lib/rtdb/store";
import {
  acceptPendingRtdb,
  confirmFromReadingRtdb,
  createCommandRtdb,
  expireStaleRtdb,
  failActiveCommandsRtdb,
  ingestTelemetryRtdb,
} from "../src/lib/rtdb/lifecycle";
import { COMMAND_TTL_SEC } from "../src/lib/domain";
import type { RtdbAhuRecord, RtdbDeviceRecord, RtdbThresholdRecord } from "../src/lib/rtdb/registry";

const T0 = 1_794_182_400_000; // 2026-11-09T00:00:00Z

function ahu(id: string, overrides: Partial<RtdbAhuRecord> = {}): RtdbAhuRecord {
  return {
    id,
    name: `Unit ${id}`,
    location: "Rooftop",
    commTimeoutSec: 30,
    hasHeater: false,
    installedSensors: ["roomTemp", "supplyTemp"],
    currentStatus: "STOP",
    lastSeenAt: T0 - 1_000,
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

function device(ahuId: string, overrides: Partial<RtdbDeviceRecord> = {}): RtdbDeviceRecord {
  return {
    id: `${ahuId.toLowerCase()}-sim`,
    ahuId,
    label: `${ahuId} Simulation Controller`,
    token: `tok-${ahuId}`,
    sourceType: "SIMULATION",
    enabled: true,
    createdAt: T0,
    ...overrides,
  };
}

function threshold(ahuId: string, parameter: string, overrides: Partial<RtdbThresholdRecord> = {}): RtdbThresholdRecord {
  return {
    id: `${ahuId}:${parameter}`,
    ahuId,
    parameter,
    enabled: true,
    lowLimit: null,
    highLimit: 22,
    delaySec: 0,
    priority: "HIGH",
    validMin: -20,
    validMax: 60,
    unit: "°C",
    label: parameter,
    trendEnabled: false,
    updatedAt: T0,
    ...overrides,
  };
}

/** Seeds the registry the ingest/command pipelines expect, plus a fresh latest reading. */
function seedBase(db: InMemoryRtdb, ahuId = "AHU-01", latestTs = T0 - 2_000) {
  db.seed({
    ahus: { [ahuId]: ahu(ahuId) },
    devices: { [ahuId]: { [`${ahuId.toLowerCase()}-sim`]: device(ahuId) } },
    thresholds: { [ahuId]: { supplyTemp: threshold(ahuId, "supplyTemp") } },
    telemetryLatest: {
      [ahuId]: {
        ahuId,
        messageId: "seed-0",
        source: "SIMULATION",
        timestamp: latestTs,
        receivedAt: latestTs,
        roomTemp: 24,
        supplyTemp: 20,
        returnTemp: 23,
        humidity: 55,
        filterDiffPressure: 120,
        fanSpeed: 0,
        coilTemp: 10,
        damperPosition: 0,
        current: null,
        isCurrentFallback: true,
        voltage: null,
        isVoltageFallback: true,
        runHours: 10,
        heaterOutput: 0,
        runState: "STOP",
        faultCode: null,
      },
    },
  });
}

const CMD_REQ = {
  ahuId: "AHU-01",
  commandType: "START",
  userId: "uid-1",
  userEmail: "op@example.invalid",
  ipAddress: null,
} as const;

/* ── createCommand ────────────────────────────────────────────────── */

test("createCommandRtdb: claims the slot, writes the record, patches desired state, audits", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  const outcome = await createCommandRtdb(db, CMD_REQ, T0);
  equal(outcome.ok, true);
  if (!outcome.ok) return;

  const slot = await db.get<{ commandId: string; status: string }>("commandActive/AHU-01");
  equal(slot?.commandId, outcome.commandId);
  equal(slot?.status, "REQUESTED");

  const record = await db.get<{ status: string; desired?: unknown }>(`commands/${outcome.commandId}`);
  equal(record?.status, "REQUESTED");
  const ahuRec = await db.get<{ desiredRunState: string }>("ahus/AHU-01");
  equal(ahuRec?.desiredRunState, "RUN", "START sets desiredRunState RUN");

  const audit = await db.get<Record<string, { action: string }>>("auditLogs");
  ok(Object.values(audit ?? {}).some((a) => a.action === "COMMAND_REQUESTED"));
});

test("createCommandRtdb: second command while the slot is held → 409 ACTIVE_COMMAND", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  const first = await createCommandRtdb(db, CMD_REQ, T0);
  equal(first.ok, true);
  const second = await createCommandRtdb(db, { ...CMD_REQ, commandType: "STOP" }, T0 + 1_000);
  equal(second.ok, false);
  if (!second.ok) {
    equal(second.status, 409);
    equal(second.code, "ACTIVE_COMMAND");
  }
});

test("createCommandRtdb: OFFLINE rejects everything; SETPOINT bounds enforced", async () => {
  const db = new InMemoryRtdb();
  seedBase(db, "AHU-01", T0 - 120_000); // latest is 2 min old > 30 s timeout → OFFLINE
  const offline = await createCommandRtdb(db, CMD_REQ, T0);
  equal(offline.ok, false);
  if (!offline.ok) equal(offline.code, "OFFLINE");

  const bad = await createCommandRtdb(db, { ...CMD_REQ, commandType: "SETPOINT", payload: { setpoint: 99 } }, T0);
  equal(bad.ok, false);
  if (!bad.ok) equal(bad.status, 400);
});

test("createCommandRtdb: an enabled PHYSICAL device locks control (403)", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  db.set("devices/AHU-01/gw-1", device("AHU-01", { id: "gw-1", token: "tok-gw", sourceType: "PHYSICAL" }));
  const outcome = await createCommandRtdb(db, CMD_REQ, T0);
  equal(outcome.ok, false);
  if (!outcome.ok) equal(outcome.code, "PHYSICAL_LOCKED");
});

/* ── accept / confirm / expire / fail ─────────────────────────────── */

test("acceptPendingRtdb flips REQUESTED → ACCEPTED; physical gate returns []", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  const created = await createCommandRtdb(db, CMD_REQ, T0);
  equal(created.ok, true);

  const accepted = await acceptPendingRtdb(db, "AHU-01", T0 + 500);
  deepStrictEqual(accepted.length, 1);
  const record = await db.get<{ status: string }>(`commands/${(created as { commandId: string }).commandId}`);
  equal(record?.status, "ACCEPTED");

  db.set("devices/AHU-01/gw-1", device("AHU-01", { id: "gw-1", token: "tok-gw", sourceType: "PHYSICAL" }));
  const blocked = await acceptPendingRtdb(db, "AHU-01", T0 + 600);
  deepStrictEqual(blocked, []);
});

test("confirmFromReadingRtdb succeeds an ACCEPTED START when the reading shows RUN", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  const created = (await createCommandRtdb(db, CMD_REQ, T0)) as { commandId: string };
  await acceptPendingRtdb(db, "AHU-01", T0 + 500);

  const noMatch = await confirmFromReadingRtdb(db, "AHU-01", { runState: "STOP", fanSpeed: 0 }, { setpoint: null, controlMode: null }, T0 + 2_000);
  deepStrictEqual(noMatch, []);

  const confirmed = await confirmFromReadingRtdb(db, "AHU-01", { runState: "RUN", fanSpeed: 60 }, { setpoint: null, controlMode: null }, T0 + 3_000);
  deepStrictEqual(confirmed, [created.commandId]);
  const record = await db.get<{ status: string; confirmedAt: number }>(`commands/${created.commandId}`);
  equal(record?.status, "SUCCEEDED");
  equal(record?.confirmedAt, T0 + 3_000);
  equal(await db.get("commandActive/AHU-01"), null, "slot cleared on success");
});

test("expireStaleRtdb expires TTL-elapsed commands and clears their slot", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  const created = (await createCommandRtdb(db, CMD_REQ, T0)) as { commandId: string };

  const beforeTtl = await expireStaleRtdb(db, T0 + (COMMAND_TTL_SEC - 5) * 1_000);
  equal(beforeTtl, 0);
  equal((await db.get<{ status: string }>(`commands/${created.commandId}`))?.status, "REQUESTED");

  const afterTtl = await expireStaleRtdb(db, T0 + (COMMAND_TTL_SEC + 5) * 1_000);
  equal(afterTtl, 1);
  const record = await db.get<{ status: string; rejectionReason: string }>(`commands/${created.commandId}`);
  equal(record?.status, "EXPIRED");
  ok(record?.rejectionReason.includes("TTL"));
  equal(await db.get("commandActive/AHU-01"), null);
});

test("failActiveCommandsRtdb fails the active command and reverts desired state", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  const created = (await createCommandRtdb(db, CMD_REQ, T0)) as { commandId: string }; // START → desiredRunState RUN
  const failed = await failActiveCommandsRtdb(db, "AHU-01", {
    reason: "critical alarm",
    revertDesiredState: true,
    now: T0 + 1_000,
  });
  deepStrictEqual(failed, [created.commandId]);
  const record = await db.get<{ status: string }>(`commands/${created.commandId}`);
  equal(record?.status, "FAILED");
  const ahuRec = await db.get<{ desiredRunState: string }>("ahus/AHU-01");
  equal(ahuRec?.desiredRunState, "STOP", "latest reading shows STOP → revert to STOP");
});

/* ── ingest ───────────────────────────────────────────────────────── */

test("ingestTelemetryRtdb: happy path appends, advances latest, patches the registry", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  const result = await ingestTelemetryRtdb(
    db,
    "tok-AHU-01",
    { messageId: "m-1", timestamp: new Date(T0).toISOString(), parameters: { roomTemp: 25.5, supplyTemp: 21 }, runState: "RUN", setpoint: 22 },
    T0,
  );
  equal(result.ok, true);

  const latest = await db.get<{ timestamp: number; runState: string; messageId: string }>("telemetryLatest/AHU-01");
  equal(latest?.timestamp, T0);
  equal(latest?.runState, "RUN");
  equal(latest?.messageId, "m-1");
  const shard = await db.get<unknown>("telemetry/AHU-01/2026-11-09/m-1");
  ok(shard, "history shard written");
  const ahuRec = await db.get<{ lastSeenAt: number; desiredRunState: string; controlMode: string }>("ahus/AHU-01");
  equal(ahuRec?.lastSeenAt, T0);
});

test("ingestTelemetryRtdb: duplicate messageId → 200 duplicated (FR-23)", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  const payload = { messageId: "m-1", timestamp: new Date(T0).toISOString(), parameters: { roomTemp: 25 } };
  equal((await ingestTelemetryRtdb(db, "tok-AHU-01", payload, T0)).ok, true);
  const dup = await ingestTelemetryRtdb(db, "tok-AHU-01", { ...payload, messageId: "m-1", timestamp: new Date(T0 + 1_000).toISOString() }, T0 + 1_000);
  equal(dup.ok, true);
  if (dup.ok) equal((dup.body as { duplicated?: boolean }).duplicated, true);
});

test("ingestTelemetryRtdb: threshold breach raises an alarm (delay 0) with active index", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  const result = await ingestTelemetryRtdb(
    db,
    "tok-AHU-01",
    { messageId: "m-2", timestamp: new Date(T0).toISOString(), parameters: { supplyTemp: 30 } },
    T0,
  );
  equal(result.ok, true);
  const active = await db.get<Record<string, boolean>>("alarmsActive");
  ok(active && Object.keys(active).length === 1, "alarm indexed as active");
  const alarmId = Object.keys(active ?? {})[0];
  const record = await db.get<{ parameter: string; breachDirection: string; isActive: boolean }>(`alarms/${alarmId}`);
  equal(record?.parameter, "supplyTemp");
  equal(record?.breachDirection, "HIGH");
  equal(record?.isActive, true);
});

test("ingestTelemetryRtdb: debounce delay holds the alarm until the window elapses", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  db.set("thresholds/AHU-01/supplyTemp", threshold("AHU-01", "supplyTemp", { delaySec: 4 }));

  await ingestTelemetryRtdb(db, "tok-AHU-01", { messageId: "m-3", timestamp: new Date(T0).toISOString(), parameters: { supplyTemp: 30 } }, T0);
  equal(await db.get("alarmsActive"), null, "first breach only arms the timer");

  // +5 s: inside the 30 s comm window (no timer reset) and past the 4 s delay.
  await ingestTelemetryRtdb(db, "tok-AHU-01", { messageId: "m-4", timestamp: new Date(T0 + 5_000).toISOString(), parameters: { supplyTemp: 31 } }, T0 + 5_000);
  const active = await db.get<Record<string, boolean>>("alarmsActive");
  ok(active && Object.keys(active).length === 1, "breach confirmed after the delay");
});

test("ingestTelemetryRtdb: a comm-timeout gap resets the debounce timer (mirrors SQL)", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  db.set("thresholds/AHU-01/supplyTemp", threshold("AHU-01", "supplyTemp", { delaySec: 4 }));

  await ingestTelemetryRtdb(db, "tok-AHU-01", { messageId: "m-3", timestamp: new Date(T0).toISOString(), parameters: { supplyTemp: 30 } }, T0);
  // +45 s gap exceeds the 30 s comm timeout → SQL semantics clear all timers.
  await ingestTelemetryRtdb(db, "tok-AHU-01", { messageId: "m-4", timestamp: new Date(T0 + 45_000).toISOString(), parameters: { supplyTemp: 31 } }, T0 + 45_000);
  equal(await db.get("alarmsActive"), null, "gap reset the debounce window");
});

test("ingestTelemetryRtdb: validation errors return 400 with details; historical samples never regress latest", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);

  const bad = await ingestTelemetryRtdb(db, "tok-AHU-01", { messageId: "m-5", timestamp: new Date(T0).toISOString(), parameters: { nonsense: 1 } }, T0);
  equal(bad.ok, false);
  if (!bad.ok) {
    equal(bad.status, 400);
    ok((bad.body as { details?: string[] }).details?.some((d) => d.includes("nonsense")));
  }

  const historical = await ingestTelemetryRtdb(
    db,
    "tok-AHU-01",
    { messageId: "m-6", timestamp: new Date(T0 - 90_000).toISOString(), parameters: { roomTemp: 20 } },
    T0 + 1_000,
  );
  equal(historical.ok, true);
  if (historical.ok) equal((historical.body as { historical?: boolean }).historical, true);
  const latest = await db.get<{ timestamp: number }>("telemetryLatest/AHU-01");
  equal(latest?.timestamp, T0 - 2_000, "latest pointer not regressed");
});

test("ingestTelemetryRtdb: SIM ingest is blocked while a PHYSICAL gateway is enabled", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  db.set("devices/AHU-01/gw-1", device("AHU-01", { id: "gw-1", token: "tok-gw", sourceType: "PHYSICAL" }));
  const result = await ingestTelemetryRtdb(db, "tok-AHU-01", { messageId: "m-7", timestamp: new Date(T0).toISOString(), parameters: {} }, T0);
  equal(result.ok, false);
  if (!result.ok) equal(result.status, 409);
});
