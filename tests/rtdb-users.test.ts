import { test } from "node:test";
import { deepStrictEqual, equal, rejects } from "node:assert/strict";

import { InMemoryRtdb } from "../src/lib/rtdb/store";
import {
  createRtdbUser,
  deleteRtdbUser,
  emailKey,
  getRtdbUserByEmail,
  getRtdbUserById,
  getRtdbUserByUsername,
  EmailTakenError,
  UsernameTakenError,
  updateRtdbUserRole,
} from "../src/lib/rtdb/users";

test("createRtdbUser claims username + email mirrors transactionally and blocks duplicates", async () => {
  const db = new InMemoryRtdb();
  const created = await createRtdbUser(db, {
    uid: "uid-1",
    email: "Vizo@Example.invalid",
    username: "vizo",
    fullName: "Budi Santoso",
    role: "Admin",
  });

  equal(created.id, "uid-1");
  equal(created.email, "vizo@example.invalid");
  equal(created.role, "Admin");
  equal(created.fullName, "Budi Santoso");

  deepStrictEqual(await db.get("usernames/vizo"), "uid-1");
  deepStrictEqual(await db.get(`emails/${emailKey("vizo@example.invalid")}`), "uid-1");
  deepStrictEqual(await getRtdbUserById(db, "uid-1"), created);
  deepStrictEqual(await getRtdbUserByUsername(db, "VIZO"), created);
  deepStrictEqual(await getRtdbUserByEmail(db, "VIZO@EXAMPLE.INVALID"), created);

  await rejects(
    createRtdbUser(db, { uid: "uid-2", email: "other@example.invalid", username: "vizo", role: "Operator" }),
    UsernameTakenError,
  );
  await rejects(
    createRtdbUser(db, { uid: "uid-2", email: "vizo@example.invalid", username: "other", role: "Operator" }),
    EmailTakenError,
  );

  // Failed claims must leave no residue: username-2 free, email mirror untouched.
  deepStrictEqual(await db.get("users/uid-2"), null);
  await rejects(
    createRtdbUser(db, { uid: "uid-2", email: "third@example.invalid", username: "vizo", role: "Viewer" as never }),
    UsernameTakenError,
  );
  const operator = await createRtdbUser(db, { uid: "uid-2", email: "other@example.invalid", username: "other", role: "Operator" });
  equal(operator.role, "Operator");
});

test("updateRtdbUserRole and deleteRtdbUser keep the record and its mirrors consistent", async () => {
  const db = new InMemoryRtdb();
  await createRtdbUser(db, { uid: "uid-1", email: "u1@example.invalid", username: "user-one", role: "Operator" });

  const updated = await updateRtdbUserRole(db, "uid-1", "Engineering");
  equal(updated?.role, "Engineering");
  equal((await getRtdbUserById(db, "uid-1"))?.role, "Engineering");
  equal(await updateRtdbUserRole(db, "missing", "Admin"), null);

  await deleteRtdbUser(db, "uid-1");
  equal(await getRtdbUserById(db, "uid-1"), null);
  equal(await db.get("usernames/user-one"), null);
  equal(await db.get(`emails/${emailKey("u1@example.invalid")}`), null);
  equal(await deleteRtdbUser(db, "uid-1"), undefined);
});

test("InMemoryRtdb mirrors nested set/update/remove/get and invalid-path guards", async () => {
  const db = new InMemoryRtdb();
  await db.set("telemetry/AHU-01/2026-11-09/msg-1", { roomTemp: 22.4, runState: "RUN" });
  deepStrictEqual(await db.get("telemetry/AHU-01/2026-11-09/msg-1"), { roomTemp: 22.4, runState: "RUN" });
  await db.update("telemetry/AHU-01/2026-11-09/msg-1", { roomTemp: 23.1 });
  equal((await db.get<{ roomTemp: number }>("telemetry/AHU-01/2026-11-09/msg-1"))?.roomTemp, 23.1);
  await db.remove("telemetry/AHU-01/2026-11-09/msg-1");
  equal(await db.get("telemetry/AHU-01/2026-11-09/msg-1"), null);
  equal(await db.get("missing/path"), null);

  const claimed = await db.transaction<string>("usernames/x", (current) => (current === null ? "uid-1" : undefined));
  equal(claimed.committed, true);
  const blocked = await db.transaction<string>("usernames/x", (current) => (current === null ? "uid-2" : undefined));
  equal(blocked.committed, false);
  deepStrictEqual(blocked.value, "uid-1");

  await rejects(() => db.get("bad/key$with#reserved"), /Invalid RTDB path/);
});
