import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

function resolveOrigin(req: NextRequest): string {
  const fwdHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const fwdProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (fwdHost) {
    const proto = fwdProto || (fwdHost.startsWith("localhost") || fwdHost.startsWith("127.0.0.1") ? "http" : "https");
    return `${proto}://${fwdHost}`;
  }
  return req.nextUrl.origin;
}

async function isGoogleProviderEnabled(supabaseUrl: string, publishableKey: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/settings`, {
      headers: { apikey: publishableKey },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return true; // Let OAuth proceed if settings probe is inconclusive
    const json = (await res.json()) as { external?: { google?: boolean } };
    return json.external?.google !== false;
  } catch {
    return true;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  const origin = resolveOrigin(req);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !key) {
    return NextResponse.redirect(new URL("/login?error=supabase_not_configured", origin), { status: 302 });
  }

  const enabled = await isGoogleProviderEnabled(url, key);
  if (!enabled) {
    return NextResponse.redirect(new URL("/login?error=google_not_configured", origin), { status: 302 });
  }

  const pendingCookies: Array<{ name: string; value: string; options: CookieOptions }> = [];
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (items) => {
        pendingCookies.push(...items);
      },
    },
  });

  const callbackUrl = `${origin}/api/auth/callback`;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl,
      queryParams: {
        prompt: "select_account",
      },
    },
  });

  if (error || !data?.url) {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("error", "google_oauth_failed");
    if (error?.message) loginUrl.searchParams.set("detail", error.message.slice(0, 160));
    return NextResponse.redirect(loginUrl, { status: 302 });
  }

  const res = NextResponse.redirect(data.url, { status: 302 });
  for (const c of pendingCookies) {
    res.cookies.set(c.name, c.value, c.options);
  }
  return res;
}
