import type { RtdbAdapter } from "./store";

/**
 * Facility floorplan tree — previously the single-row
 * `facility_floorplan` table (id = 1).
 *
 * Tree layout (epoch-ms timestamp):
 *   facility/floorplan → { id: 1, vertices, updatedBy, updatedAt }
 *
 * The 3D floor map is a single mutable document, so a plain set is the whole
 * write path (last-writer-wins — identical semantics to the SQL upsert).
 * `resetFloorplan` removes the node so readers fall back to the built-in
 * DEFAULT_ROOM_VERTICES.
 */

export const FACILITY_NODE = "facility";
export const FLOORPLAN_PATH = `${FACILITY_NODE}/floorplan`;

export interface RtdbFloorplanRecord {
  id: 1;
  vertices: Array<{ x: number; z: number }>;
  updatedBy: string | null;
  updatedAt: number;
}

export async function readRtdbFloorplan(rtdb: RtdbAdapter): Promise<RtdbFloorplanRecord | null> {
  return rtdb.get<RtdbFloorplanRecord>(FLOORPLAN_PATH);
}

export async function writeRtdbFloorplan(
  rtdb: RtdbAdapter,
  vertices: Array<{ x: number; z: number }>,
  updatedBy: string | null,
  updatedAt: number,
): Promise<void> {
  const record: RtdbFloorplanRecord = { id: 1, vertices, updatedBy, updatedAt };
  await rtdb.set(FLOORPLAN_PATH, record);
}

export async function removeRtdbFloorplan(rtdb: RtdbAdapter): Promise<void> {
  await rtdb.remove(FLOORPLAN_PATH);
}
