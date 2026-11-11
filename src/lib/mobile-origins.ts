export const DEFAULT_MOBILE_ORIGINS = [
  "capacitor://localhost",
  "https://localhost",
  "http://localhost",
] as const;

/** Exact-origin allowlist for native WebViews; never use a wildcard with auth APIs. */
export function isAllowedMobileOrigin(
  origin: string | null | undefined,
  configuredOrigins = process.env.MOBILE_APP_ORIGINS ?? "",
): origin is string {
  if (!origin) return false;
  const configured = configuredOrigins
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (process.env.NODE_ENV !== "production" && origin === "http://localhost:5173") return true;
  return [...DEFAULT_MOBILE_ORIGINS, ...configured].includes(origin);
}
