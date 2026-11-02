import { getDatabasePool } from "../../../../db/connection";
import {
  readLatestObservations,
  type LatestObservation,
} from "../../../../db/latest-observations";
import { buildObservationResponse } from "../../../../lib/observation-response";
import { authorizeServerRequest } from "../../../../lib/server-authorization";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return buildObservationResponse({
    authorize: () => authorizeServerRequest("monitoring:read"),
    loadObservations: () =>
      readLatestObservations((text, values) =>
        getDatabasePool().query<LatestObservation>(text, values),
      ),
  });
}