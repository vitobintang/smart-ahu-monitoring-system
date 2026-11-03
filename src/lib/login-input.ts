// Pure input validation for a future server-side login endpoint. This function
// does not parse a request, authenticate, store credentials, or issue cookies.
export type LoginInput = { email: string; password: string };

export function validateLoginInput(value: unknown): LoginInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.includes("email") || !keys.includes("password")) return null;
  if (typeof input.email !== "string" || typeof input.password !== "string") return null;
  if (
    !input.email || input.email !== input.email.trim() || input.email.length > 320 ||
    /[\x00-\x1f\x7f\s]/u.test(input.email) ||
    !input.password || Buffer.byteLength(input.password, "utf8") > 4096
  ) return null;
  // Do not alter the password or impose a new password policy on existing users.
  return { email: input.email, password: input.password };
}