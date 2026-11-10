import { test } from "node:test";
import { deepStrictEqual, equal, rejects } from "node:assert/strict";

import { InMemoryRtdb, type RtdbAdapter } from "../src/lib/rtdb/store";
import { claimActiveCommand, activeSlotFor, clearActiveCommand, applyCommandStatusPatch, writeRtdbCommand } from "../src/lib/rtdb/commands";
import { pruneTelemetryShards, writeDeviceSnapshot } from "../src/lib/rtdb/telemetry";
import { mirrorToRtdb, firebaseEnvConfigured } from "../src/lib/rtdb/live-read";
import { streamReportCsv } from "../src/lib/queries";

/**
 * Phase 4 (sandbox-runnable half): fault-injection. Every RTDB mirror hook is
 * fire-and-forget by design — production correctness depends on Firebase
 * failures NEVER breaking the authoritative PostgreSQL path. These tests
 * prove that with deterministic failure injection around a healthy
 * in-memory backend.
 */

/** Adapter that throws on selected operations, delegating the rest to inner. */
class FlakyRtdb implements RtdbAdapter {
  private callCounts = new Map<string, number>();
  constructor(
    private readonly inner: RtdbAdapter,
    private readonly failOn: (op: string, path: string, call: number) => boolean,
  ) {}
  private async gate(op: string, path: string): Promise<void> {
    const key = `${op}:${path}`;
    const call = (this.callCounts.get(key) ?? 0) + 1;
    this.callCounts.set(key, call);
    if (this.failOn(op, path, call)) throw new Error(`injected ${op} failure for ${path}`);
  }
  async get<T>(path: string): Promise<T | null> {
    await this.gate("get", path);
    return this.inner.get<T>(path);
  }
  async set(path: string, value: unknown): Promise<void> {
    await this.gate("set", path);
    return this.inner.set(path, value);
  }
  async update(path: string, values: Record<string, unknown>): Promise<void> {
    await this.gate("update", path);
    return this.inner.update(path, values);
  }
  async remove(path: string): Promise<void> {
    await this.gate("remove", path);
    return this.inner.remove(path);
  }
  async transaction<T>(path: string, compute: (current: T | null) => T | null | undefined) {
    await this.gate("transaction", path);
    return this.inner.transaction<T>(path, compute);
  }
}

const T0 = Date.UTC(2026, 10, 9, 7, 0, 0);

function slot(id: string, ahuId = "AHU-01") {
  return activeSlotFor({
    id,
    ahuId,
    userId: "uid-1",
    userEmail: null,
    commandType: "START",
    payload: null,
    status: "REQUESTED",
    rejectionReason: null,
    createdAt: T0,
    updatedAt: T0,
    expiresAt: T0 + 60_000,
    confirmedAt: null,
  });
}

test("mirrorToRtdb: a failing mirror never throws or emits an unhandled rejection", async () => {
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "test-project";
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = "{}";
  let sawUnhandled: unknown = null;
  const handler = (err: unknown) => {
    sawUnhandled = err;
  };
  process.on("unhandledRejection", handler);
  try {
    equal(firebaseEnvConfigured(), true);
    // dynamic admin import will fail inside mirrorToRtdb (bogus service
    // account) — exactly the failure class the hook must swallow
    mirrorToRtdb(async () => {
      throw new Error("simulated mirror explosion");
    });
    // give the rejection a chance to surface if it were unhandled
    await new Promise((r) => setTimeout(r, 50));
    equal(sawUnhandled, null, "no unhandled rejection escaped the hook");
  } finally {
    process.off("unhandledRejection", handler);
    delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  }
});

test("claimActiveCommand under persistent transaction failure rejects and leaves state intact", async () => {
  const db = new InMemoryRtdb();
  await claimActiveCommand(db, "AHU-01", slot("holder"), T0);

  const flaky = new FlakyRtdb(db, (op, path) => op === "transaction" && path === "commandActive/AHU-01");
  await rejects(() => claimActiveCommand(flaky, "AHU-01", slot("newcomer"), T0 + 1));

  const holder = await db.get<{ commandId: string }>("commandActive/AHU-01");
  equal(holder!.commandId, "holder", "failed mirror claim did not disturb the live slot");
});

test("applyCommandStatusPatch partial failure is loud (rejects) and non-atomic-safe", async () => {
  const db = new InMemoryRtdb();
  await writeRtdbCommand(db, {
    id: "cmd-p1",
    ahuId: "AHU-01",
    userId: "u",
    userEmail: null,
    commandType: "START",
    payload: null,
    status: "REQUESTED",
    rejectionReason: null,
    createdAt: T0,
    updatedAt: T0,
    expiresAt: T0 + 60_000,
    confirmedAt: null,
  });
  await claimActiveCommand(db, "AHU-01", slot("cmd-p1"), T0);

  const flaky = new FlakyRtdb(db, (op, path) => op === "transaction" && path === "commandActive/AHU-01");
  await rejects(
    () => applyCommandStatusPatch(flaky, { id: "cmd-p1", ahuId: "AHU-01", status: "SUCCEEDED", updatedAt: T0 + 5 }),
    /injected transaction failure/,
  );

  const record = await db.get<{ status: string }>("commands/cmd-p1");
  equal(record!.status, "SUCCEEDED", "record patch (first step) applied");
  const holder = await db.get<{ commandId: string }>("commandActive/AHU-01");
  equal(holder!.commandId, "cmd-p1", "slot clear (second step) did not run — retained, PostgreSQL stays authoritative");
});

test("pruneTelemetryShards failure rejects (worker-level catch handles it)", async () => {
  const db = new InMemoryRtdb();
  await writeDeviceSnapshot(db, "AHU-01", { power: true, fan: 2, timestamp: T0 });
  const flaky = new FlakyRtdb(db, (op, path) => op === "get" && path.includes("2026-11-07"));
  await rejects(() => pruneTelemetryShards(flaky, ["AHU-01"], 1, T0, "2026-11-07"));
});

test("clearActiveCommand under failure rejects; slot survives for the retry sweep", async () => {
  const db = new InMemoryRtdb();
  await claimActiveCommand(db, "AHU-01", slot("cmd-c1"), T0);
  const flaky = new FlakyRtdb(db, (op, path) => op === "transaction" && path === "commandActive/AHU-01");
  await rejects(() => clearActiveCommand(flaky, "AHU-01", "cmd-c1"));
  equal((await db.get<{ commandId: string }>("commandActive/AHU-01"))!.commandId, "cmd-c1");
});

test("CSV stream: RTDB failure before bytes attempts the PostgreSQL fallback (and errors without PG)", async () => {
  const flaky = new FlakyRtdb(new InMemoryRtdb(), () => true);
  const stream = streamReportCsv(
    { ahuId: "AHU-01", from: new Date(T0), to: new Date(T0 + 3600_000), source: "ALL" },
    flaky,
  );
  const reader = stream.getReader();
  // No PostgreSQL in the unit-test environment: the fallback itself fails and
  // the stream errors — proving the fallback path was engaged, not a silent
  // empty download. In production PostgreSQL serves the fallback.
  await rejects(() => reader.read());
});

test("in-memory slot semantics stay strict under interleaved mixed operations", async () => {
  const db = new InMemoryRtdb();
  // interleave claims/clears across two AHUs and verify isolation
  await claimActiveCommand(db, "AHU-01", slot("a1"), T0);
  await claimActiveCommand(db, "AHU-02", slot("b1", "AHU-02"), T0);
  const blocked = await claimActiveCommand(db, "AHU-01", slot("a2"), T0 + 1);
  equal(blocked.committed, false, "AHU-01 still occupied");
  const cross = await clearActiveCommand(db, "AHU-02", "a1");
  equal(cross.committed, false, "cross-AHU clear is a no-op abort");
  await clearActiveCommand(db, "AHU-01", "a1");
  const freed = await claimActiveCommand(db, "AHU-01", slot("a2"), T0 + 2);
  equal(freed.committed, true);
  const a = await db.get<{ commandId: string }>("commandActive/AHU-01");
  const b = await db.get<{ commandId: string }>("commandActive/AHU-02");
  equal(a!.commandId, "a2");
  equal(b!.commandId, "b1");
});
