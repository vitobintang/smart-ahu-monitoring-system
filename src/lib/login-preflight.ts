import { isSameOrigin } from "./request-security";

export type LoginPreflightResult =
  | { ok: true }
  | { ok: false; status: 403 | 429 | 503; retryAfterSeconds?: number };

// The caller must supply a trusted configured origin and a shared, atomic
// per-IP attempt consumer. This helper does not authenticate anyone.
export async function checkLoginPreflight(
  requestOrigin: unknown,
  trustedOrigin: unknown,
  consumeAttempt: () => Promise<unknown>,
): Promise<LoginPreflightResult> {
  if (!isSameOrigin(requestOrigin, trustedOrigin)) {
    return { ok: false, status: 403 };
  }

  try {
    const decision = await consumeAttempt();

    if (
      typeof decision !== "object" ||
      decision === null ||
      Array.isArray(decision)
    ) {
      return { ok: false, status: 503 };
    }

    const rate = decision as Record<string, unknown>;

    if (
      typeof rate.allowed !== "boolean" ||
      typeof rate.retryAfterMs !== "number" ||
      !Number.isSafeInteger(rate.retryAfterMs) ||
      rate.retryAfterMs < 0 ||
      (rate.allowed && rate.retryAfterMs !== 0) ||
      (!rate.allowed && rate.retryAfterMs === 0)
    ) {
      return { ok: false, status: 503 };
    }

    if (!rate.allowed) {
      return {
        ok: false,
        status: 429,
        retryAfterSeconds: Math.ceil(rate.retryAfterMs / 1000),
      };
    }

    return { ok: true };
  } catch {
    return { ok: false, status: 503 };
  }
}