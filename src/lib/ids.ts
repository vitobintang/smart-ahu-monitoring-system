/**
 * Runtime-agnostic ID and token helpers built on Web Crypto so they work in
 * both Node.js and Edge runtimes without bundler warnings.
 */

/** UUID v4 for primary keys (alarms, commands, audit entries, invitations). */
export function randomId(): string {
  return globalThis.crypto.randomUUID();
}

/** Cryptographically random lowercase hex string, e.g. for CSRF/device tokens. */
export function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  let out = "";
  for (const b of arr) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Constant-time string comparison (e.g. CSRF double-submit verification). */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ea = enc.encode(a);
  const eb = enc.encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i += 1) diff |= ea[i] ^ eb[i];
  return diff === 0;
}