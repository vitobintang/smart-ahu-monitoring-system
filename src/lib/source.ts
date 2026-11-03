import { sql } from "drizzle-orm";
import { devices, telemetry } from "@/db/schema";

/** Physical data is authoritative when a physical source is enabled. Never
 * let simulated data mask a missing physical heartbeat or confirm commands. */
export function authoritativeTelemetry() {
  return sql`(${telemetry.source})::text = case when exists (
    select 1 from ${devices} where ${devices.ahuId} = ${telemetry.ahuId}
      and ${devices.enabled} and ${devices.sourceType} = 'PHYSICAL'
  ) then 'PHYSICAL' else 'SIMULATION' end`;
}