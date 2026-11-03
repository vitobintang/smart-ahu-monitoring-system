// UNWIRED. Call only after the gateway, password, profile, and browser checks.
// This builds a response but does not expose a route or prove cookie delivery.
// Old non-root/domain-scoped cookies cannot be reliably discovered from a
// Cookie header. Review deployment, refresh and logout before enabling login.
const MAX_AGE = 400 * 24 * 60 * 60;
const DEVICE_MAX_AGE = 90 * 24 * 60 * 60;
const COOKIE_ATTRS = "Path=/; HttpOnly; Secure; SameSite=Lax";

type Cookie = { name: string; value: string; options: Record<string, unknown> };

function cookieBase(projectUrl: unknown): string | null {
  if (typeof projectUrl !== "string" || projectUrl !== projectUrl.trim()) return null;
  try {
    const url = new URL(projectUrl);
    const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
    if (!match || url.protocol !== "https:" || url.username || url.password || url.port ||
        url.pathname !== "/" || url.search || url.hash) return null;
    return `sb-${match[1]}-auth-token`;
  } catch { return null; }
}

function isChunkName(name: string, base: string): boolean {
  if (name === base) return true;
  if (!name.startsWith(base + ".")) return false;
  const suffix = name.slice(base.length + 1);
  return /^(0|[1-9][0-9]?)$/.test(suffix) && Number(suffix) < 16;
}

function existingAuthNames(header: unknown, base: string): Set<string> | null {
  if (header === null) return new Set();
  if (typeof header !== "string" || header.length > 8192) return null;
  const names = new Set<string>();
  let deviceSeen = false;
  for (const part of header.split(";")) {
    const entry = part.trim();
    if (!entry) continue;
    const index = entry.indexOf("=");
    if (index < 1) return null;
    const name = entry.slice(0, index).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) return null;
    if (name === "ahu_device") { if (deviceSeen) return null; deviceSeen = true; }
    if (name === base || name.startsWith(base + ".")) {
      if (!isChunkName(name, base) || names.has(name)) return null;
      names.add(name);
    }
  }
  return names;
}

// session is secret. Never log it or serialize it into the response body.
// Untrusted/malformed input returns null without publishing any cookies.
export function buildStagedCookieResponse(
  projectUrl: unknown,
  incomingCookieHeader: unknown,
  session: unknown,
  mode: "login" | "enrollment",
  deviceToken?: unknown,
): Response | null {
  try {
    const base = cookieBase(projectUrl);
    if (!base || (mode !== "login" && mode !== "enrollment")) return null;
    if (mode === "enrollment" && (typeof deviceToken !== "string" || !/^[a-f0-9]{64}$/.test(deviceToken))) return null;
    if (mode === "login" && deviceToken !== undefined) return null;
    const existing = existingAuthNames(incomingCookieHeader, base);
    if (!existing || typeof session !== "object" || session === null || Array.isArray(session)) return null;
    const cookies = (session as { cookies?: unknown }).cookies;
    if (!Array.isArray(cookies) || cookies.length < 1 || cookies.length > 8) return null;
    const staged = new Map<string, Cookie>();
    for (const item of cookies) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
      const cookie = item as Cookie;
      if (typeof cookie.name !== "string" || !isChunkName(cookie.name, base) || staged.has(cookie.name) ||
          typeof cookie.value !== "string" || cookie.value.length < 1 || cookie.value.length > 4096 ||
          !/^[A-Za-z0-9_~-]+$/.test(cookie.value) || typeof cookie.options !== "object" ||
          cookie.options === null || Array.isArray(cookie.options)) return null;
      const o = cookie.options;
      if (o.httpOnly !== true || o.secure !== true || o.sameSite !== "lax" || o.path !== "/" ||
          o.domain !== undefined || !Number.isSafeInteger(o.maxAge) || (o.maxAge as number) < 1 ||
          (o.maxAge as number) > MAX_AGE || o.expires !== undefined || o.partitioned !== undefined) return null;
      staged.set(cookie.name, cookie);
    }
    // The SDK emits either an unchunked cookie or contiguous chunks from .0.
    if (staged.has(base) && staged.size !== 1) return null;
    if (!staged.has(base)) for (let i = 0; i < staged.size; i++) if (!staged.has(`${base}.${i}`)) return null;
    const headers = new Headers({ "Cache-Control": "private, no-store", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff", "Vary": "Cookie" });
    for (const oldName of existing) if (!staged.has(oldName)) headers.append("Set-Cookie", `${oldName}=; ${COOKIE_ATTRS}; Max-Age=0`);
    for (const cookie of staged.values()) headers.append("Set-Cookie", `${cookie.name}=${cookie.value}; ${COOKIE_ATTRS}; Max-Age=${cookie.options.maxAge}`);
    if (mode === "enrollment") headers.append("Set-Cookie", `ahu_device=${deviceToken}; ${COOKIE_ATTRS}; Max-Age=${DEVICE_MAX_AGE}`);
    return Response.json({ ok: true }, { status: 200, headers });
  } catch { return null; }
}
