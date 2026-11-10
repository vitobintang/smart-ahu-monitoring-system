import { test } from "node:test";
import { deepStrictEqual, equal, ok } from "node:assert/strict";

import { InMemoryRtdb, type RtdbAdapter } from "../src/lib/rtdb/store";
import {
  acceptPendingRtdb,
  confirmFromReadingRtdb,
  createCommandRtdb,
  expireStaleRtdb,
  failActiveCommandsRtdb,
  processDaikinSnapshotRtdb,
} from "../src/lib/rtdb/lifecycle";
import { COMMAND_TTL_SEC } from "../src/lib/domain";
import type { RtdbAhuRecord, RtdbThresholdRecord } from "../src/lib/rtdb/registry";

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
    physicalControlEnabled: true,
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

/** Seeds the mirrored fleet the processor/command pipelines expect. */
function seedBase(db: InMemoryRtdb, ahuId = "AHU-01", latestTs = T0 - 2_000) {
  const { id: _id, ...meta } = ahu(ahuId);
  void _id;
  db.seed({
    devices: {
      [ahuId]: {
        // verbatim owner-format live node (VERIFIED layout: fields under status/)
        status: {
          power: false,
          fan: 0,
          room_temp: 24,
          supply_temp: 20,
          return_temp: 23,
          humidity: 55,
          state_valid: true,
          simulated: false,
          timestamp: latestTs,
        },
        // app-owned registry metadata
        app: meta,
      },
    },
    thresholds: { [ahuId]: { supplyTemp: threshold(ahuId, "supplyTemp") } },
  });
}

/** Builds a verbatim owner-format device node (fields under status/). */
function snapshot(overrides: Record<string, unknown> = {}, ts = T0): Record<string, unknown> {
  return { status: { power: true, fan: 2, setpoint: 22, state_valid: true, simulated: false, timestamp: ts, ...overrides } };
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
  const ahuRec = await db.get<{ desiredRunState: string }>("devices/AHU-01/app");
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

test("createCommandRtdb: an uncommissioned unit locks PHYSICAL control (403)", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  db.set("devices/AHU-01/app", { physicalControlEnabled: false });
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

  const blocked = await acceptPendingRtdb(db, "AHU-01", T0 + 600);
  deepStrictEqual(blocked, [], "an ACCEPTED slot no longer accepts");
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
  const ahuRec = await db.get<{ desiredRunState: string }>("devices/AHU-01/app");
  equal(ahuRec?.desiredRunState, "STOP", "latest reading shows STOP → revert to STOP");
});

/* ── ingest ───────────────────────────────────────────────────────── */

test("processDaikinSnapshotRtdb: happy path mirrors verbatim, appends history, patches the registry", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  const result = await processDaikinSnapshotRtdb(
    db,
    "AHU-01",
    snapshot({ power: true, fan: 2, room_temp: 25.5, supply_temp: 21, setpoint: 22 }),
    T0,
  );
  equal(result.ok, true);

  const mirrorStatus = (await db.get<{ status: { timestamp: number; power: boolean; room_temp: number } }>("devices/AHU-01"))?.status;
  equal(mirrorStatus?.timestamp, T0);
  equal(mirrorStatus?.power, true);
  equal(mirrorStatus?.room_temp, 25.5);
  ok(await db.get("deviceHistory/AHU-01/2026-11-09/s21-AHU-01-" + T0), "history snapshot written");
  const meta = await db.get<{ lastSeenAt: number; setpoint: number }>("devices/AHU-01/app");
  equal(meta?.lastSeenAt, T0);
  equal(meta?.setpoint, 22, "setpoint echo lands in the app meta");
});

test("processDaikinSnapshotRtdb: auto-registers a device discovered on the mirror tree", async () => {
  const db = new InMemoryRtdb();
  const result = await processDaikinSnapshotRtdb(db, "AHU-NEW", snapshot({ room_temp: 23 }, T0), T0);
  equal(result.ok, true);
  const meta = await db.get<{ name: string; commTimeoutSec: number; physicalControlEnabled: boolean }>("devices/AHU-NEW/app");
  ok(meta, "app meta created with defaults");
  equal(meta?.name, "AHU-NEW");
});

test("processDaikinSnapshotRtdb: same device timestamp → 200 duplicated (FR-23)", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  equal((await processDaikinSnapshotRtdb(db, "AHU-01", snapshot({ room_temp: 25 }, T0), T0)).ok, true);
  const dup = await processDaikinSnapshotRtdb(db, "AHU-01", snapshot({ room_temp: 26 }, T0), T0 + 1_000);
  equal(dup.ok, true);
  if (dup.ok) equal((dup.body as { duplicated?: boolean }).duplicated, true);
  const stored = (await db.get<{ status: { room_temp: number } }>("deviceHistory/AHU-01/2026-11-09/s21-AHU-01-" + T0))?.status;
  equal(stored?.room_temp, 25, "first snapshot wins");
});

test("processDaikinSnapshotRtdb: threshold breach raises an alarm (delay 0) with active index", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  const result = await processDaikinSnapshotRtdb(db, "AHU-01", snapshot({ supply_temp: 30 }, T0), T0);
  equal(result.ok, true);
  const active = await db.get<Record<string, boolean>>("alarmsActive");
  ok(active && Object.keys(active).length === 1, "alarm indexed as active");
  const alarmId = Object.keys(active ?? {})[0];
  const record = await db.get<{ parameter: string; breachDirection: string; isActive: boolean }>(`alarms/${alarmId}`);
  equal(record?.parameter, "supplyTemp");
  equal(record?.breachDirection, "HIGH");
  equal(record?.isActive, true);
});

test("processDaikinSnapshotRtdb: debounce delay holds the alarm until the window elapses", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  db.set("thresholds/AHU-01/supplyTemp", threshold("AHU-01", "supplyTemp", { delaySec: 4 }));

  await processDaikinSnapshotRtdb(db, "AHU-01", snapshot({ supply_temp: 30 }, T0), T0);
  equal(await db.get("alarmsActive"), null, "first breach only arms the timer");

  await processDaikinSnapshotRtdb(db, "AHU-01", snapshot({ supply_temp: 31 }, T0 + 5_000), T0 + 5_000);
  const active = await db.get<Record<string, boolean>>("alarmsActive");
  ok(active && Object.keys(active).length === 1, "breach confirmed after the delay");
});

test("processDaikinSnapshotRtdb: a comm-timeout gap resets the debounce timer (mirrors SQL)", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  db.set("thresholds/AHU-01/supplyTemp", threshold("AHU-01", "supplyTemp", { delaySec: 4 }));

  await processDaikinSnapshotRtdb(db, "AHU-01", snapshot({ supply_temp: 30 }, T0), T0);
  await processDaikinSnapshotRtdb(db, "AHU-01", snapshot({ supply_temp: 31 }, T0 + 45_000), T0 + 45_000);
  equal(await db.get("alarmsActive"), null, "gap reset the debounce window");
});

test("processDaikinSnapshotRtdb: historical snapshot never regresses the live mirror", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  const historical = await processDaikinSnapshotRtdb(
    db,
    "AHU-01",
    snapshot({ room_temp: 20 }, T0 - 90_000),
    T0 + 1_000,
  );
  equal(historical.ok, true);
  const mirrorStatus = (await db.get<{ status: { timestamp: number; room_temp: number } }>("devices/AHU-01"))?.status;
  equal(mirrorStatus?.timestamp, T0 - 2_000, "mirror kept the newer reading");
  ok(await db.get(`deviceHistory/AHU-01/2026-11-08/s21-AHU-01-${T0 - 90_000}`), "historical snapshot still stored");
});

test("processDaikinSnapshotRtdb: a paused unit is stored but skips the engine", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  await db.set("devices/AHU-01/app", { enabled: false });
  const result = await processDaikinSnapshotRtdb(db, "AHU-01", snapshot({ supply_temp: 40 }, T0), T0);
  equal(result.ok, true);
  if (result.ok) equal((result.body as { paused?: boolean }).paused, true);
  equal(await db.get("alarmsActive"), null, "no alarms evaluated for paused units");
});

test("processDaikinSnapshotRtdb: invalid snapshot → 422; non-object → 400", async () => {
  const db = new InMemoryRtdb();
  seedBase(db);
  const bad = await processDaikinSnapshotRtdb(db, "AHU-01", { power: true }, T0);
  equal(bad.ok, false);
  if (!bad.ok) equal(bad.status, 422);
  const worse = await processDaikinSnapshotRtdb(db, "AHU-01", "nope" as unknown as Record<string, unknown>, T0);
  equal(worse.ok, false);
  if (!worse.ok) equal(worse.status, 400);
});
