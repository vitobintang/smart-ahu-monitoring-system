import { AHU_IDS } from "../lib/ahu";

export type MonitoringUnit = {
  id: string;
  name: string;
  location: string;
};

type UnitsQuery = (
  text: string,
  values: string[][],
) => Promise<{ rows: MonitoringUnit[] }>;

export async function readMonitoringUnits(
  query: UnitsQuery,
): Promise<MonitoringUnit[]> {
  const result = await query(
    `SELECT id, name, location
     FROM ahu_private.ahus
     WHERE id = ANY($1::text[])
     ORDER BY id`,
    [[...AHU_IDS]],
  );

  return result.rows;
}