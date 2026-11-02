export function getDatabaseUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("DATABASE_URL is required.");
  }

  const raw = value.trim();
  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    !parsed.hostname ||
    !parsed.username ||
    !parsed.pathname ||
    parsed.pathname === "/" ||
    parsed.hash
  ) {
    throw new Error(
      "DATABASE_URL must include a PostgreSQL host, user, and database.",
    );
  }

  const modes = parsed.searchParams.getAll("sslmode");

  if (
    modes.length !== 1 ||
    !["require", "verify-ca", "verify-full"].includes(modes[0]) ||
    parsed.searchParams.has("ssl")
  ) {
    throw new Error("DATABASE_URL must use exactly one secure sslmode.");
  }

  return raw;
}