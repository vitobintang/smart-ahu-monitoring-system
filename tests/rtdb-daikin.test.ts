import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryRtdb, type RtdbAdapter } from "../src/lib/rtdb/store";
import {
  commandsToControlPatch,
  isDaikinShape,
  mapDaikinToSample,
  readDaikinDevice,
  writeDaikinControl,
} from "../src/lib/rtdb/daikin";
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

  const accepted = await acceptPendingRtdb(rtdb, "GTM-DAIKIN-001");
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
