import { test } from "node:test";
import { deepStrictEqual, equal, rejects } from "node:assert/strict";

import { InMemoryRtdb, type RtdbAdapter } from "../src/lib/rtdb/store";
import { listUtcDays, readTelemetryRange, streamTelemetryRangeDescending } from "../src/lib/rtdb/history";
import { alarmToJson, applyAlarmResolve, readActiveAlarmRecords, writeRtdbAlarm, type RtdbAlarmRecord } from "../src/lib/rtdb/alarms";
import { auditEntryToJson, distinctAuditActions, filterAuditEntries, writeRtdbAuditLog, type RtdbAuditRecord } from "../src/lib/rtdb/audit";
import { pruneTelemetryShards, writeTelemetryMirror, type RtdbTelemetryRecord } from "../src/lib/rtdb/telemetry";
import { buildReportFromRows, getSeries, streamReportCsv, type ReportSampleRow } from "../src/lib/queries";

async function readAllCsv(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 9, 0, 0, 0);

function sample(overrides: Partial<RtdbTelemetryRecord> = {}): RtdbTelemetryRecord {
  return {
    ahuId: "AHU-01",
    messageId: "m1",
    source: "SIMULATION",
    timestamp: T0,
    receivedAt: T0,
    roomTemp: 24,
    supplyTemp: 14,
    returnTemp: 23,
    humidity: 60,
    filterDiffPressure: 120,
    fanSpeed: 2,
    coilTemp: 12,
    damperPosition: 70,
    current: 5,
    isCurrentFallback: false,
    voltage: 400,
    isVoltageFallback: false,
    runHours: 10,
    heaterOutput: 0,
    runState: "RUN",
    faultCode: null,
    ...overrides,
  };
}

test("listUtcDays spans day boundaries inclusively and caps", () => {
  deepStrictEqual(listUtcDays(Date.UTC(2026, 10, 9, 12, 0, 0), Date.UTC(2026, 10, 9, 13, 0, 0)), ["2026-11-09"]);
  deepStrictEqual(listUtcDays(Date.UTC(2026, 9, 31, 23, 0, 0), Date.UTC(2026, 10, 1, 1, 0, 0)), ["2026-10-31", "2026-11-01"]);
  deepStrictEqual(listUtcDays(T0, T0 + 3 * DAY), ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]);
  equal(listUtcDays(T0, T0 + 100 * DAY).length, 40);
});

test("readTelemetryRange filters by range and source across day shards, ascending", async () => {
  const db = new InMemoryRtdb();
  await writeTelemetryMirror(db, sample({ messageId: "d1-t1", timestamp: T0 + 1_000 }));
  await writeTelemetryMirror(db, sample({ messageId: "d1-t2", timestamp: T0 + DAY + 2_000, source: "PHYSICAL" }));
  await writeTelemetryMirror(db, sample({ messageId: "d2-t1", timestamp: T0 + DAY + 3_000 }));
  await writeTelemetryMirror(db, sample({ messageId: "early", timestamp: T0 - 5_000 }));
  await writeTelemetryMirror(db, sample({ messageId: "late", timestamp: T0 + 2 * DAY + 5_000 }));

  const all = await readTelemetryRange(db, "AHU-01", T0, T0 + 2 * DAY);
  deepStrictEqual(
    all.map((r) => r.messageId),
    ["d1-t1", "d1-t2", "d2-t1"],
    "in-range only, ascending across shards",
  );

  const physical = await readTelemetryRange(db, "AHU-01", T0, T0 + 2 * DAY, "PHYSICAL");
  deepStrictEqual(physical.map((r) => r.messageId), ["d1-t2"]);

  const perUnit = await readTelemetryRange(db, "AHU-02", T0, T0 + 2 * DAY);
  deepStrictEqual(perUnit, []);
});

test("readTelemetryRange rejects (no partial result) when a shard read fails", async () => {
  const db = new InMemoryRtdb();
  await writeTelemetryMirror(db, sample({ messageId: "ok" }));
  const flaky: RtdbAdapter = {
    get: async <T,>(path: string) => {
      if (path.includes("/2026-11-10")) throw new Error("shard hiccup");
      return db.get<T>(path);
    },
    set: (path, value) => db.set(path, value),
    update: (path, values) => db.update(path, values),
    remove: (path) => db.remove(path),
    transaction: <T,>(path: string, compute: (current: T | null) => T | null | undefined) =>
      db.transaction<T>(path, compute),
  };
  await rejects(() => readTelemetryRange(flaky, "AHU-01", T0, T0 + 2 * DAY));
});

test("alarmsActive index: written for active records, dropped on resolve, readable", async () => {
  const db = new InMemoryRtdb();
  const alarm = (overrides: Partial<RtdbAlarmRecord>): RtdbAlarmRecord => ({
    id: "alm-1",
    ahuId: "AHU-01",
    parameter: "supplyTemp",
    priority: "HIGH",
    message: "m",
    breachDirection: "HIGH",
    observedValue: 18,
    thresholdValue: 16,
    isActive: true,
    acknowledged: false,
    acknowledgedBy: null,
    acknowledgedAt: null,
    triggeredAt: T0,
    resolvedAt: null,
    ...overrides,
  });

  await writeRtdbAlarm(db, alarm({ id: "alm-a" }));
  await writeRtdbAlarm(db, alarm({ id: "alm-b", ahuId: "AHU-02" }));
  await writeRtdbAlarm(db, alarm({ id: "alm-c", isActive: false, resolvedAt: T0 + 1 }));

  equal((await readActiveAlarmRecords(db)).length, 2, "inactive records are not indexed");

  await applyAlarmResolve(db, "alm-a", T0 + 10);
  const remaining = await readActiveAlarmRecords(db);
  deepStrictEqual(remaining.map((r) => r.id), ["alm-b"]);

  const json = alarmToJson(alarm({ id: "alm-j", triggeredAt: T0, resolvedAt: null }));
  equal(json.triggeredAt, new Date(T0).toISOString());
  equal(json.resolvedAt, null);
  equal(json.isActive, true);
});

test("audit filter: substring action, exact entity, newest-first, limit", () => {
  const entries: RtdbAuditRecord[] = [
    { id: "1", userId: "u", userEmail: null, action: "COMMAND_REQUESTED", entity: "command:a", details: {}, ipAddress: null, createdAt: T0 },
    { id: "2", userId: "u", userEmail: null, action: "COMMAND_ACCEPTED", entity: "command:a", details: {}, ipAddress: null, createdAt: T0 + 2 },
    { id: "3", userId: "u", userEmail: null, action: "ALARM_TRIGGERED", entity: "alarm:x", details: {}, ipAddress: null, createdAt: T0 + 1 },
  ];
  deepStrictEqual(filterAuditEntries(entries, { action: "COMMAND" }).map((e) => e.id), ["2", "1"]);
  deepStrictEqual(filterAuditEntries(entries, { entity: "alarm:x" }).map((e) => e.id), ["3"]);
  deepStrictEqual(filterAuditEntries(entries, {}).map((e) => e.id), ["2", "3", "1"]);
  equal(filterAuditEntries(entries, { limit: 2 }).length, 2);
  deepStrictEqual(distinctAuditActions(entries), ["ALARM_TRIGGERED", "COMMAND_ACCEPTED", "COMMAND_REQUESTED"]);
  equal((auditEntryToJson(entries[0]) as { createdAt: string }).createdAt, new Date(T0).toISOString());
});

function row(overrides: Partial<ReportSampleRow> & { t: number }): ReportSampleRow {
  const { t, ...rest } = overrides;
  return {
    ahuId: "AHU-01",
    timestamp: new Date(t),
    source: "SIMULATION",
    messageId: `m-${t}`,
    faultCode: null,
    runState: "RUN",
    roomTemp: null,
    supplyTemp: null,
    returnTemp: null,
    humidity: null,
    filterDiffPressure: null,
    fanSpeed: null,
    coilTemp: null,
    damperPosition: null,
    current: null,
    isCurrentFallback: false,
    voltage: null,
    isVoltageFallback: false,
    runHours: null,
    heaterOutput: null,
    ...rest,
  };
}

test("buildReportFromRows: summary, stats with fallback exclusion, buckets, samples page", () => {
  const rows: ReportSampleRow[] = [
    row({ t: T0 + 1_000, supplyTemp: 14, current: 4, isCurrentFallback: true }),
    row({ t: T0 + 2_000, supplyTemp: 16, current: 5 }),
    row({ t: T0 + 3_000, supplyTemp: 18, current: 6, runState: "STOP", fanSpeed: 0 }),
    row({ t: T0 + 4_000, supplyTemp: null, runState: "STOP", fanSpeed: 0 }),
  ];
  const report = buildReportFromRows(
    { ahuId: "AHU-01", from: new Date(T0), to: new Date(T0 + DAY), source: "ALL" },
    { name: "AHU-01", location: "Roof", controlMode: "AUTO", setpoint: 22, commTimeoutSec: 30, installedSensors: ["supplyTemp"] },
    rows,
  );

  equal(report.totalRows, 4);
  equal(report.physicalRows, 0);
  equal(report.simulationRows, 4);
  equal(report.runSamples, 2, "STOP + fanSpeed 0 is not a run sample");
  equal(report.runProportion, 0.5);

  const supply = report.stats.find((s) => s.parameter === "supplyTemp")!;
  equal(supply.count, 3);
  equal(supply.avg, 16);
  equal(supply.min, 14);
  equal(supply.max, 18);
  equal(supply.installed, true);

  const current = report.stats.find((s) => s.parameter === "current")!;
  equal(current.count, 2, "fallback-marked sample excluded");
  equal(current.avg, 5.5);
  equal(current.fallbackCount, 1);

  equal(report.buckets.length, 1, "4-minute span falls in one 5-minute bucket");
  equal(report.buckets[0].count, 4);
  equal(report.buckets[0].runCount, 2);
  equal(report.buckets[0].values.supplyTemp, 16);
  equal(report.buckets[0].values.current, 5.5);

  equal(report.samples.length, 4);
  equal((report.samples[0] as { timestamp: Date }).timestamp.getTime(), T0 + 4_000, "samples newest-first");
  equal(report.bucketLabel, "1-hour interval", "24 h span buckets hourly");

  const paged = buildReportFromRows(
    { ahuId: "AHU-01", from: new Date(T0), to: new Date(T0 + DAY), source: "ALL", sampleLimit: 2 },
    { name: "AHU-01", location: "Roof", controlMode: "AUTO", setpoint: 22, commTimeoutSec: 30, installedSensors: [] },
    rows,
  );
  equal(paged.samples.length, 2, "sample page capped");
  equal((paged.samples[0] as { timestamp: Date }).timestamp.getTime(), T0 + 4_000, "page keeps the newest rows");
});


test("pruneTelemetryShards removes only shards older than the retention window", async () => {
  const db = new InMemoryRtdb();
  const now = T0 + 12 * 3600_000; // Nov 9 12:00 UTC
  await writeTelemetryMirror(db, sample({ messageId: "old-1", timestamp: Date.UTC(2026, 10, 7, 5, 0, 0) }));
  await writeTelemetryMirror(db, sample({ messageId: "edge-1", timestamp: Date.UTC(2026, 10, 8, 5, 0, 0) }));
  await writeTelemetryMirror(db, sample({ messageId: "today-1", timestamp: T0 + 3600_000 }));

  const removed = await pruneTelemetryShards(db, ["AHU-01", "AHU-02"], 1, now, "2026-11-07");
  equal(removed, 1, "only the Nov 7 shard exists and is pruned");
  equal(await db.get("telemetry/AHU-01/2026-11-07"), null, "old shard gone");
  equal(
    (await db.get<RtdbTelemetryRecord>("telemetry/AHU-01/2026-11-08/edge-1"))?.messageId,
    "edge-1",
    "within-window shard kept (record is one level below the shard)",
  );
  equal(
    (await db.get<RtdbTelemetryRecord>("telemetry/AHU-01/2026-11-09/today-1"))?.messageId,
    "today-1",
    "today kept",
  );
  // second sweep is a clean no-op
  equal(await pruneTelemetryShards(db, ["AHU-01", "AHU-02"], 1, now, "2026-11-07"), 0);
});

test("streamTelemetryRangeDescending: newest-first, source filter, bounded chunks", async () => {
  const db = new InMemoryRtdb();
  await writeTelemetryMirror(db, sample({ messageId: "d1-a", timestamp: T0 + 1_000 }));
  await writeTelemetryMirror(db, sample({ messageId: "d1-b", timestamp: T0 + 2_000, source: "PHYSICAL" }));
  await writeTelemetryMirror(db, sample({ messageId: "d2-a", timestamp: T0 + DAY + 3_000 }));
  await writeTelemetryMirror(db, sample({ messageId: "out", timestamp: T0 + 5 * DAY }));

  const chunks: string[][] = [];
  for await (const chunk of streamTelemetryRangeDescending(db, "AHU-01", T0, T0 + 2 * DAY, "ALL", 2)) {
    chunks.push(chunk.map((r) => r.messageId));
  }
  deepStrictEqual(chunks.flat(), ["d2-a", "d1-b", "d1-a"], "newest day first, newest record first");
  deepStrictEqual(chunks.map((c) => c.length), [1, 2], "chunk size respected");

  const physical: string[] = [];
  for await (const chunk of streamTelemetryRangeDescending(db, "AHU-01", T0, T0 + 2 * DAY, "PHYSICAL", 10)) {
    physical.push(...chunk.map((r) => r.messageId));
  }
  deepStrictEqual(physical, ["d1-b"]);
});

test("getSeries reads the RTDB mirror with the authoritative-source approximation", async () => {
  const db = new InMemoryRtdb();
  const base = Date.now();
  await writeTelemetryMirror(db, sample({ messageId: "sim-1", timestamp: base - 120_000, supplyTemp: 10 }));
  await writeTelemetryMirror(db, sample({ messageId: "sim-2", timestamp: base - 60_000, supplyTemp: 11 }));
  await writeTelemetryMirror(db, sample({ messageId: "phys-1", timestamp: base - 30_000, source: "PHYSICAL", supplyTemp: 20 }));

  const rtdbSeries = await getSeries("AHU-01", 5, db);
  deepStrictEqual(rtdbSeries.points.map((p) => p.source), ["PHYSICAL"], "physical presence drops simulation samples");
  equal(rtdbSeries.points[0].supplyTemp, 20);

  const simOnly = await getSeries("AHU-03", 5, db);
  equal(simOnly.points.length, 0);
  equal(simOnly.runProportion, 0);
  deepStrictEqual(simOnly.buckets, []);
});

test("streamReportCsv streams RTDB shards newest-first; empty range emits header", async () => {
  const db = new InMemoryRtdb();
  await writeTelemetryMirror(db, sample({ messageId: "csv-1", timestamp: T0 + 1_000, supplyTemp: 14.5 }));
  await writeTelemetryMirror(db, sample({ messageId: "csv-2", timestamp: T0 + 2_000, supplyTemp: 15.5 }));

  const csv = await readAllCsv(
    streamReportCsv({ ahuId: "AHU-01", from: new Date(T0), to: new Date(T0 + DAY), source: "ALL" }, db),
  );
  const lines = csv.trim().split("\n");
  equal(lines[0].startsWith("timestamp,source,message_id,run_state,fault_code,"), true, "header first");
  equal(lines.length, 3, "header + 2 rows");
  equal(lines[1].includes("csv-2"), true, "newest row first");
  equal(lines[2].includes("csv-1"), true);

  const empty = await readAllCsv(
    streamReportCsv({ ahuId: "AHU-02", from: new Date(T0), to: new Date(T0 + DAY), source: "ALL" }, db),
  );
  equal(empty.trim().split("\n").length, 1, "empty range → header-only");
});
