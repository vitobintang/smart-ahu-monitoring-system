import { authorizeServerRequest } from "../../../../lib/server-authorization";
import { buildSessionResponse } from "../../../../lib/session-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return buildSessionResponse(() =>
    authorizeServerRequest("monitoring:read"),
  );
}