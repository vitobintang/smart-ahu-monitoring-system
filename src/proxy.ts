import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Refresh Supabase's session before rendering, so updated cookies reach both
 * Server Components and the browser. getUser validates the token with Auth. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  // API routes validate/refresh sessions directly in their handlers; skip
  // proxy round-trips there and whenever no Supabase auth cookie is present.
  if (request.nextUrl.pathname.startsWith("/api/")) return response;
  const allCookies = request.cookies.getAll();
  if (!allCookies.some((c) => c.name.startsWith("sb-"))) return response;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;
  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    await supabase.auth.getUser();
  } catch {
    /* allow token-authenticated non-Admin sessions to proceed even if Supabase refresh fails */
  }
  return response;
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|ahu/).*)"],
};
