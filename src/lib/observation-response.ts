import type { LatestObservation } from "../db/latest-observations";
import { AHU_IDS, type UserRole } from "./ahu";

type Dependencies = {
  authorize: () => Promise<{ id: string; role: UserRole } | null>;
  loadObservations: () => Promise<LatestObservation[]>;
  now?: () => number;
};

function isSource(
  value: unknown,
): value is "PHYSICAL" | "SIMULATION" {
  return value === "PHYSICAL" || value === "SIMULATION";
}

function safeValue(
  value: number | null,
  configured: boolean,
  future: boolean,
  hasObservation: boolean,
) {
  return hasObservation &&
    configured &&
    !future &&
    typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : null;
}

export async function buildObservationResponse(
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

    const rows = await deps.loadObservations();
    const now = (deps.now ?? Date.now)();

    if (
      !Array.isArray(rows) ||
      rows.length > AHU_IDS.length ||
      !Number.isFinite(now)
    ) {
      throw new Error("Invalid observation result");
    }

    const seen = new Set<string>();

    const observations = rows.map((row) => {
      if (
        !row ||
        !AHU_IDS.some((id) => id === row.ahu_id) ||
        seen.has(row.ahu_id) ||
        (row.configured_source !== null &&
          !isSource(row.configured_source)) ||
        (row.observed_source !== null &&
          !isSource(row.observed_source)) ||
        (row.observed_source !== null &&
          row.observed_source !== row.configured_source) ||
        typeof row.room_temp_installed !== "boolean" ||
        typeof row.humidity_installed !== "boolean"
      ) {
        throw new Error("Invalid observation row");
      }

      seen.add(row.ahu_id);

      const hasObservation = row.observed_source !== null;

      if (
        (hasObservation &&
          (!(row.measured_at instanceof Date) ||
            !Number.isFinite(row.measured_at.getTime()))) ||
        (!hasObservation && row.measured_at !== null)
      ) {
        throw new Error("Invalid measurement time");
      }

      const measuredAt = hasObservation ? row.measured_at! : null;
      const future =
        measuredAt !== null && measuredAt.getTime() > now;

      return {
        ahuId: row.ahu_id,
        configuredSource: row.configured_source,
        observedSource: row.observed_source,
        measuredAt: measuredAt?.toISOString() ?? null,
        timestampStatus:
          measuredAt === null
            ? "unknown"
            : future
              ? "future"
              : "past_or_present",
        roomTemp: {
          configured: row.room_temp_installed,
          value: safeValue(
            row.room_temp,
            row.room_temp_installed,
            future,
            hasObservation,
          ),
        },
        humidity: {
          configured: row.humidity_installed,
          value: safeValue(
            row.humidity,
            row.humidity_installed,
            future,
            hasObservation,
          ),
        },
      };
    });

    return Response.json(
      { observations },
      { status: 200, headers },
    );
  } catch {
    return Response.json(
      { error: "Monitoring unavailable" },
      { status: 503, headers },
    );
  }
}