import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";

import { InMemoryRtdb } from "../src/lib/rtdb/store";
import {
  activeSlotFor,
  applyCommandStatusPatch,
  claimActiveCommand,
  clearActiveCommand,
  commandActiveNode,
  commandNode,
  updateActiveCommandStatus,
  writeRtdbCommand,
  type RtdbCommandRecord,
} from "../src/lib/rtdb/commands";

const T0 = Date.UTC(2026, 10, 9, 4, 0, 0);

function record(overrides: Partial<RtdbCommandRecord> = {}): RtdbCommandRecord {
  return {
    id: "cmd-1",
    ahuId: "AHU-01",
    userId: "uid-1",
    userEmail: "op@example.invalid",
    commandType: "START",
    payload: null,
    status: "REQUESTED",
    rejectionReason: null,
    createdAt: T0,
    updatedAt: T0,
    expiresAt: T0 + 60_000,
    confirmedAt: null,
    ...overrides,
  };
}

test("writeRtdbCommand stores the full record and is idempotent", async () => {
  const db = new InMemoryRtdb();
  await writeRtdbCommand(db, record());
  deepStrictEqual(await db.get(commandNode("cmd-1")), record());
  await writeRtdbCommand(db, record({ status: "ACCEPTED" }));
  equal((await db.get<RtdbCommandRecord>(commandNode("cmd-1")))?.status, "ACCEPTED");
});

test("claimActiveCommand: free slot claims, occupied aborts, expired replaces", async () => {
  const db = new InMemoryRtdb();
  const first = activeSlotFor(record());

  const claim1 = await claimActiveCommand(db, "AHU-01", first, T0 + 1);
  equal(claim1.committed, true, "free AHU claims");

  const second = activeSlotFor(record({ id: "cmd-2", commandType: "STOP" }));
  const claim2 = await claimActiveCommand(db, "AHU-01", second, T0 + 2);
  equal(claim2.committed, false, "second command blocked while slot unexpired");
  equal(((await db.get(commandActiveNode("AHU-01"))) as { commandId: string }).commandId, "cmd-1");

  const claim3 = await claimActiveCommand(db, "AHU-01", second, T0 + 61_000);
  equal(claim3.committed, true, "TTL-passed slot can be replaced");
  equal(((await db.get(commandActiveNode("AHU-01"))) as { commandId: string }).commandId, "cmd-2");
});

test("claimActiveCommand: re-claiming the same command is idempotent", async () => {
  const db = new InMemoryRtdb();
  const slot = activeSlotFor(record());
  equal((await claimActiveCommand(db, "AHU-01", slot, T0 + 1)).committed, true);
  equal((await claimActiveCommand(db, "AHU-01", slot, T0 + 5)).committed, true, "same commandId re-claims");
  equal(((await db.get(commandActiveNode("AHU-01"))) as { commandId: string }).commandId, "cmd-1");
});

test("one-active-per-AHU holds across many contenders", async () => {
  const db = new InMemoryRtdb();
  const winner = activeSlotFor(record({ id: "cmd-winner" }));
  equal((await claimActiveCommand(db, "AHU-01", winner, T0)).committed, true);

  const results = [];
  for (let i = 0; i < 5; i += 1) {
    results.push(
      (await claimActiveCommand(db, "AHU-01", activeSlotFor(record({ id: `cmd-loser-${i}` })), T0 + 1 + i)).committed,
    );
  }
  deepStrictEqual(results, [false, false, false, false, false]);
  equal(((await db.get(commandActiveNode("AHU-01"))) as { commandId: string }).commandId, "cmd-winner");
});

test("slots are namespaced per AHU", async () => {
  const db = new InMemoryRtdb();
  equal((await claimActiveCommand(db, "AHU-01", activeSlotFor(record()), T0)).committed, true);
  equal(
    (await claimActiveCommand(db, "AHU-02", activeSlotFor(record({ id: "cmd-9" })), T0)).committed,
    true,
    "other AHU unaffected",
  );
});

test("updateActiveCommandStatus touches only its own slot", async () => {
  const db = new InMemoryRtdb();
  await claimActiveCommand(db, "AHU-01", activeSlotFor(record()), T0);

  await updateActiveCommandStatus(db, "AHU-01", "cmd-other", "ACCEPTED");
  equal(((await db.get(commandActiveNode("AHU-01"))) as { status: string }).status, "REQUESTED", "foreign no-op");

  await updateActiveCommandStatus(db, "AHU-01", "cmd-1", "ACCEPTED");
  equal(((await db.get(commandActiveNode("AHU-01"))) as { status: string }).status, "ACCEPTED");
});

test("clearActiveCommand removes only the owner's slot", async () => {
  const db = new InMemoryRtdb();
  await claimActiveCommand(db, "AHU-01", activeSlotFor(record()), T0);

  const wrong = await clearActiveCommand(db, "AHU-01", "cmd-other");
  equal(wrong.committed, false, "foreign clear does not commit");
  equal(((await db.get(commandActiveNode("AHU-01"))) as { commandId: string }).commandId, "cmd-1");

  const right = await clearActiveCommand(db, "AHU-01", "cmd-1");
  equal(right.committed, true);
  equal(await db.get(commandActiveNode("AHU-01")), null, "slot freed for the next command");
  equal((await claimActiveCommand(db, "AHU-01", activeSlotFor(record({ id: "cmd-3" })), T0 + 1)).committed, true);
});

test("applyCommandStatusPatch: active statuses keep the slot, terminal ones clear it", async () => {
  const db = new InMemoryRtdb();
  const cmd = record();
  await writeRtdbCommand(db, cmd);
  await claimActiveCommand(db, cmd.ahuId, activeSlotFor(cmd), T0);

  await applyCommandStatusPatch(db, { id: "cmd-1", ahuId: "AHU-01", status: "ACCEPTED", updatedAt: T0 + 5 });
  equal(((await db.get(commandActiveNode("AHU-01"))) as { status: string }).status, "ACCEPTED");
  equal((await db.get<Record<string, unknown>>(commandNode("cmd-1")))?.status, "ACCEPTED");

  await applyCommandStatusPatch(db, {
    id: "cmd-1",
    ahuId: "AHU-01",
    status: "SUCCEEDED",
    updatedAt: T0 + 10,
    confirmedAt: T0 + 9,
  });
  equal(await db.get(commandActiveNode("AHU-01")), null, "terminal status frees the slot");
  const stored = await db.get<Record<string, unknown>>(commandNode("cmd-1"));
  equal(stored?.status, "SUCCEEDED");
  equal(stored?.confirmedAt, T0 + 9);
});

test("applyCommandStatusPatch records rejection reasons (FAILED/EXPIRED)", async () => {
  const db = new InMemoryRtdb();
  await writeRtdbCommand(db, record());
  await applyCommandStatusPatch(db, {
    id: "cmd-1",
    ahuId: "AHU-01",
    status: "EXPIRED",
    updatedAt: T0 + 61_000,
    rejectionReason: "TTL 60 s elapsed without controller confirmation",
  });
  const stored = await db.get<Record<string, unknown>>(commandNode("cmd-1"));
  equal(stored?.status, "EXPIRED");
  equal(stored?.rejectionReason, "TTL 60 s elapsed without controller confirmation");
});
