import { test } from "node:test";
import {
  deepStrictEqual,
  equal,
  ok,
  rejects,
} from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

import { checkLoginPreflight } from "../src/lib/login-preflight";
import { LOGIN_WINDOW_MS } from "../src/lib/login-rate-model";
import {
  consumeSharedLoginAttempt,
  type RateTransaction,
} from "../src/lib/shared-login-rate";

test("shared login limiter on a temporary database", async (t) => {
  const db = new PGlite();
  const key = "a".repeat(64);
  const otherKey = "b".repeat(64);

  const transaction: RateTransaction = (work) =>
    db.transaction((tx) =>
      work((text, values) => tx.query(text, values)),
    );

  try {
    // This table exists only in the temporary test database.
    await db.exec(`
      CREATE SCHEMA ahu_private;

      CREATE TABLE ahu_private.login_rate_windows (
        bucket_key text PRIMARY KEY,
        attempt_times_ms jsonb NOT NULL,
        last_checked_ms bigint NOT NULL
      );
    `);

    await t.test("ten attempts are allowed and the eleventh is blocked", async () => {
      for (let i = 0; i < 10; i++) {
        const decision = await consumeSharedLoginAttempt(
          transaction,
          key,
        );

        equal(decision.allowed, true);
        equal(decision.retryAfterMs, 0);
      }

      const blocked = await consumeSharedLoginAttempt(transaction, key);

      equal(blocked.allowed, false);
      ok(
        blocked.retryAfterMs > 0 &&
        blocked.retryAfterMs <= LOGIN_WINDOW_MS,
      );

      const row = await db.query<{ attempt_times_ms: number[] }>(
        `SELECT attempt_times_ms
         FROM ahu_private.login_rate_windows
         WHERE bucket_key = $1`,
        [key],
      );

      equal(row.rows[0].attempt_times_ms.length, 10);
    });

    await t.test("different keys remain independent", async () => {
      const decision = await consumeSharedLoginAttempt(
        transaction,
        otherKey,
      );

      equal(decision.allowed, true);
    });

    await t.test("simultaneous calls on one local engine do not admit more than ten", async () => {
      const another = "c".repeat(64);

      const decisions = await Promise.all(
        Array.from(
          { length: 20 },
          () => consumeSharedLoginAttempt(transaction, another),
        ),
      );

      equal(decisions.filter((item) => item.allowed).length, 10);
      equal(decisions.filter((item) => !item.allowed).length, 10);
    });

    await t.test("expired attempts are removed", async () => {
      const another = "d".repeat(64);

      const clock = await db.query<{ now_ms: string }>(
        `SELECT floor(
           extract(epoch FROM clock_timestamp()) * 1000
         )::bigint::text AS now_ms`,
      );

      const now = Number(clock.rows[0].now_ms);

      await db.query(
        `INSERT INTO ahu_private.login_rate_windows
         VALUES ($1, $2::jsonb, $3::bigint)`,
        [
          another,
          JSON.stringify(
            Array(10).fill(now - LOGIN_WINDOW_MS - 1000),
          ),
          now,
        ],
      );

      const decision = await consumeSharedLoginAttempt(
        transaction,
        another,
      );

      equal(decision.allowed, true);

      const row = await db.query<{ attempt_times_ms: number[] }>(
        `SELECT attempt_times_ms
         FROM ahu_private.login_rate_windows
         WHERE bucket_key = $1`,
        [another],
      );

      equal(row.rows[0].attempt_times_ms.length, 1);
    });

    await t.test("invalid stored state fails without resetting it", async () => {
      const another = "e".repeat(64);

      await db.query(
        `INSERT INTO ahu_private.login_rate_windows
         VALUES ($1, $2::jsonb, 0)`,
        [another, JSON.stringify(["bad"])],
      );

      await rejects(consumeSharedLoginAttempt(transaction, another));

      const row = await db.query<{ attempt_times_ms: unknown }>(
        `SELECT attempt_times_ms
         FROM ahu_private.login_rate_windows
         WHERE bucket_key = $1`,
        [another],
      );

      deepStrictEqual(row.rows[0].attempt_times_ms, ["bad"]);
    });

    await t.test("failed writes roll the transaction back", async () => {
      const another = "f".repeat(64);

      const failing: RateTransaction = (work) =>
        db.transaction((tx) =>
          work((text, values) => {
            if (text.trimStart().startsWith("UPDATE")) {
              throw new Error("fictional failure");
            }

            return tx.query(text, values);
          }),
        );

      await rejects(consumeSharedLoginAttempt(failing, another));

      const result = await db.query(
        `SELECT bucket_key
         FROM ahu_private.login_rate_windows
         WHERE bucket_key = $1`,
        [another],
      );

      equal(result.rows.length, 0);
    });

    await t.test("preflight maps blocked and unavailable rate storage safely", async () => {
      const another = "1".repeat(64);
      const consume = () =>
        consumeSharedLoginAttempt(transaction, another);

      for (let i = 0; i < 10; i++) {
        deepStrictEqual(
          await checkLoginPreflight(
            "https://ahu.example",
            "https://ahu.example",
            consume,
          ),
          { ok: true },
        );
      }

      const limited = await checkLoginPreflight(
        "https://ahu.example",
        "https://ahu.example",
        consume,
      );

      if (limited.ok === true) {
        throw new Error("Expected rate limit");
      }

      equal(limited.status, 429);
      ok((limited.retryAfterSeconds ?? 0) > 0);

      const unavailable = await checkLoginPreflight(
        "https://ahu.example",
        "https://ahu.example",
        () => Promise.reject(new Error("private detail")),
      );

      deepStrictEqual(unavailable, { ok: false, status: 503 });

      let calls = 0;

      const origin = await checkLoginPreflight(
        "https://other.example",
        "https://ahu.example",
        async () => {
          calls++;
          return consume();
        },
      );

      deepStrictEqual(origin, { ok: false, status: 403 });
      equal(calls, 0);
    });

    await t.test("invalid keys fail before opening a transaction", async () => {
      let calls = 0;

      const counted: RateTransaction = (work) => {
        calls++;
        return transaction(work);
      };

      await rejects(consumeSharedLoginAttempt(counted, "not-a-key"));
      equal(calls, 0);
    });
  } finally {
    await db.close();
  }
});