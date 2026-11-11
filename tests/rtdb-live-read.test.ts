import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";

import { InMemoryRtdb, type RtdbAdapter } from "../src/lib/rtdb/store";
import {
  firebaseEnvConfigured,
  readLatestTelemetry,
  toLatestRow,
  tryGetAhuRtdb,
} from "../src/lib/rtdb/live-read";
import { writeDeviceSnapshot, type RtdbTelemetryRecord } from "../src/lib/rtdb/telemetry";

const emptyEnv = { ...process.env } as NodeJS.ProcessEnv;
for (const k of Object.keys(emptyEnv))
  if (k.startsWith("NEXT_PUBLIC_FIREBASE") || k.startsWith("FIREBASE_")) delete (emptyEnv as Record<string, unknown>)[k];

function sample(overrides: Partial<RtdbTelemetryRecord> = {}): RtdbTelemetryRecord {
  return {
    ahuId: "AHU-01",
    messageId: "m1",
    source: "SIMULATION",
    timestamp: Date.UTC(2026, 10, 9, 3, 0, 0),
    receivedAt: Date.UTC(2026, 10, 9, 3, 0, 1),
    roomTemp: 24.1,
    supplyTemp: 14,
    returnTemp: 23.7,
    humidity: 60,
    filterDiffPressure: 118,
    fanSpeed: 2,
    coilTemp: 12.5,
    damperPosition: 65,
    current: 5.2,
    isCurrentFallback: false,
    voltage: 399,
    isVoltageFallback: false,
    runHours: 1300,
    heaterOutput: 0,
    runState: "RUN",
    faultCode: null,
    ...overrides,
  };
}

test("firebaseEnvConfigured requires the public config AND admin credentials", () => {
  equal(firebaseEnvConfigured(emptyEnv), false);
  equal(firebaseEnvConfigured({ ...process.env, NEXT_PUBLIC_FIREBASE_PROJECT_ID: "p" }), false);
  equal(
    firebaseEnvConfigured({
      ...process.env,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "p",
      FIREBASE_SERVICE_ACCOUNT_PATH: "./sa.json",
    }),
    true,
  );
  equal(
    firebaseEnvConfigured({
      ...process.env,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "p",
      FIREBASE_SERVICE_ACCOUNT_JSON: "{}",
    }),
    true,
  );
  equal(
    firebaseEnvConfigured({
      ...process.env,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "p",
      FIREBASE_SERVICE_ACCOUNT: "{}",
    }),
    true,
  );
});

test("tryGetAhuRtdb returns null (never throws) when Firebase env is missing", async () => {
  equal(await tryGetAhuRtdb(emptyEnv), null);
});

test("readLatestTelemetry collects hits and skips misses", async () => {
  const db = new InMemoryRtdb();
  await writeDeviceSnapshot(db, "AHU-01", { power: true, fan: 2, room_temp: 24.1, timestamp: Date.UTC(2026, 10, 9, 3, 0, 0) });
  await writeDeviceSnapshot(db, "AHU-02", { power: false, fan: 0, room_temp: 21, timestamp: Date.UTC(2026, 10, 9, 3, 5, 0) });

  const hits = await readLatestTelemetry(db, ["AHU-01", "AHU-02", "AHU-03"]);
  equal(hits.size, 2);
  equal(hits.get("AHU-01")?.roomTemp, 24.1);
  equal(hits.get("AHU-02")?.runState, "STOP");
  equal(hits.has("AHU-03"), false);
});

test("readLatestTelemetry skips units whose read fails (allSettled semantics)", async () => {
  const db = new InMemoryRtdb();
  await writeDeviceSnapshot(db, "AHU-01", { power: true, fan: 2, timestamp: Date.UTC(2026, 10, 9, 3, 0, 0) });
  const flaky: RtdbAdapter = {
    get: async <T,>(path: string) => {
      if (path.startsWith("devices/AHU-02")) throw new Error("simulated RTDB hiccup");
      return db.get<T>(path);
    },
    set: (path, value) => db.set(path, value),
    update: (path, values) => db.update(path, values),
    remove: (path) => db.remove(path),
    transaction: <T,>(path: string, compute: (current: T | null) => T | undefined) =>
      db.transaction<T>(path, compute),
  };

  const hits = await readLatestTelemetry(flaky, ["AHU-01", "AHU-02"]);
  equal(hits.size, 1);
  equal(hits.has("AHU-01"), true);
  equal(hits.has("AHU-02"), false, "failed unit is left for the PostgreSQL backfill");
});

test("toLatestRow maps the mirror record onto the dashboard row shape", () => {
  const row = toLatestRow(sample({ messageId: "s21-AHU-01-x", faultCode: "E-LO", roomTemp: null }));
  deepStrictEqual(row.timestamp, new Date(Date.UTC(2026, 10, 9, 3, 0, 0)));
  equal(row.source, "SIMULATION");
  equal(row.faultCode, "E-LO");
  equal(row.roomTemp, null);
  equal(row.supplyTemp, 14);
  equal(row.isVoltageFallback, false);
  equal(row.heaterOutput, 0);
});
