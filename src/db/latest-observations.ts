import { AHU_IDS } from "../lib/ahu";

type Source = "PHYSICAL" | "SIMULATION";

export type LatestObservation = {
  ahu_id: string;
  configured_source: Source | null;
  observed_source: Source | null;
  measured_at: Date | null;
  room_temp_installed: boolean;
  humidity_installed: boolean;
  room_temp: number | null;
  humidity: number | null;
};

type ObservationQuery = (
  text: string,
  values: string[][],
) => Promise<{ rows: LatestObservation[] }>;

// Returns historical rows only. It does not establish freshness or trust.
export async function readLatestObservations(
  query: ObservationQuery,
): Promise<LatestObservation[]> {
  const result = await query(
    `WITH selected AS (
       SELECT a.id, a.installed_sensors,
         CASE
           WHEN EXISTS (
             SELECT 1 FROM ahu_private.devices d
             WHERE d.ahu_id = a.id AND d.enabled = true
               AND d.source_type::text = 'PHYSICAL'
           ) THEN 'PHYSICAL'
           WHEN EXISTS (
             SELECT 1 FROM ahu_private.devices d
             WHERE d.ahu_id = a.id AND d.enabled = true
               AND d.source_type::text = 'SIMULATION'
           ) THEN 'SIMULATION'
           ELSE NULL
         END AS configured_source
       FROM ahu_private.ahus a
       WHERE a.id = ANY($1::text[])
     )
     SELECT a.id AS ahu_id, a.configured_source,
       t.source::text AS observed_source, t.timestamp AS measured_at,
       COALESCE('roomTemp' = ANY(a.installed_sensors), false) AS room_temp_installed,
       COALESCE('humidity' = ANY(a.installed_sensors), false) AS humidity_installed,
       CASE WHEN 'roomTemp' = ANY(a.installed_sensors) THEN t.room_temp ELSE NULL END AS room_temp,
       CASE WHEN 'humidity' = ANY(a.installed_sensors) THEN t.humidity ELSE NULL END AS humidity
     FROM selected a
     LEFT JOIN LATERAL (
       SELECT source, timestamp, room_temp, humidity
       FROM ahu_private.telemetry
       WHERE ahu_id = a.id AND source::text = a.configured_source
       ORDER BY timestamp DESC, id DESC
       LIMIT 1
     ) t ON true
     ORDER BY a.id`,
    [[...AHU_IDS]],
  );

  return result.rows;
}