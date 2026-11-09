import { NextResponse, type NextRequest } from "next/server";

/**
 * Sessions are Firebase httpOnly `__session` cookies verified per-request in
 * server code (src/lib/auth.ts) — no proxy-side token refresh is needed anymore.
 */
export async function proxy(request: NextRequest) {
  return NextResponse.next({ request });
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|ahu/).*)"],
};
