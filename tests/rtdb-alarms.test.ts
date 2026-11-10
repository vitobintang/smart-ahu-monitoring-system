import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";

import { InMemoryRtdb } from "../src/lib/rtdb/store";
import {
  alarmNode,
  alarmToJson,
  applyAlarmAck,
  applyAlarmResolve,
  writeRtdbAlarm,
  type RtdbAlarmRecord,
} from "../src/lib/rtdb/alarms";

const T0 = Date.UTC(2026, 10, 9, 5, 0, 0);

function record(overrides: Partial<RtdbAlarmRecord> = {}): RtdbAlarmRecord {
  return {
    id: "alm-1",
    ahuId: "AHU-01",
    parameter: "supplyTemp",
    priority: "HIGH",
    message: "Supply temperature above high limit",
    breachDirection: "HIGH",
    observedValue: 18.4,
    thresholdValue: 16,
    isActive: true,
    acknowledged: false,
    acknowledgedBy: null,
    acknowledgedAt: null,
    triggeredAt: T0,
    resolvedAt: null,
    ...overrides,
  };
}

test("writeRtdbAlarm stores the full record and is idempotent", async () => {
  const db = new InMemoryRtdb();
  await writeRtdbAlarm(db, record());
  deepStrictEqual(await db.get(alarmNode("alm-1")), record());
  await writeRtdbAlarm(db, record({ observedValue: 19.2 }));
  equal((await db.get<RtdbAlarmRecord>(alarmNode("alm-1")))?.observedValue, 19.2, "same id overwrites");
  equal(await db.get<RtdbAlarmRecord>(alarmNode("alm-other")), null, "no cross-talk between ids");
});

test("applyAlarmAck patches only acknowledgement fields", async () => {
  const db = new InMemoryRtdb();
  await writeRtdbAlarm(db, record());
  await applyAlarmAck(db, "alm-1", "uid-admin", T0 + 30_000);

  const stored = (await db.get<RtdbAlarmRecord>(alarmNode("alm-1")))!;
  equal(stored.acknowledged, true);
  equal(stored.acknowledgedBy, "uid-admin");
  equal(stored.acknowledgedAt, T0 + 30_000);
  equal(stored.isActive, true, "ack does not resolve");
  equal(stored.triggeredAt, T0, "original fields untouched");
  equal(stored.observedValue, 18.4, "original fields untouched");
});

test("applyAlarmResolve deactivates without touching ack fields", async () => {
  const db = new InMemoryRtdb();
  await writeRtdbAlarm(db, record({ acknowledged: true, acknowledgedBy: "uid-1", acknowledgedAt: T0 }));
  await applyAlarmResolve(db, "alm-1", T0 + 120_000);

  const stored = (await db.get<RtdbAlarmRecord>(alarmNode("alm-1")))!;
  equal(stored.isActive, false);
  equal(stored.resolvedAt, T0 + 120_000);
  equal(stored.acknowledged, true, "ack history preserved");
  equal(stored.acknowledgedBy, "uid-1");
});

test("full lifecycle: raise → ack → resolve → readback", async () => {
  const db = new InMemoryRtdb();
  await writeRtdbAlarm(db, record({ id: "alm-2", parameter: "current", priority: "CRITICAL" }));
  await applyAlarmAck(db, "alm-2", "uid-op", T0 + 5_000);
  await applyAlarmResolve(db, "alm-2", T0 + 60_000);

  const stored = (await db.get<RtdbAlarmRecord>(alarmNode("alm-2")))!;
  equal(stored.priority, "CRITICAL");
  equal(stored.acknowledged, true);
  equal(stored.isActive, false);
  equal(stored.resolvedAt, T0 + 60_000);

  // a late duplicate resolve is harmless (idempotent patch)
  await applyAlarmResolve(db, "alm-2", T0 + 61_000);
  equal((await db.get<RtdbAlarmRecord>(alarmNode("alm-2")))?.resolvedAt, T0 + 61_000);
});

test("alarmToJson survives RTDB-stripped nulls (prod /api/alarms 500 regression)", () => {
  // RTDB strips null fields on write, so an active alarm reads back with
  // acknowledgedAt/resolvedAt/breachDirection MISSING (undefined, not null).
  // new Date(undefined).toISOString() used to throw RangeError → 500.
  const stripped = {
    id: "alm-x",
    ahuId: "GTM-DAIKIN-001",
    parameter: "COMMUNICATION",
    priority: "HIGH",
    message: "Heartbeat lost",
    isActive: true,
    acknowledged: false,
    triggeredAt: 1_794_182_400_000,
  } as unknown as Parameters<typeof alarmToJson>[0];
  // (if this throws RangeError the test fails — the old bug)
  const json = alarmToJson(stripped);
  equal(json.acknowledgedAt, null);
  equal(json.resolvedAt, null);
  equal(json.breachDirection, null);
  equal(json.observedValue, null);
  equal(json.triggeredAt, new Date(1_794_182_400_000).toISOString());
});
