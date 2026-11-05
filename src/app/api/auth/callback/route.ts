import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { CSRF_COOKIE, getClientIp, invalidateSessionCache, writeAudit } from "@/lib/auth";
import { DEVICE_COOKIE } from "@/lib/device-access";
import { randomHex } from "@/lib/ids";
import { canonicalizeClientIp } from "@/lib/login-rate-limiter";
import { resolveOrLinkAppUserForAuthUser } from "@/lib/oauth-account";

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

export async function GET(req: NextRequest) {
  const origin = resolveOrigin(req);
  const rawIp = await getClientIp();
  const ip = canonicalizeClientIp(rawIp);

  const oauthError = req.nextUrl.searchParams.get("error");
  const oauthErrorCode = req.nextUrl.searchParams.get("error_code");
  const oauthDesc = req.nextUrl.searchParams.get("error_description");
  if (oauthError) {
    const loginUrl = new URL("/login", origin);
    if (oauthErrorCode === "signup_disabled" || oauthDesc?.toLowerCase().includes("signups not allowed")) {
      loginUrl.searchParams.set("error", "unregistered_google");
    } else if (oauthError === "access_denied") {
      loginUrl.searchParams.set("error", "google_cancelled");
    } else {
      loginUrl.searchParams.set("error", "google_oauth_failed");
      if (oauthDesc) loginUrl.searchParams.set("detail", oauthDesc.slice(0, 160));
    }
    return NextResponse.redirect(loginUrl, { status: 302 });
  }

  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_oauth_code", origin), { status: 302 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) {
    return NextResponse.redirect(new URL("/login?error=supabase_not_configured", origin), { status: 302 });
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

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("error", "google_oauth_failed");
    if (error?.message) loginUrl.searchParams.set("detail", error.message.slice(0, 160));
    return NextResponse.redirect(loginUrl, { status: 302 });
  }

  const authUser = data.user;
  const metaName =
    (typeof authUser.user_metadata?.full_name === "string" && authUser.user_metadata.full_name) ||
    (typeof authUser.user_metadata?.name === "string" && authUser.user_metadata.name) ||
    null;

  const appUser = await resolveOrLinkAppUserForAuthUser({
    id: authUser.id,
    email: authUser.email ?? null,
    emailConfirmed: Boolean(authUser.email_confirmed_at || authUser.app_metadata?.provider === "google"),
    fullName: metaName,
  });

  if (!appUser) {
    await supabase.auth.signOut({ scope: "local" });
    await writeAudit({
      userEmail: authUser.email ?? null,
      action: "LOGIN_FAILED",
      entity: "auth",
      ipAddress: ip,
      details: { provider: "google", reason: "unregistered_or_unassigned_role" },
    });
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("error", "unregistered_google");
    if (authUser.email) loginUrl.searchParams.set("email", authUser.email);
    const denyRes = NextResponse.redirect(loginUrl, { status: 302 });
    for (const c of pendingCookies) {
      denyRes.cookies.set(c.name, c.value, c.options);
    }
    return denyRes;
  }

  invalidateSessionCache();
  const csrfToken = randomHex(24);
  await writeAudit({
    userId: appUser.id,
    userEmail: appUser.email,
    action: "LOGIN_SUCCESS",
    entity: "auth",
    ipAddress: ip,
    details: {
      role: appUser.role,
      username: appUser.username ?? null,
      provider: "google",
    },
  });

  const res = NextResponse.redirect(new URL("/dashboard", origin), { status: 302 });
  for (const c of pendingCookies) {
    res.cookies.set(c.name, c.value, c.options);
  }
  res.cookies.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  res.cookies.delete(DEVICE_COOKIE);
  return res;
}
