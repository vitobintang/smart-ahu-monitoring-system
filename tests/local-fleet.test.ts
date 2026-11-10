import { test } from "node:test";
import { deepStrictEqual, equal, ok } from "node:assert/strict";

import { InMemoryRtdb } from "../src/lib/rtdb/store";
import {
  ensureLocalFleet,
  listLocalDeviceIds,
  localFleetTick,
  LOCAL_FLEET,
  readActiveFleetRecords,
  readDeviceSource,
  writeDeviceSource,
} from "../src/lib/rtdb/local-fleet";
import { defaultAhuRecord, writeRtdbAhu, type RtdbAhuRecord } from "../src/lib/rtdb/registry";

test("device source defaults to daikin and round-trips", async () => {
  const rtdb = new InMemoryRtdb();
  equal(await readDeviceSource(rtdb), "daikin");
  await writeDeviceSource(rtdb, "local");
  equal(await readDeviceSource(rtdb), "local");
});

test("ensureLocalFleet seeds the exact fictional mix, daikin-shaped, idempotent", async () => {
  const rtdb = new InMemoryRtdb();
  const counts = { AHU: 0, AC_DAK: 0, AC_STANDING: 0, AC_SPLIT_WALL: 0 };
  for (const spec of LOCAL_FLEET) counts[spec.deviceType] += 1;
  deepStrictEqual(counts, { AHU: 1, AC_DAK: 2, AC_STANDING: 1, AC_SPLIT_WALL: 3 });

  const created = await ensureLocalFleet(rtdb);
  equal(created.length, LOCAL_FLEET.length);
  const again = await ensureLocalFleet(rtdb);
  equal(again.length, 0, "second run seeds nothing");
  equal((await listLocalDeviceIds(rtdb)).length, 7);

  const node = await rtdb.get<Record<string, unknown>>("localDevices/LOC-AHU-01/status");
  ok(node, "status node exists");
  for (const key of ["capabilities", "fan", "mode", "online", "power", "room_temp", "rssi", "s21_connected", "setpoint", "simulated", "source", "state_valid", "timestamp"]) {
    ok(key in (node as object), `daikin-shaped field present: ${key}`);
  }
  const token = await rtdb.get<string>("localDeviceOwners/LOC-AHU-01");
  ok(typeof token === "string" && token.length > 8, "scalar token exists in localDeviceOwners");

  // Every fictional unit is registered in the fleet registry with deviceType + map placement.
  const { readRtdbAhus } = await import("../src/lib/rtdb/registry");
  const registry = await readRtdbAhus(rtdb);
  for (const spec of LOCAL_FLEET) {
    const rec = registry.get(spec.id);
    ok(rec, `${spec.id} registered`);
    equal(rec?.deviceType, spec.deviceType);
    equal(rec?.fleetSource, "local");
    ok(rec?.mapX !== null && rec?.mapZ !== null, `${spec.id} has an indoor map slot`);
  }
});

test("localFleetTick updates ONLY telemetry — never power/setpoint", async () => {
  const rtdb = new InMemoryRtdb();
  await ensureLocalFleet(rtdb);
  await rtdb.update("localDevices/LOC-AHU-01/status", { power: true, setpoint: 20, room_temp: 26 });
  const beforeTs = (await rtdb.get<Record<string, number>>("localDevices/LOC-AHU-01/status"))!.timestamp;

  await new Promise((r) => setTimeout(r, 5));
  await localFleetTick(rtdb);

  const after = (await rtdb.get<Record<string, number | boolean>>("localDevices/LOC-AHU-01/status"))!;
  equal(after.power, true, "power untouched by the tick");
  equal(after.setpoint, 20, "setpoint untouched by the tick");
  ok((after.timestamp as number) > beforeTs, "timestamp advanced");
  const temp = after.room_temp as number;
  ok(temp < 26 && temp >= 19, `room temp cools toward setpoint, got ${temp}`);
});

test("readActiveFleetRecords filters by the active source", async () => {
  const rtdb = new InMemoryRtdb();
  const real: RtdbAhuRecord = { ...defaultAhuRecord("GTM-DAIKIN-001"), mapX: -12, mapZ: -13, currentStatus: "OFFLINE" };
  await writeRtdbAhu(rtdb, real);
  deepStrictEqual([...(await readActiveFleetRecords(rtdb)).keys()], ["GTM-DAIKIN-001"]);

  await ensureLocalFleet(rtdb);
  deepStrictEqual([...(await readActiveFleetRecords(rtdb)).keys()], ["GTM-DAIKIN-001"], "local units hidden while source=daikin");

  await writeDeviceSource(rtdb, "local");
  const local = await readActiveFleetRecords(rtdb);
  ok(!local.has("GTM-DAIKIN-001"), "real unit hidden while source=local");
  equal(local.size, 7);
});
