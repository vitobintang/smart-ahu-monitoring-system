type ParsedValue =
  | { ok: true; value: number | null }
  | { ok: false };

// Syntax validation for fictional inputs only, not equipment safety limits.
export function parseSimulatedValue(input: unknown): ParsedValue {
  if (typeof input !== "string") return { ok: false };

  const text = input.trim();

  if (text === "") {
    return { ok: true, value: null };
  }

  if (
    text.length > 32 ||
    !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)
  ) {
    return { ok: false };
  }

  const value = Number(text);

  return Number.isFinite(value)
    ? { ok: true, value }
    : { ok: false };
}