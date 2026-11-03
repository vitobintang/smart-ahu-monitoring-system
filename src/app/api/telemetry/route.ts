import { ingestTelemetry, type TelemetryPayload } from "@/lib/engine";

export const dynamic = "force-dynamic";

/**
 * FR-22 secure telemetry ingestion endpoint.
 * Authentication: `Authorization: Bearer <device token>` (FR-21).
 * NFR-04: the historical row is committed inside a DB transaction BEFORE the
 * success response is returned.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const token = bearer || req.headers.get("x-device-token") || "";
  if (!token) {
    return Response.json({ error: "Missing device bearer token" }, { status: 401 });
  }

  let payload: TelemetryPayload;
  try {
    payload = (await req.json()) as TelemetryPayload;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await ingestTelemetry(token, payload);
  return Response.json(result.body, { status: result.status });
}