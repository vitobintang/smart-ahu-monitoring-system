import { sql } from "drizzle-orm";
import { devices, telemetry } from "@/db/schema";

/**
 * Authoritative live telemetry source for each AHU:
 * - Enabled PHYSICAL device takes precedence over SIMULATION.
 * - Enabled SIMULATION device is used when no PHYSICAL device is enabled.
 * - When all devices for an AHU are disabled, returns NULL so live views
 *   immediately treat the unit as OFFLINE rather than showing stale readings.
 */
export function authoritativeTelemetry() {
  return sql`(${telemetry.source})::text = case
    when exists (
      select 1 from ${devices} where ${devices.ahuId} = ${telemetry.ahuId}
        and ${devices.enabled} and ${devices.sourceType} = 'PHYSICAL'
    ) then 'PHYSICAL'
    when exists (
      select 1 from ${devices} where ${devices.ahuId} = ${telemetry.ahuId}
        and ${devices.enabled} and ${devices.sourceType} = 'SIMULATION'
    ) then 'SIMULATION'
    else null
  end`;
}
