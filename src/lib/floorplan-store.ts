import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ahus, facilityFloorplan } from "@/db/schema";
import {
  computePolygonAreaSqM,
  DEFAULT_ROOM_VERTICES,
  findZoneAt,
  validateFloorplanPolygon,
  type FloorVertex,
} from "@/lib/facility-layout";
import { collidesWithAnyWall, resolveAhuPlacement, resolveWallPhysicsAndSnap } from "@/lib/facility-placement";

export interface StoredFloorplanState {
  vertices: FloorVertex[];
  isCustom: boolean;
  areaSqM: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

declare global {
  var __ahuFloorplanCache:
    | {
        data: StoredFloorplanState;
        expiresAt: number;
      }
    | undefined;
}

const CACHE_TTL_MS = 60_000;

export async function getActiveFloorplan(): Promise<StoredFloorplanState> {
  const now = Date.now();
  if (globalThis.__ahuFloorplanCache && globalThis.__ahuFloorplanCache.expiresAt > now) {
    return globalThis.__ahuFloorplanCache.data;
  }

  try {
    const rows = await db
      .select()
      .from(facilityFloorplan)
      .where(eq(facilityFloorplan.id, 1))
      .limit(1);

    const row = rows[0];
    if (row && Array.isArray(row.vertices) && row.vertices.length >= 3) {
      const check = validateFloorplanPolygon(row.vertices);
      if (check.valid) {
        const state: StoredFloorplanState = {
          vertices: row.vertices.map((v) => ({
            x: Number(Number(v.x).toFixed(2)),
            z: Number(Number(v.z).toFixed(2)),
          })),
          isCustom: true,
          areaSqM: check.areaSqM,
          updatedBy: row.updatedBy ?? null,
          updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
        };
        globalThis.__ahuFloorplanCache = { data: state, expiresAt: now + CACHE_TTL_MS };
        return state;
      }
    }
  } catch {
    // Graceful fallback to default polygon if migration has not run yet in an isolated test env
  }

  const fallback: StoredFloorplanState = {
    vertices: DEFAULT_ROOM_VERTICES,
    isCustom: false,
    areaSqM: computePolygonAreaSqM(DEFAULT_ROOM_VERTICES),
    updatedBy: null,
    updatedAt: null,
  };
  globalThis.__ahuFloorplanCache = { data: fallback, expiresAt: now + CACHE_TTL_MS };
  return fallback;
}

/**
 * Persists a custom room polygon to PostgreSQL and automatically nudges any AHU
 * whose plinth would intersect a newly moved wall so zero units clip into walls.
 */
export async function saveCustomFloorplan(
  rawVertices: FloorVertex[],
  actorUsername: string,
): Promise<{ state: StoredFloorplanState; nudgedUnits: string[] }> {
  const cleanVertices = rawVertices.map((v) => ({
    x: Number(Number(v.x).toFixed(2)),
    z: Number(Number(v.z).toFixed(2)),
  }));

  const check = validateFloorplanPolygon(cleanVertices);
  if (!check.valid) {
    throw new Error(check.reason ?? "Invalid room floorplan geometry.");
  }

  const nowDate = new Date();
  await db
    .insert(facilityFloorplan)
    .values({
      id: 1,
      vertices: cleanVertices,
      updatedBy: actorUsername,
      updatedAt: nowDate,
    })
    .onConflictDoUpdate({
      target: facilityFloorplan.id,
      set: {
        vertices: cleanVertices,
        updatedBy: actorUsername,
        updatedAt: nowDate,
      },
    });

  // Check existing AHUs and gently nudge any unit touched by a newly moved wall,
  // and refresh indoor/outdoor zone labels if a wing expanded or contracted over an AHU.
  const allRows = await db.select().from(ahus).orderBy(asc(ahus.id));
  const resolved: Array<{ id: string; x: number; z: number; rotation: number }> = [];
  for (const r of allRows) {
    const p = resolveAhuPlacement(r, resolved, cleanVertices);
    resolved.push({ id: r.id, x: p.x, z: p.z, rotation: p.rotation });
  }

  const nudgedUnits: string[] = [];
  for (const item of resolved) {
    if (collidesWithAnyWall(item.x, item.z, item.rotation, cleanVertices)) {
      const others = resolved.filter((o) => o.id !== item.id);
      const nudged = resolveWallPhysicsAndSnap(item.x, item.z, others, {
        excludeId: item.id,
        rotation: item.rotation,
        enableWallSnap: true,
        autoAlignRotation: true,
        clampVoidToWall: true,
        roomVertices: cleanVertices,
      });
      if (nudged.valid && nudged.zone) {
        item.x = nudged.snappedX;
        item.z = nudged.snappedZ;
        item.rotation = nudged.rotation;
        nudgedUnits.push(item.id);
        await db
          .update(ahus)
          .set({
            mapX: nudged.snappedX,
            mapZ: nudged.snappedZ,
            mapRotation: nudged.rotation,
            mapZone: nudged.zone.label,
          })
          .where(eq(ahus.id, item.id));
      }
    } else {
      const row = allRows.find((r) => r.id === item.id);
      const zInfo = findZoneAt(item.x, item.z, cleanVertices);
      if (row && zInfo && row.mapZone !== zInfo.label) {
        await db.update(ahus).set({ mapZone: zInfo.label }).where(eq(ahus.id, item.id));
      }
    }
  }

  const state: StoredFloorplanState = {
    vertices: cleanVertices,
    isCustom: true,
    areaSqM: check.areaSqM,
    updatedBy: actorUsername,
    updatedAt: nowDate.toISOString(),
  };
  globalThis.__ahuFloorplanCache = { data: state, expiresAt: Date.now() + CACHE_TTL_MS };
  return { state, nudgedUnits };
}

export async function resetCustomFloorplan(): Promise<StoredFloorplanState> {
  await db.delete(facilityFloorplan).where(eq(facilityFloorplan.id, 1));
  const state: StoredFloorplanState = {
    vertices: DEFAULT_ROOM_VERTICES,
    isCustom: false,
    areaSqM: computePolygonAreaSqM(DEFAULT_ROOM_VERTICES),
    updatedBy: null,
    updatedAt: null,
  };
  globalThis.__ahuFloorplanCache = { data: state, expiresAt: Date.now() + CACHE_TTL_MS };
  return state;
}
