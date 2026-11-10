import { test } from "node:test";
import { deepStrictEqual, equal, rejects } from "node:assert/strict";

import { InMemoryRtdb } from "../src/lib/rtdb/store";
import {
  DEVICE_HISTORY_NODE,
  DEVICE_MIRROR_NODE,
  getLatestTelemetry,
  snapshotMessageId,
  snapshotToRecord,
  telemetryDateKey,
  telemetryLatestNode,
  telemetryNode,
  writeDeviceSnapshot,
} from "../src/lib/rtdb/telemetry";

/** Verbatim device node in the OWNER project's VERIFIED format (status/ child). */
function snap(overrides: Record<string, unknown> = {}, ts = Date.UTC(2026, 10, 9, 2, 0, 0)): Record<string, unknown> {
  return {
    status: {
      power: true,
      setpoint: 24,
      mode: "cool",
      fan: "2",
      room_temp: 24.5,
      state_valid: true,
      simulated: false,
      timestamp: ts,
      ...overrides,
    },
  };
}

test("telemetryDateKey shards by UTC calendar day", () => {
  equal(telemetryDateKey(Date.UTC(2026, 10, 9, 23, 59, 59)), "2026-11-09");
  equal(telemetryDateKey(Date.UTC(2026, 10, 10, 0, 0, 0)), "2026-11-10");
});

test("snapshotToRecord maps the owner field format onto the stable view", () => {
  const record = snapshotToRecord("GTM-DAIKIN-001", snap());
  if (!record) throw new Error("expected a record");
  equal(record.ahuId, "GTM-DAIKIN-001");
  equal(record.messageId, snapshotMessageId("GTM-DAIKIN-001", Date.UTC(2026, 10, 9, 2, 0, 0)));
  equal(record.source, "PHYSICAL");
  equal(record.roomTemp, 24.5);
  equal(record.fanSpeed, 2);
  equal(record.runState, "RUN");
  equal(record.humidity, null);

  // simulated flag → SIMULATION source; power:false → STOP
  const sim = snapshotToRecord("AHU-9", snap({ simulated: true, power: false }, Date.UTC(2026, 10, 9, 3, 0, 0)));
  equal(sim?.source, "SIMULATION");
  equal(sim?.runState, "STOP");

  // no valid timestamp → null (engine skips it)
  equal(snapshotToRecord("AHU-9", snap({ timestamp: "not-a-date" })), null);
  equal(snapshotToRecord("AHU-9", snap({ timestamp: 0 })), null);

  // VERIFIED bridge quirks: fan "auto" → null; source "mock" → SIMULATION;
  // rssi/capabilities/online ignored by the view
  const real = snapshotToRecord("AHU-9", {
    status: {
      capabilities: { auto: "unsupported", heat: "unsupported", room_temp: "supported" },
      fan: "auto",
      mode: "cool",
      online: true,
      power: false,
      room_temp: 26.5,
      rssi: -40,
      s21_connected: false,
      setpoint: 24,
      simulated: true,
      source: "mock",
      state_valid: true,
      timestamp: 1_794_242_683_818,
    },
  });
  equal(real?.fanSpeed, null, "fan auto → null");
  equal(real?.runState, "STOP");
  equal(real?.roomTemp, 26.5);
  equal(real?.source, "SIMULATION");
});

test("writeDeviceSnapshot stores the snapshot VERBATIM + updates the live mirror", async () => {
  const db = new InMemoryRtdb();
  const node = snap();
  const { written, record } = await writeDeviceSnapshot(db, "GTM-DAIKIN-001", node);
  equal(written, true);
  equal(record?.roomTemp, 24.5);

  const key = snapshotMessageId("GTM-DAIKIN-001", Date.UTC(2026, 10, 9, 2, 0, 0));
  deepStrictEqual(
    await db.get(telemetryNode("GTM-DAIKIN-001", "2026-11-09", key)),
    node,
    "history holds the exact owner-format snapshot",
  );
  deepStrictEqual(
    await db.get(`${DEVICE_MIRROR_NODE}/GTM-DAIKIN-001`),
    node,
    "live mirror holds the exact owner-format snapshot",
  );
});

test("app metadata under devices/{id}/app survives mirror syncs", async () => {
  const db = new InMemoryRtdb();
  await db.set(`${DEVICE_MIRROR_NODE}/GTM-DAIKIN-001/app`, { name: "Lab AHU", mapX: 3.5 });
  await writeDeviceSnapshot(db, "GTM-DAIKIN-001", snap());
  const meta = await db.get<Record<string, unknown>>(`${DEVICE_MIRROR_NODE}/GTM-DAIKIN-001/app`);
  equal(meta?.name, "Lab AHU");
  equal(meta?.mapX, 3.5);
});

test("same device timestamp is idempotent (FR-23 dedup)", async () => {
  const db = new InMemoryRtdb();
  const first = await writeDeviceSnapshot(db, "GTM-DAIKIN-001", snap({ room_temp: 24.5 }));
  equal(first.written, true);
  const second = await writeDeviceSnapshot(db, "GTM-DAIKIN-001", snap({ room_temp: 25.1 }));
  equal(second.written, false, "duplicate device timestamp is skipped");
  const shard = await db.get<Record<string, unknown>>(`${DEVICE_HISTORY_NODE}/GTM-DAIKIN-001/2026-11-09`);
  equal(Object.keys(shard ?? {}).length, 1);
  equal(second.record?.roomTemp, 24.5, "view reflects the FIRST stored snapshot");
});

test("getLatestTelemetry reads the live mirror and follows newer snapshots", async () => {
  const db = new InMemoryRtdb();
  equal(await getLatestTelemetry(db, "GTM-DAIKIN-001"), null);

  const t1 = Date.UTC(2026, 10, 9, 2, 0, 0);
  const t2 = Date.UTC(2026, 10, 9, 2, 0, 5);
  await writeDeviceSnapshot(db, "GTM-DAIKIN-001", snap({}, t1));
  equal((await getLatestTelemetry(db, "GTM-DAIKIN-001"))?.timestamp, t1);

  await writeDeviceSnapshot(db, "GTM-DAIKIN-001", snap({ room_temp: 25 }, t2));
  const latest = await getLatestTelemetry(db, "GTM-DAIKIN-001");
  equal(latest?.timestamp, t2);
  equal(latest?.roomTemp, 25);

  // late/historical snapshot: mirror update overwrites fields, but the mirror
  // IS the device's own reported state — the key dedup guard is the history key.
  await writeDeviceSnapshot(db, "GTM-DAIKIN-001", snap({ room_temp: 23 }, t1)).then((r) => equal(r.written, false));
  equal((await getLatestTelemetry(db, "GTM-DAIKIN-001"))?.roomTemp, 25);
});

test("latest view is namespaced per device", async () => {
  const db = new InMemoryRtdb();
  await writeDeviceSnapshot(db, "GTM-DAIKIN-001", snap({}, Date.UTC(2026, 10, 9, 2, 0, 0)));
  await writeDeviceSnapshot(db, "GTM-DAIKIN-001", snap({ room_temp: 26 }, Date.UTC(2026, 10, 9, 2, 1, 0)));

  const status = (await db.get<{ status: { room_temp: number } }>(telemetryLatestNode("GTM-DAIKIN-001")) as { status?: { room_temp: number } })?.status;
  equal(status?.room_temp, 26);
});

test("snapshot with no valid timestamp is rejected (written:false, record:null)", async () => {
  const db = new InMemoryRtdb();
  const result = await writeDeviceSnapshot(db, "GTM-DAIKIN-001", snap({ timestamp: undefined }));
  equal(result.written, false);
  equal(result.record, null);
  equal(await db.get(`${DEVICE_HISTORY_NODE}/GTM-DAIKIN-001/2026-11-09`), null);
});

test("path validation still applies to history keys", async () => {
  const db = new InMemoryRtdb();
  await rejects(() => db.set(telemetryNode("GTM-DAIKIN-001", "2026-11-09", "bad/id.1"), {}));
});
