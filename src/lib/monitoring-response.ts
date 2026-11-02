import type { MonitoringUnit } from "../db/monitoring";
import type { UserRole } from "./ahu";

type Dependencies = {
  authorize: () => Promise<{ id: string; role: UserRole } | null>;
  loadUnits: () => Promise<MonitoringUnit[]>;
};

export async function buildMonitoringResponse(
  deps: Dependencies,
): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };

  try {
    const user = await deps.authorize();

    if (!user) {
      return Response.json(
        { error: "Not authenticated" },
        { status: 401, headers },
      );
    }

    const units = await deps.loadUnits();

    if (!Array.isArray(units)) {
      throw new Error("Invalid unit result");
    }

    return Response.json({ units }, { status: 200, headers });
  } catch {
    return Response.json(
      { error: "Monitoring unavailable" },
      { status: 503, headers },
    );
  }
}