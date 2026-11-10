import assert from "node:assert/strict";
import test from "node:test";
import { equal } from "node:assert/strict";

import { InMemoryRtdb, type RtdbAdapter } from "../src/lib/rtdb/store";
import {
  commandsToControlPatch,
  findDeviceIdByToken,
  initialDaikinDeviceRecord,
  isDaikinShape,
  mapDaikinToSample,
  readDaikinDevice,
  readDeviceOwnerToken,
  writeDaikinControl,
  writeDeviceOwnerToken,
} from "../src/lib/rtdb/daikin";
import { ingestTelemetryRtdb } from "../src/lib/rtdb/lifecycle";
import { guardRtdbRoots } from "../src/lib/rtdb/store";
import { rejects } from "node:assert/strict";
import { setRtdbDevice, writeRtdbAhu } from "../src/lib/rtdb/registry";
import { createCommandRtdb, acceptPendingRtdb } from "../src/lib/rtdb/lifecycle";

const OWNER_NODE = "devices/GTM-DAIKIN-001";

const OWNER_RECORD = {
  capabilities: { cool: true, heat: false },
  fan: "auto",
  mode: "cool",
  online: true,
  power: true,
  room_temp: 27.4,
  rssi: -58,
  s21_connected: true,
  setpoint: 24,
  simulated: false,
  source: "s21",
  state_valid: true,
  timestamp: 1_760_000_000_000,
};

function ahu(overrides: Record<string, unknown> = {}) {
  return {
    id: "GTM-DAIKIN-001",
    name: "GTM-DAIKIN-001 · Daikin S21 AC",
    location: "GTM",
    commTimeoutSec: 30,
    hasHeater: false,
    installedSensors: ["roomTemp", "fanSpeed"],
    currentStatus: "RUN",
    lastSeenAt: 1_760_000_000_000,
    controlMode: "AUTO",
    desiredRunState: "RUN",
    setpoint: 24,
    faultCode: null,
    physicalControlEnabled: true,
    mapX: 10,
    mapZ: 12,
    mapRotation: 0,
    mapZone: null,
    updatedAt: 1,
    ...overrides,
  };
}

async function seedIntegration(rtdb: RtdbAdapter, overrides: Record<string, unknown> = {}) {
  await writeRtdbAhu(rtdb, ahu(overrides));
  await setRtdbDevice(rtdb, {
    id: "bridge-1",
    ahuId: "GTM-DAIKIN-001",
    label: "Daikin S21 Bridge (system)",
    token: "tok-s21",
    sourceType: "PHYSICAL",
    enabled: true,
    createdAt: 1,
  });
  // The owner's live bridge node (control write-through target).
  await rtdb.set(OWNER_NODE, { ...OWNER_RECORD, power: true });
  // A fresh latest sample keeps the FR-27 OFFLINE gate open for control.
  await rtdb.set("telemetryLatest/GTM-DAIKIN-001", {
    ahuId: "GTM-DAIKIN-001",
    messageId: "seed-latest",
    source: "PHYSICAL",
    timestamp: Date.now(),
    receivedAt: Date.now(),
    roomTemp: 27.4,
    fanSpeed: null,
    runState: "RUN",
  });
}

test("isDaikinShape and readDaikinDevice recognize the owner's bridge record", async () => {
  const rtdb: RtdbAdapter = new InMemoryRtdb();
  assert.equal(isDaikinShape(null), false);
  assert.equal(isDaikinShape({ id: "x", token: "y" }), false); // OUR gateway shape, not the bridge
  assert.equal(isDaikinShape({ power: true }), true);
  assert.equal(isDaikinShape({ room_temp: 25.5 }), true);

  await rtdb.set(OWNER_NODE, OWNER_RECORD);
  const record = await readDaikinDevice(rtdb, "GTM-DAIKIN-001");
  assert.ok(record);
  assert.equal(record.power, true);
  assert.equal(await readDaikinDevice(rtdb, "AHU-99"), null);
});

test("mapDaikinToSample maps the bridge fields onto ingest samples", () => {
  const sample = mapDaikinToSample(OWNER_RECORD, "GTM-DAIKIN-001");
  assert.ok(sample);
  assert.equal(sample.messageId, "s21-GTM-DAIKIN-001-1760000000000");
  assert.equal(sample.timestampIso, new Date(1_760_000_000_000).toISOString());
  assert.equal(sample.parameters.roomTemp, 27.4);
  assert.equal(sample.parameters.fanSpeed, null); // "auto" has no numeric speed
  assert.equal(sample.runState, "RUN");
  assert.equal(sample.setpoint, 24);
  assert.equal(sample.source, "PHYSICAL");

  const numericFan = mapDaikinToSample({ ...OWNER_RECORD, fan: "3", power: false, simulated: true }, "GTM-DAIKIN-001");
  assert.ok(numericFan);
  assert.equal(numericFan.parameters.fanSpeed, 3);
  assert.equal(numericFan.runState, "STOP");
  assert.equal(numericFan.source, "SIMULATION");

  // unusable states produce no sample
  assert.equal(mapDaikinToSample({ ...OWNER_RECORD, state_valid: false }, "GTM-DAIKIN-001"), null);
  assert.equal(mapDaikinToSample({ power: true, timestamp: Number.NaN }, "GTM-DAIKIN-001"), null);
});

test("writeDaikinControl patches only control fields and refuses non-bridge nodes", async () => {
  const rtdb: RtdbAdapter = new InMemoryRtdb();
  await rtdb.set(OWNER_NODE, OWNER_RECORD);
  await rtdb.set("gateways/GTM-DAIKIN-001/gw", { id: "gw" });

  assert.equal(await writeDaikinControl(rtdb, "AHU-99", { power: false }), false); // no bridge node
  assert.equal(await writeDaikinControl(rtdb, "GTM-DAIKIN-001", {}), false); // nothing to write

  assert.equal(await writeDaikinControl(rtdb, "GTM-DAIKIN-001", { power: false, setpoint: 22 }), true);
  const updated = await readDaikinDevice(rtdb, "GTM-DAIKIN-001");
  assert.ok(updated);
  assert.equal(updated.power, false);
  assert.equal(updated.setpoint, 22);
  assert.equal(updated.mode, "cool"); // untouched
  assert.equal(updated.room_temp, 27.4); // untouched
  assert.equal(await rtdb.get("gateways/GTM-DAIKIN-001/gw/id"), "gw"); // sibling trees untouched
});

test("commandsToControlPatch maps accepted command types onto bridge writes", () => {
  assert.deepEqual(
    commandsToControlPatch([
      { id: "1", commandType: "START" },
      { id: "2", commandType: "MODE_AUTO" },
      { id: "3", commandType: "SETPOINT", payload: { setpoint: 21 } },
    ]),
    { power: true, setpoint: 21 },
  );
  assert.deepEqual(commandsToControlPatch([{ id: "4", commandType: "STOP" }]), { power: false });
  assert.deepEqual(commandsToControlPatch([{ id: "5", commandType: "SETPOINT", payload: {} }]), {});
});

test("deviceOwners: token write/read and reverse lookup", async () => {
  const owner: RtdbAdapter = new InMemoryRtdb();
  assert.equal(await readDeviceOwnerToken(owner, "GTM-DAIKIN-001"), null);

  await writeDeviceOwnerToken(owner, "GTM-DAIKIN-001", "preshared-token-01");
  assert.equal(await readDeviceOwnerToken(owner, "GTM-DAIKIN-001"), "preshared-token-01");
  assert.equal(await findDeviceIdByToken(owner, "preshared-token-01"), "GTM-DAIKIN-001");
  assert.equal(await findDeviceIdByToken(owner, "nope"), null);
  assert.equal(await findDeviceIdByToken(owner, ""), null);

  // overwrite (re-registration)
  await writeDeviceOwnerToken(owner, "GTM-DAIKIN-001", "rotated-token-02");
  assert.equal(await readDeviceOwnerToken(owner, "GTM-DAIKIN-001"), "rotated-token-02");
});

test("initialDaikinDeviceRecord is inert until the bridge reports (no phantom samples)", () => {
  const record = initialDaikinDeviceRecord(1_760_000_000_000);
  assert.equal(isDaikinShape(record), true);
  assert.equal(mapDaikinToSample(record, "GTM-DAIKIN-001"), null); // state_valid:false, no room_temp
  assert.equal(record.source, "web-registration");
});

test("ingest accepts the owner's pre-shared device token (PHYSICAL)", async () => {
  const appDb: RtdbAdapter = new InMemoryRtdb();
  await writeRtdbAhu(appDb, ahu());
  const ownerDb: RtdbAdapter = new InMemoryRtdb();
  await writeDeviceOwnerToken(ownerDb, "GTM-DAIKIN-001", "preshared-token-01");

  const bad = await ingestTelemetryRtdb(appDb, "wrong-token", { messageId: "m-1", timestamp: new Date(1_760_000_000_000).toISOString(), parameters: { roomTemp: 25 } }, 1_760_000_000_000, ownerDb);
  equal(bad.ok, false);
  if (!bad.ok) equal(bad.status, 401);

  const okResult = await ingestTelemetryRtdb(appDb, "preshared-token-01", { messageId: "m-1", timestamp: new Date(1_760_000_000_000).toISOString(), parameters: { roomTemp: 25 }, runState: "RUN" }, 1_760_000_000_000, ownerDb);
  equal(okResult.ok, true);
  const latest = await appDb.get<{ ahuId: string; source: string }>("telemetryLatest/GTM-DAIKIN-001");
  equal(latest?.ahuId, "GTM-DAIKIN-001");
  equal(latest?.source, "PHYSICAL");
});

test("a commissioned physical bridge (physicalControlEnabled) accepts and writes control through", async () => {
  const rtdb: RtdbAdapter = new InMemoryRtdb();
  await seedIntegration(rtdb);

  const outcome = await createCommandRtdb(rtdb, {
    ahuId: "GTM-DAIKIN-001",
    commandType: "STOP",
    userId: "admin-1",
    userEmail: "a@b.c",
    ipAddress: null,
  });
  if ("error" in outcome) assert.fail(outcome.error);

  const accepted = await acceptPendingRtdb(rtdb, "GTM-DAIKIN-001", Date.now(), rtdb);
  assert.deepEqual(accepted, [outcome.commandId]);

  const record = await readDaikinDevice(rtdb, "GTM-DAIKIN-001");
  assert.ok(record);
  assert.equal(record.power, false); // write-through reached the owner's node
});

test("an uncommissioned physical unit still refuses control (default safety)", async () => {
  const rtdb: RtdbAdapter = new InMemoryRtdb();
  await seedIntegration(rtdb, { physicalControlEnabled: false });

  const outcome = await createCommandRtdb(rtdb, {
    ahuId: "GTM-DAIKIN-001",
    commandType: "STOP",
    userId: "admin-1",
    userEmail: "a@b.c",
    ipAddress: null,
  });
  assert.ok("error" in outcome);
  assert.equal((outcome as { code?: string }).code, "PHYSICAL_LOCKED");
});

test("owner adapter guard: only devices/ + deviceOwners/ are reachable, ever", async () => {
  const db: RtdbAdapter = new InMemoryRtdb();
  const owner = guardRtdbRoots(db, ["devices", "deviceOwners"], "owner");

  // the two agreed trees work in full
  await owner.set("devices/GTM-DAIKIN-001", { power: false, setpoint: 24 });
  await owner.set("deviceOwners/GTM-DAIKIN-001", "preshared-token-01");
  await owner.update("devices/GTM-DAIKIN-001", { power: true });
  equal(await owner.get<string>("deviceOwners/GTM-DAIKIN-001"), "preshared-token-01");
  equal((await owner.get<{ power: boolean }>("devices/GTM-DAIKIN-001"))?.power, true);
  const tx = await owner.transaction<{ power: boolean }>("devices/GTM-DAIKIN-001", (current) => ({
    ...(current as { power: boolean }),
    power: false,
  }));
  equal(tx.committed, true);

  // every other top-level tree — including everything app-owned — is refused
  const forbidden = [
    "users/x",
    "usernames/x",
    "emails/x",
    "telemetry/GTM-DAIKIN-001/2026-11-10/m1",
    "telemetryLatest/GTM-DAIKIN-001",
    "commands/c1",
    "commandActive/c1",
    "alarms/a1",
    "alarmsActive/a1",
    "alarmBreachTimers/a1",
    "ahus/GTM-DAIKIN-001",
    "gateways/GTM-DAIKIN-001/g1",
    "thresholds/GTM-DAIKIN-001",
    "trendAlerts/t1",
    "auditLogs/l1",
    "loginAttempts/k",
    "facility/floorplan",
    "ahu-app/anything",
    "brandNewNode/whatever",
    "",
  ];
  for (const path of forbidden) {
    await rejects(() => owner.get(path), /outside the allowed trees/);
    await rejects(() => owner.set(path, 1), /outside the allowed trees/);
    await rejects(() => owner.update(path, { a: 1 }), /outside the allowed trees/);
    await rejects(() => owner.remove(path), /outside the allowed trees/);
    await rejects(() => owner.transaction(path, (current) => current), /outside the allowed trees/);
  }

  // the underlying database was never touched by the refused operations
  for (const root of ["users", "telemetry", "telemetryLatest", "commands", "alarms", "ahus", "gateways", "thresholds", "auditLogs", "loginAttempts", "facility"]) {
    equal(await db.get(root), null, `${root} must not exist on the owner database`);
  }
});
