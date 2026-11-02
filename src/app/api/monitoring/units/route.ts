import { getDatabasePool } from "../../../../db/connection";
import {
  readMonitoringUnits,
  type MonitoringUnit,
} from "../../../../db/monitoring";
import { buildMonitoringResponse } from "../../../../lib/monitoring-response";
import { authorizeServerRequest } from "../../../../lib/server-authorization";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return buildMonitoringResponse({
    authorize: () => authorizeServerRequest("monitoring:read"),
    loadUnits: () =>
      readMonitoringUnits((text, values) =>
        getDatabasePool().query<MonitoringUnit>(text, values),
      ),
  });
}