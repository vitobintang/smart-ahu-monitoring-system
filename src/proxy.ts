import { NextResponse, type NextRequest } from "next/server";
import { isAllowedMobileOrigin } from "@/lib/mobile-origins";

const MOBILE_CORS_HEADERS = {
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type, X-CSRF-Token",
  "access-control-max-age": "600",
};

/**
 * Browser sessions remain httpOnly-cookie based. Native Capacitor clients use
 * Firebase ID-token bearer auth; this exact-origin CORS bridge lets those
 * requests reach the existing API without weakening the web session policy.
 */
export async function proxy(request: NextRequest) {
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  const origin = request.headers.get("origin");
  const nativeOrigin = isApi && isAllowedMobileOrigin(origin);

  if (isApi && request.method === "OPTIONS") {
    if (!nativeOrigin) return new NextResponse(null, { status: 403 });
    return new NextResponse(null, {
      status: 204,
      headers: {
        ...MOBILE_CORS_HEADERS,
        "access-control-allow-origin": origin,
        vary: "Origin",
      },
    });
  }

  const response = NextResponse.next({ request });
  if (nativeOrigin && origin) {
    response.headers.set("access-control-allow-origin", origin);
    response.headers.set("vary", "Origin");
    for (const [key, value] of Object.entries(MOBILE_CORS_HEADERS)) {
      response.headers.set(key, value);
    }
  }
  return response;
}

export const config = {
  matcher: ["/api/:path*", "/((?!_next/static|_next/image|favicon.ico|ahu/).*)"],
};
