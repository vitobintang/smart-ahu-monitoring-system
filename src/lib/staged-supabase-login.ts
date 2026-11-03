import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { LoginInput } from "./login-input";
import type { StagedLogin } from "./login-orchestrator";
import { getSupabaseConfig } from "./supabase/config";

export type StagedAuthCookie = { name: string; value: string; options: CookieOptions };
export type StagedAuthSession = { cookies: StagedAuthCookie[] };

// UNWIRED. No request cookies are read and no response cookies are written.
// Failed/discarded sessions are locally revoked best-effort, not guaranteed:
// an already issued access token can remain valid until expiration.
// Before use, implement stale-cookie cleanup, secure publication and refresh,
// independent downstream authorization, infrastructure timeouts, and verified gateway isolation.
export async function stageSupabasePassword(
  input: LoginInput,
  options: { url: string; publishableKey: string; fetch?: typeof fetch },
): Promise<StagedLogin<StagedAuthSession> | null> {
  const config = getSupabaseConfig(options.url, options.publishableKey);
  const url = new URL(config.url);
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid auth configuration");

  // Accept modern publishable keys or legacy JWTs explicitly identifying anon.
  // The JWT is not verified here; Supabase verifies its signature server-side.
  let acceptable = /^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey);
  if (!acceptable) {
    try {
      const parts = config.publishableKey.split(".");
      if (parts.length === 3 && parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) {
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
        acceptable = payload !== null && typeof payload === "object" && payload.role === "anon";
      }
    } catch { /* invalid key */ }
  }
  if (!acceptable) throw new Error("Invalid auth configuration");

  // Each auth HTTP call has a deadline. The gateway and hosting platform must
  // still enforce their own independent network and request limits.
  const underlyingFetch = options.fetch ?? fetch;
  const boundedFetch: typeof fetch = (target, init) => {
    const timeout = AbortSignal.timeout(10000);
    const existing = init?.signal ?? (target instanceof Request ? target.signal : undefined);
    const signal = existing ? AbortSignal.any([existing, timeout]) : timeout;
    return underlyingFetch(target, { ...init, signal });
  };
  let staged: StagedAuthCookie[] = [];
  const client = createServerClient(config.url, config.publishableKey, {
    global: { fetch: boundedFetch },
    cookieOptions: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => [],
      setAll(items) {
        staged = items.map(({ name, value, options }) => ({ name, value, options: { ...options } }));
      },
    },
  });
  let finished = false;
  let mayHaveSession = false;
  async function discard(): Promise<void> {
    if (finished) return;
    finished = true;
    try {
      if (mayHaveSession) {
        const { error } = await client.auth.signOut({ scope: "local" });
        if (error) throw new Error("Session cleanup failed");
      }
    } finally { staged = []; }
  }
  try {
    const { data, error } = await client.auth.signInWithPassword(input);
    mayHaveSession = Boolean(data.session);
    if (error) {
      if (mayHaveSession) await discard();
      if (error.status === 400 || error.status === 401) return null;
      throw new Error("Authentication unavailable");
    }
    if (!data.user?.id || !data.session?.access_token ||
        data.session.user?.id !== data.user.id) {
      await discard();
      throw new Error("Authentication unavailable");
    }
    const verified = await client.auth.getUser(data.session.access_token);
    if (verified.error || verified.data.user?.id !== data.user.id) {
      await discard();
      throw new Error("Authentication unavailable");
    }
    if (staged.length < 1 || staged.length > 8 ||
        staged.some((cookie) => !cookie.name || !cookie.value ||
          cookie.name.length > 256 || cookie.value.length > 4096 ||
          cookie.options.httpOnly !== true || cookie.options.secure !== true ||
          cookie.options.sameSite !== "lax" || cookie.options.path !== "/" ||
          cookie.options.domain !== undefined)) {
      await discard();
      throw new Error("Authentication unavailable");
    }
    return {
      verifiedUserId: data.user.id,
      takeSession() {
        if (finished) throw new Error("Staged session unavailable");
        finished = true;
        const cookies = staged;
        staged = [];
        return { cookies };
      },
      discard,
    };
  } catch {
    if (!finished) { try { await discard(); } catch { /* fail closed */ } }
    throw new Error("Authentication unavailable");
  }
}
