import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";

import { InMemoryRtdb } from "../src/lib/rtdb/store";
import { auditLogNode, writeRtdbAuditLog, type RtdbAuditRecord } from "../src/lib/rtdb/audit";

const T0 = Date.UTC(2026, 10, 9, 6, 0, 0);

function record(overrides: Partial<RtdbAuditRecord> = {}): RtdbAuditRecord {
  return {
    id: "aud-1",
    userId: "uid-1",
    userEmail: "op@example.invalid",
    action: "COMMAND_REQUESTED",
    entity: "command:cmd-1",
    details: { ahuId: "AHU-01", commandType: "START", transition: "-> REQUESTED" },
    ipAddress: "10.0.0.8",
    createdAt: T0,
    ...overrides,
  };
}

test("writeRtdbAuditLog appends under auditLogs/{id} and is idempotent", async () => {
  const db = new InMemoryRtdb();
  await writeRtdbAuditLog(db, record());
  deepStrictEqual(await db.get(auditLogNode("aud-1")), record());
  await writeRtdbAuditLog(db, record({ action: "COMMAND_ACCEPTED" }));
  equal((await db.get<RtdbAuditRecord>(auditLogNode("aud-1")))?.action, "COMMAND_ACCEPTED");
});

test("entries are independent and details objects survive the round trip", async () => {
  const db = new InMemoryRtdb();
  await writeRtdbAuditLog(db, record());
  await writeRtdbAuditLog(
    db,
    record({
      id: "aud-2",
      action: "LOGIN_SUCCEEDED",
      entity: "user:uid-2",
      userId: "uid-2",
      userEmail: "admin@example.invalid",
      details: { provider: "password" },
      ipAddress: null,
    }),
  );

  equal((await db.get<RtdbAuditRecord>(auditLogNode("aud-1")))?.action, "COMMAND_REQUESTED");
  const second = (await db.get<RtdbAuditRecord>(auditLogNode("aud-2")))!;
  equal(second.action, "LOGIN_SUCCEEDED");
  deepStrictEqual(second.details, { provider: "password" });
  equal(second.ipAddress, null);

  const root = await db.get<Record<string, unknown>>("auditLogs");
  equal(Object.keys(root ?? {}).length, 2);
});

test("system entries (null actor) are representable", async () => {
  const db = new InMemoryRtdb();
  await writeRtdbAuditLog(
    db,
    record({ id: "aud-3", userId: null, userEmail: null, action: "COMMAND_EXPIRED", ipAddress: null }),
  );
  const stored = (await db.get<RtdbAuditRecord>(auditLogNode("aud-3")))!;
  equal(stored.userId, null);
  equal(stored.userEmail, null);
  equal(stored.action, "COMMAND_EXPIRED");
});
