export function getSupabaseConfig(
  urlValue: string | undefined,
  keyValue: string | undefined,
) {
  const url = urlValue?.trim();
  const publishableKey = keyValue?.trim();

  if (!url || !publishableKey) {
    throw new Error("Supabase URL and publishable key are required.");
  }

  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Supabase URL must be a valid HTTPS URL.");
  }

  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(
      "Supabase URL must be a valid HTTPS URL without credentials.",
    );
  }

  if (publishableKey.startsWith("sb_secret_")) {
    throw new Error("Use a publishable key, not a Supabase secret key.");
  }

  return { url, publishableKey };
}