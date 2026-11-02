export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_ATTEMPTS = 10;

export type LoginRateBucket = {
  attemptTimesMs: number[];
  lastCheckedAtMs: number;
};

type RateResult =
  | {
      ok: true;
      allowed: boolean;
      retryAfterMs: number;
      bucket: LoginRateBucket;
    }
  | { ok: false };

// Local model only: production needs a trusted IP and atomic, shared storage.
export function evaluateLoginAttempt(
  nowMs: number,
  previous: LoginRateBucket | null,
): RateResult {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    return { ok: false };
  }

  if (previous !== null) {
    if (
      typeof previous !== "object" ||
      Array.isArray(previous) ||
      !Array.isArray(previous.attemptTimesMs) ||
      previous.attemptTimesMs.length > LOGIN_MAX_ATTEMPTS ||
      !Number.isSafeInteger(previous.lastCheckedAtMs) ||
      previous.lastCheckedAtMs < 0 ||
      previous.lastCheckedAtMs > nowMs
    ) {
      return { ok: false };
    }

    let last = -1;

    for (const time of previous.attemptTimesMs) {
      if (
        !Number.isSafeInteger(time) ||
        time < 0 ||
        time < last ||
        time > previous.lastCheckedAtMs
      ) {
        return { ok: false };
      }

      last = time;
    }
  }

  const active = (previous?.attemptTimesMs ?? []).filter(
    (time) => nowMs - time < LOGIN_WINDOW_MS,
  );

  if (active.length >= LOGIN_MAX_ATTEMPTS) {
    return {
      ok: true,
      allowed: false,
      retryAfterMs: LOGIN_WINDOW_MS - (nowMs - active[0]),
      bucket: { attemptTimesMs: active, lastCheckedAtMs: nowMs },
    };
  }

  return {
    ok: true,
    allowed: true,
    retryAfterMs: 0,
    bucket: {
      attemptTimesMs: [...active, nowMs],
      lastCheckedAtMs: nowMs,
    },
  };
}