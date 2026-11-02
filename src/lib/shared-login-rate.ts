import {
  evaluateLoginAttempt,
  type LoginRateBucket,
} from "./login-rate-model";

export type RateQuery = (
  text: string,
  values: unknown[],
) => Promise<{ rows: unknown[] }>;

export type RateTransaction = <T>(
  work: (query: RateQuery) => Promise<T>,
) => Promise<T>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMs(value: unknown): number {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(value)
  ) {
    throw new Error("Invalid rate time");
  }

  const time = Number(value);

  if (!Number.isSafeInteger(time)) {
    throw new Error("Invalid rate time");
  }

  return time;
}

// Requires a genuine DB transaction with row locking.
// The key must come from a trusted client identity; this helper does not
// identify an IP. It is not connected to login and does not create its table.
export async function consumeSharedLoginAttempt(
  transaction: RateTransaction,
  bucketKey: string,
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  if (
    typeof bucketKey !== "string" ||
    !/^[0-9a-f]{64}$/.test(bucketKey)
  ) {
    throw new Error("Invalid rate key");
  }

  return transaction(async (query) => {
    await query(
      `INSERT INTO ahu_private.login_rate_windows
         (bucket_key, attempt_times_ms, last_checked_ms)
       VALUES ($1, '[]'::jsonb, 0)
       ON CONFLICT (bucket_key) DO NOTHING`,
      [bucketKey],
    );

    const locked = await query(
      `SELECT attempt_times_ms, last_checked_ms::text AS last_checked_ms
       FROM ahu_private.login_rate_windows
       WHERE bucket_key = $1
       FOR UPDATE`,
      [bucketKey],
    );

    if (
      locked.rows.length !== 1 ||
      !isRecord(locked.rows[0])
    ) {
      throw new Error("Invalid rate state");
    }

    const row = locked.rows[0];

    if (!Array.isArray(row.attempt_times_ms)) {
      throw new Error("Invalid rate state");
    }

    const bucket: LoginRateBucket = {
      attemptTimesMs: row.attempt_times_ms as number[],
      lastCheckedAtMs: parseMs(row.last_checked_ms),
    };

    // Read the database clock after obtaining the row lock.
    const clock = await query(
      `SELECT floor(
         extract(epoch FROM clock_timestamp()) * 1000
       )::bigint::text AS now_ms`,
      [],
    );

    if (
      clock.rows.length !== 1 ||
      !isRecord(clock.rows[0])
    ) {
      throw new Error("Invalid rate clock");
    }

    const now = parseMs(clock.rows[0].now_ms);
    const result = evaluateLoginAttempt(now, bucket);

    if (result.ok === false) {
      throw new Error("Invalid rate state");
    }

    const updated = await query(
      `UPDATE ahu_private.login_rate_windows
       SET attempt_times_ms = $2::jsonb,
           last_checked_ms = $3::bigint
       WHERE bucket_key = $1
       RETURNING bucket_key`,
      [
        bucketKey,
        JSON.stringify(result.bucket.attemptTimesMs),
        result.bucket.lastCheckedAtMs,
      ],
    );

    if (updated.rows.length !== 1) {
      throw new Error("Rate update failed");
    }

    return {
      allowed: result.allowed,
      retryAfterMs: result.retryAfterMs,
    };
  });
}