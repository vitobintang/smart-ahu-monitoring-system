import { randomBytes, timingSafeEqual } from "node:crypto";

function normalizeOrigin(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value === "null" ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#")
  ) {
    return null;
  }

  try {
    const url = new URL(value);

    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

export function isSameOrigin(
  requestOrigin: unknown,
  trustedOrigin: unknown,
): boolean {
  const request = normalizeOrigin(requestOrigin);
  const trusted = normalizeOrigin(trustedOrigin);

  return request !== null && trusted !== null && request === trusted;
}

export function createCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

export function csrfTokensMatch(
  cookieToken: unknown,
  headerToken: unknown,
): boolean {
  if (
    typeof cookieToken !== "string" ||
    typeof headerToken !== "string" ||
    !/^[a-f0-9]{64}$/.test(cookieToken) ||
    !/^[a-f0-9]{64}$/.test(headerToken)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(cookieToken, "hex"),
    Buffer.from(headerToken, "hex"),
  );
}