import { test } from "node:test";
import { deepStrictEqual, equal, rejects } from "node:assert/strict";

import { InMemoryRtdb } from "../src/lib/rtdb/store";
import {
  getLatestTelemetry,
  telemetryDateKey,
  telemetryLatestNode,
  telemetryNode,
  writeTelemetryMirror,
  type RtdbTelemetryRecord,
} from "../src/lib/rtdb/telemetry";

function sample(overrides: Partial<RtdbTelemetryRecord> = {}): RtdbTelemetryRecord {
  return {
    ahuId: "AHU-01",
    messageId: "msg-0001",
    source: "SIMULATION",
    timestamp: Date.UTC(2026, 10, 9, 2, 0, 0),
    receivedAt: Date.UTC(2026, 10, 9, 2, 0, 1),
    roomTemp: 24.5,
    supplyTemp: 14.2,
    returnTemp: 23.9,
    humidity: 61,
    filterDiffPressure: 120,
    fanSpeed: 2,
    coilTemp: 12.8,
    damperPosition: 70,
    current: 5.4,
    isCurrentFallback: false,
    voltage: 398,
    isVoltageFallback: false,
    runHours: 1284.5,
    heaterOutput: 0,
    runState: "RUN",
    faultCode: null,
    ...overrides,
  };
}

test("telemetryDateKey shards by UTC calendar day", () => {
  equal(telemetryDateKey(Date.UTC(2026, 10, 9, 23, 59, 59)), "2026-11-09");
  equal(telemetryDateKey(Date.UTC(2026, 10, 10, 0, 0, 0)), "2026-11-10");
});

test("writeTelemetryMirror writes the history node with the flattened record", async () => {
  const db = new InMemoryRtdb();
  const record = sample();
  await writeTelemetryMirror(db, record);

  const path = telemetryNode("AHU-01", "2026-11-09", "msg-0001");
  deepStrictEqual(await db.get(path), record);
  // message with dots/slashes would break the tree — path validation rejects it
  await rejects(() => writeTelemetryMirror(db, sample({ messageId: "bad/id.1" })));
});

test("same messageId is idempotent (dedup semantics like the PG unique index)", async () => {
  const db = new InMemoryRtdb();
  await writeTelemetryMirror(db, sample({ roomTemp: 24.5 }));
  await writeTelemetryMirror(db, sample({ roomTemp: 25.1 }));

  const all = await db.get<Record<string, unknown>>(`telemetry/AHU-01/2026-11-09`);
  equal(Object.keys(all ?? {}).length, 1, "one key per messageId");
  const stored = await db.get<RtdbTelemetryRecord>(telemetryNode("AHU-01", "2026-11-09", "msg-0001"));
  equal(stored?.roomTemp, 25.1, "last write wins");
});

test("telemetryLatest follows newer samples and never regresses on late ones", async () => {
  const db = new InMemoryRtdb();
  const t1 = Date.UTC(2026, 10, 9, 2, 0, 0);
  const t2 = Date.UTC(2026, 10, 9, 2, 0, 5);
  const t0 = Date.UTC(2026, 10, 9, 1, 59, 0); // late/historical

  await writeTelemetryMirror(db, sample({ timestamp: t1, messageId: "m1" }));
  equal((await getLatestTelemetry(db, "AHU-01"))?.messageId, "m1");

  await writeTelemetryMirror(db, sample({ timestamp: t2, messageId: "m2" }));
  equal((await getLatestTelemetry(db, "AHU-01"))?.messageId, "m2");

  await writeTelemetryMirror(db, sample({ timestamp: t0, messageId: "m3" }));
  equal(
    (await getLatestTelemetry(db, "AHU-01"))?.messageId,
    "m2",
    "historical sample updates history but not latest",
  );
  deepStrictEqual(
    await db.get(`${telemetryNode("AHU-01", "2026-11-09", "m3")}`),
    sample({ timestamp: t0, messageId: "m3" }),
    "historical sample still lands in the history tree",
  );
});

test("latest node is namespaced per AHU", async () => {
  const db = new InMemoryRtdb();
  await writeTelemetryMirror(db, sample({ ahuId: "AHU-01", messageId: "m1" }));
  await writeTelemetryMirror(db, sample({ ahuId: "AHU-02", messageId: "m2" }));

  equal((await db.get(telemetryLatestNode("AHU-01")) as RtdbTelemetryRecord).messageId, "m1");
  equal((await db.get(telemetryLatestNode("AHU-02")) as RtdbTelemetryRecord).messageId, "m2");
});
