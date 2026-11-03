import { test } from "node:test";
import { strict as assert } from "node:assert";
import { Pool } from "pg";

import {
  createRateTransaction,
  type RatePool,
} from "../src/db/login-rate-transaction";

// Compile-time compatibility check; this does not connect a pool.
const compatible: (pool: Pool) => RatePool = (pool) => pool;
void compatible;

function fakePool(failAt?: string) {
  const events: string[] = [];

  const releases: (
    | Error
    | boolean
    | undefined
  )[] = [];

  const error = new Error(`private ${failAt}`);

  const client = {
    async query(text: string, values?: unknown[]) {
      events.push(text);

      if (text === failAt) {
        throw error;
      }

      return {
        rows: values ? [{ input: values[0] }] : [],
      };
    },

    release(value?: Error | boolean) {
      releases.push(value);
      events.push("RELEASE");
    },
  };

  const pool: RatePool = {
    async connect() {
      events.push("CONNECT");
      return client;
    },
  };

  return { pool, events, releases, error };
}

test("transaction uses one client and commits before release", async () => {
  const f = fakePool();

  const result = await createRateTransaction(f.pool)(
    async (query) => {
      const first = await query("SELECT 1", ["one"]);
      const second = await query("SELECT 2", ["two"]);

      return [first.rows, second.rows];
    },
  );

  assert.deepEqual(result, [
    [{ input: "one" }],
    [{ input: "two" }],
  ]);

  assert.deepEqual(f.events, [
    "CONNECT",
    "BEGIN",
    "SELECT 1",
    "SELECT 2",
    "COMMIT",
    "RELEASE",
  ]);

  assert.deepEqual(f.releases, [undefined]);
});

test("work failure rolls back and releases the client", async () => {
  const f = fakePool("SELECT 1");

  await assert.rejects(
    createRateTransaction(f.pool)(
      (query) => query("SELECT 1", []),
    ),
    f.error,
  );

  assert.deepEqual(f.events, [
    "CONNECT",
    "BEGIN",
    "SELECT 1",
    "ROLLBACK",
    "RELEASE",
  ]);

  assert.deepEqual(f.releases, [undefined]);
});

test("failed BEGIN discards the connection", async () => {
  const f = fakePool("BEGIN");
  let worked = false;

  await assert.rejects(
    createRateTransaction(f.pool)(async () => {
      worked = true;
    }),
    f.error,
  );

  assert.equal(worked, false);

  assert.deepEqual(f.events, [
    "CONNECT",
    "BEGIN",
    "RELEASE",
  ]);

  assert.deepEqual(f.releases, [true]);
});

test("failed COMMIT attempts rollback and discards the connection", async () => {
  const f = fakePool("COMMIT");

  await assert.rejects(
    createRateTransaction(f.pool)(async () => 123),
    f.error,
  );

  assert.deepEqual(f.events, [
    "CONNECT",
    "BEGIN",
    "COMMIT",
    "ROLLBACK",
    "RELEASE",
  ]);

  assert.deepEqual(f.releases, [true]);
});

test("failed rollback discards the connection while preserving the original error", async () => {
  const f = fakePool("ROLLBACK");
  const original = new Error("work failed");

  await assert.rejects(
    createRateTransaction(f.pool)(async () => {
      throw original;
    }),
    original,
  );

  assert.deepEqual(f.events, [
    "CONNECT",
    "BEGIN",
    "ROLLBACK",
    "RELEASE",
  ]);

  assert.deepEqual(f.releases, [true]);
});

test("connection failure does not call work", async () => {
  const failure = new Error("private connection details");
  let worked = false;

  const pool: RatePool = {
    async connect() {
      throw failure;
    },
  };

  await assert.rejects(
    createRateTransaction(pool)(async () => {
      worked = true;
    }),
    failure,
  );

  assert.equal(worked, false);
});