import { test } from "node:test";
import { strict as assert } from "node:assert";
import { PGlite } from "@electric-sql/pglite";

import {
  createRateTransaction,
  type RatePool,
} from "../src/db/login-rate-transaction";

import { makeLoginRateKey } from "../src/lib/login-rate-key";
import { consumeSharedLoginAttempt } from "../src/lib/shared-login-rate";

test("adapter and existing limiter work together in a temporary local database", async () => {
  const db = new PGlite();

  try {
    await db.exec(`
      CREATE SCHEMA ahu_private;

      CREATE TABLE ahu_private.login_rate_windows (
        bucket_key text PRIMARY KEY,
        attempt_times_ms jsonb NOT NULL,
        last_checked_ms bigint NOT NULL
      );
    `);

    // One local engine, not a real PostgreSQL connection pool.
    const pool: RatePool = {
      async connect() {
        return {
          async query(text: string, values?: unknown[]) {
            const result = await db.query(
              text,
              values ?? [],
            );

            return { rows: result.rows };
          },

          release() {},
        };
      },
    };

    const transaction = createRateTransaction(pool);

    // Dummy test bytes; never use this value as a real secret.
    const testSecret = new Uint8Array(32).fill(7);

    const key = makeLoginRateKey(
      "192.0.2.1",
      testSecret,
    );

    for (let i = 0; i < 10; i++) {
      const result = await consumeSharedLoginAttempt(
        transaction,
        key,
      );

      assert.equal(result.allowed, true);
    }

    const blocked = await consumeSharedLoginAttempt(
      transaction,
      key,
    );

    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterMs > 0);

    const stored = await db.query<{
      bucket_key: string;
      count: number;
    }>(
      `SELECT
         bucket_key,
         jsonb_array_length(attempt_times_ms) AS count
       FROM ahu_private.login_rate_windows`,
    );

    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0].bucket_key, key);
    assert.equal(stored.rows[0].count, 10);

    const aborted = makeLoginRateKey(
      "192.0.2.2",
      testSecret,
    );

    await assert.rejects(
      transaction(async (query) => {
        await query(
          `INSERT INTO ahu_private.login_rate_windows
             (bucket_key, attempt_times_ms, last_checked_ms)
           VALUES ($1, '[]'::jsonb, 0)`,
          [aborted],
        );

        throw new Error("test rollback");
      }),
      /test rollback/,
    );

    const after = await db.query(
      `SELECT bucket_key
       FROM ahu_private.login_rate_windows
       WHERE bucket_key = $1`,
      [aborted],
    );

    assert.equal(after.rows.length, 0);
  } finally {
    await db.close();
  }
});