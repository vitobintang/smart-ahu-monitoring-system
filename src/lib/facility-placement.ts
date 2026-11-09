import {
  AHU_HALF_DEPTH,
  AHU_HALF_LENGTH,
  DEFAULT_AHU_PLACEMENTS,
  DEFAULT_ROOM_VERTICES,
  FACILITY_ZONES,
  MIN_AHU_SPACING,
  OUTDOOR_CAMPUS_BOUNDS,
  WALL_FLUSH_GAP,
  WALL_HALF_THICK,
  WALL_SNAP_RANGE,
  computeExteriorWallSegments,
  describeIndoorSector,
  describeOutdoorSector,
  findZoneAt,
  getAhuHalfExtents,
  isPointInsideIndoorRoom,
  isPointWithinCampusBounds,
  normalizeRotation,
  projectPointToSegment,
  snapToPlatformGrid,
  type AhuPlacement,
  type FloorVertex,
  type WallSegment,
  type WingZone,
} from "@/lib/facility-layout";

/* ------------------------------------------------------------------ */
/* Solid Wall Collision & Magnetic Wall-Snap Solver (Arbitrary Walls) */
/* ------------------------------------------------------------------ */

/** Effective half-extent of the AHU projected along unit direction (nx, nz). */
function ahuRadiusAlongDirection(nx: number, nz: number, rotationDeg: number): number {
  const ry = (-rotationDeg * Math.PI) / 180;
  const localXx = Math.cos(ry);
  const localXz = -Math.sin(ry);
  const localZx = Math.sin(ry);
  const localZz = Math.cos(ry);
  return (
    Math.abs(nx * localXx + nz * localXz) * AHU_HALF_LENGTH +
    Math.abs(nx * localZx + nz * localZz) * AHU_HALF_DEPTH
  );
}

/** True if the AHU's oriented 3D bounding plinth physically intersects any exterior wall or column. */
export function collidesWithAnyWall(
  x: number,
  z: number,
  rotationDeg = 0,
  customVertices?: FloorVertex[] | null,
): boolean {
  const eps = 0.015;
  for (const seg of computeExteriorWallSegments(customVertices)) {
    const dx = seg.x2 - seg.x1;
    const dz = seg.z2 - seg.z1;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    const tx = dx / len;
    const tz = dz / len;
    const nx = -tz;
    const nz = tx;

    const along = (x - seg.x1) * tx + (z - seg.z1) * tz;
    const perp = Math.abs((x - seg.x1) * nx + (z - seg.z1) * nz);

    const rAlong = ahuRadiusAlongDirection(tx, tz, rotationDeg);
    const rPerp = ahuRadiusAlongDirection(nx, nz, rotationDeg);

    if (
      along > -(rAlong + 0.18 - eps) &&
      along < len + (rAlong + 0.18 - eps) &&
      perp < WALL_HALF_THICK + rPerp - eps
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Checks that the entire oriented AHU mounting plinth sits cleanly either:
 * - wholly inside the facility floor polygon, OR
 * - wholly outside on the open outdoor campus grounds,
 * with zero wall overlap.
 */
export function isFootprintOnPlatform(
  x: number,
  z: number,
  rotationDeg = 0,
  customVertices?: FloorVertex[] | null,
): { ok: boolean; indoor: boolean; zone: WingZone | null } {
  if (collidesWithAnyWall(x, z, rotationDeg, customVertices)) {
    return { ok: false, indoor: false, zone: null };
  }

  const ry = (-rotationDeg * Math.PI) / 180;
  const cosR = Math.cos(ry);
  const sinR = Math.sin(ry);
  const localCorners = [
    [0, 0],
    [-AHU_HALF_LENGTH, -AHU_HALF_DEPTH],
    [AHU_HALF_LENGTH, -AHU_HALF_DEPTH],
    [-AHU_HALF_LENGTH, AHU_HALF_DEPTH],
    [AHU_HALF_LENGTH, AHU_HALF_DEPTH],
    [-AHU_HALF_LENGTH, 0],
    [AHU_HALF_LENGTH, 0],
    [0, -AHU_HALF_DEPTH],
    [0, AHU_HALF_DEPTH],
  ] as const;

  const worldSamples = localCorners.map(([lx, lz]) => [
    x + lx * cosR + lz * sinR,
    z - lx * sinR + lz * cosR,
  ]);

  if (!worldSamples.every(([sx, sz]) => isPointWithinCampusBounds(sx, sz))) {
    return { ok: false, indoor: false, zone: null };
  }

  const centerIndoor = isPointInsideIndoorRoom(x, z, customVertices);
  if (centerIndoor) {
    const allIndoor = worldSamples.every(([sx, sz]) => isPointInsideIndoorRoom(sx, sz, customVertices));
    return {
      ok: allIndoor,
      indoor: true,
      zone: allIndoor ? describeIndoorSector(x, z) : null,
    };
  }

  const allOutdoor = worldSamples.every(([sx, sz]) => !isPointInsideIndoorRoom(sx, sz, customVertices));
  return {
    ok: allOutdoor,
    indoor: false,
    zone: allOutdoor ? describeOutdoorSector(x, z) : null,
  };
}

export interface PlacementValidation {
  valid: boolean;
  snappedX: number;
  snappedZ: number;
  rotation: number;
  indoor: boolean;
  zone: WingZone | null;
  snappedToWall: boolean;
  snappedWall: WallSegment | null;
  reason?: string;
}

/**
 * Core solid-wall physics & magnetic flush-to-wall snap solver (works on H, V, & Angled walls!):
 * 1. Allows placing or moving AHUs anywhere inside the custom/default room OR anywhere outdoors.
 * 2. Magnetically snaps the AHU flush against any nearby wall segment (from inside OR outside)
 *    within WALL_SNAP_RANGE and aligns rotation parallel to the wall.
 * 3. Iteratively resolves wall normal push-out so 0.00m wall overlap is guaranteed.
 * 4. Checks safe clearance from all other AHU units.
 */
export function resolveWallPhysicsAndSnap(
  rawX: number,
  rawZ: number,
  existing: Array<{ id: string; x: number; z: number; rotation?: number }>,
  options?: {
    excludeId?: string;
    rotation?: number;
    enableWallSnap?: boolean;
    autoAlignRotation?: boolean;
    clampVoidToWall?: boolean;
    roomVertices?: FloorVertex[] | null;
    /** Placement grid increment for free (non-wall-snapped) positions; defaults to 0.5 m. */
    gridStep?: number;
  },
): PlacementValidation {
  const excludeId = options?.excludeId;
  const enableWallSnap = options?.enableWallSnap !== false;
  const autoAlignRotation = options?.autoAlignRotation !== false;
  const clampVoidToWall = options?.clampVoidToWall === true;
  const roomVertices = options?.roomVertices;
  const gridStep = options?.gridStep ?? 0.5;

  let rotation = normalizeRotation(options?.rotation ?? 0);

  if (!isPointWithinCampusBounds(rawX, rawZ) && !clampVoidToWall) {
    return {
      valid: false,
      snappedX: snapToPlatformGrid(rawX, gridStep),
      snappedZ: snapToPlatformGrid(rawZ, gridStep),
      rotation,
      indoor: false,
      zone: null,
      snappedToWall: false,
      snappedWall: null,
      reason: "Position is outside the facility site boundaries.",
    };
  }

  let workX = Math.min(OUTDOOR_CAMPUS_BOUNDS.xMax - 1.8, Math.max(OUTDOOR_CAMPUS_BOUNDS.xMin + 1.8, rawX));
  let workZ = Math.min(OUTDOOR_CAMPUS_BOUNDS.zMax - 1.8, Math.max(OUTDOOR_CAMPUS_BOUNDS.zMin + 1.8, rawZ));

  const walls = computeExteriorWallSegments(roomVertices);
  let snappedToWall = false;
  let snappedWall: WallSegment | null = null;

  // Step 1: Magnetic Wall Snap check against all polygon wall segments (H, V, and Angled!)
  if (enableWallSnap) {
    let bestGap = WALL_SNAP_RANGE;
    let bestCandidate: {
      seg: WallSegment;
      tx: number;
      tz: number;
      nx: number;
      nz: number;
      len: number;
      along: number;
      side: 1 | -1;
      wallRot: number;
    } | null = null;

    for (const seg of walls) {
      const dx = seg.x2 - seg.x1;
      const dz = seg.z2 - seg.z1;
      const len = Math.hypot(dx, dz);
      if (len < 2.2) continue;

      const tx = dx / len;
      const tz = dz / len;
      const nx = -tz;
      const nz = tx;

      const along = (workX - seg.x1) * tx + (workZ - seg.z1) * tz;
      if (along < 0.6 || along > len - 0.6) continue;

      const signedPerp = (workX - seg.x1) * nx + (workZ - seg.z1) * nz;
      const side: 1 | -1 = signedPerp >= 0 ? 1 : -1;

      // Compute rotation that places AHU's flat back (-Z local) flush against the wall (-side * normal)
      const towardWallX = -side * nx;
      const towardWallZ = -side * nz;
      const alignedDeg = normalizeRotation((Math.atan2(towardWallX, -towardWallZ) * 180) / Math.PI);
      const candRot = autoAlignRotation ? alignedDeg : rotation;

      const rPerp = ahuRadiusAlongDirection(nx, nz, candRot);
      const absPerp = Math.abs(signedPerp);
      const faceDist = Math.abs(absPerp - WALL_HALF_THICK - rPerp);

      if (absPerp <= WALL_HALF_THICK + rPerp + WALL_SNAP_RANGE && faceDist < bestGap) {
        bestGap = faceDist;
        bestCandidate = { seg, tx, tz, nx, nz, len, along, side, wallRot: candRot };
      }
    }

    if (bestCandidate) {
      rotation = bestCandidate.wallRot;
      const rAlong = ahuRadiusAlongDirection(bestCandidate.tx, bestCandidate.tz, rotation);
      const rPerp = ahuRadiusAlongDirection(bestCandidate.nx, bestCandidate.nz, rotation);
      const minAlong = rAlong + 0.24;
      const maxAlong = bestCandidate.len - rAlong - 0.24;
      const clampedAlong =
        minAlong <= maxAlong
          ? Math.min(maxAlong, Math.max(minAlong, snapToPlatformGrid(bestCandidate.along, 0.5)))
          : bestCandidate.len / 2;
      const perpDist = WALL_HALF_THICK + rPerp + WALL_FLUSH_GAP;

      workX = Number(
        (
          bestCandidate.seg.x1 +
          bestCandidate.tx * clampedAlong +
          bestCandidate.nx * bestCandidate.side * perpDist
        ).toFixed(2),
      );
      workZ = Number(
        (
          bestCandidate.seg.z1 +
          bestCandidate.tz * clampedAlong +
          bestCandidate.nz * bestCandidate.side * perpDist
        ).toFixed(2),
      );
      snappedToWall = true;
      snappedWall = bestCandidate.seg;
    }
  }

  if (!snappedToWall) {
    // Free placement lands the AHU center exactly on the visible floor-grid intersections
    workX = snapToPlatformGrid(workX, gridStep);
    workZ = snapToPlatformGrid(workZ, gridStep);
  }

  // Step 2: Iterative Solid Wall Normal Push-Out Solver (guarantees zero wall penetration for H/V/Angled walls!)
  for (let iter = 0; iter < 6; iter += 1) {
    let pushed = false;
    for (const seg of walls) {
      const dx = seg.x2 - seg.x1;
      const dz = seg.z2 - seg.z1;
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      const tx = dx / len;
      const tz = dz / len;
      const nx = -tz;
      const nz = tx;

      const along = (workX - seg.x1) * tx + (workZ - seg.z1) * tz;
      const signedPerp = (workX - seg.x1) * nx + (workZ - seg.z1) * nz;
      const rAlong = ahuRadiusAlongDirection(tx, tz, rotation);
      const rPerp = ahuRadiusAlongDirection(nx, nz, rotation);
      const minPerp = WALL_HALF_THICK + rPerp + WALL_FLUSH_GAP;

      if (along > -(rAlong + 0.2) && along < len + (rAlong + 0.2) && Math.abs(signedPerp) < minPerp) {
        const side = signedPerp >= 0 ? 1 : -1;
        const pushDelta = minPerp - Math.abs(signedPerp);
        workX = Number((workX + nx * side * pushDelta).toFixed(2));
        workZ = Number((workZ + nz * side * pushDelta).toFixed(2));
        pushed = true;
      }
    }
    if (!pushed) break;
  }

  const footprint = isFootprintOnPlatform(workX, workZ, rotation, roomVertices);
  if (!footprint.ok || !footprint.zone) {
    return {
      valid: false,
      snappedX: workX,
      snappedZ: workZ,
      rotation,
      indoor: false,
      zone: null,
      snappedToWall: false,
      snappedWall: null,
      reason: "Blocked by wall corner — slide slightly along the wall or onto open floor.",
    };
  }

  // Step 3: Unit-to-unit solid collision check
  const { hx, hz } = getAhuHalfExtents(rotation);
  for (const unit of existing) {
    if (excludeId && unit.id === excludeId) continue;
    const otherExt = getAhuHalfExtents(unit.rotation ?? 0);
    const overlapX = Math.abs(unit.x - workX) < hx + otherExt.hx + 0.45;
    const overlapZ = Math.abs(unit.z - workZ) < hz + otherExt.hz + 0.45;
    const dist = Math.hypot(unit.x - workX, unit.z - workZ);
    if ((overlapX && overlapZ) || dist < MIN_AHU_SPACING * 0.85) {
      return {
        valid: false,
        snappedX: workX,
        snappedZ: workZ,
        rotation,
        indoor: footprint.indoor,
        zone: footprint.zone,
        snappedToWall,
        snappedWall,
        reason: `Too close to ${unit.id} — maintain safe equipment clearance.`,
      };
    }
  }

  return {
    valid: true,
    snappedX: workX,
    snappedZ: workZ,
    rotation,
    indoor: footprint.indoor,
    zone: footprint.zone,
    snappedToWall,
    snappedWall,
  };
}

/** Validates a floor, outdoor campus, or wall-snapped placement. */
export function validatePlatformPlacement(
  rawX: number,
  rawZ: number,
  existing: Array<{ id: string; x: number; z: number; rotation?: number }>,
  excludeId?: string,
  rotation?: number,
  roomVertices?: FloorVertex[] | null,
): PlacementValidation {
  return resolveWallPhysicsAndSnap(rawX, rawZ, existing, {
    excludeId,
    rotation,
    enableWallSnap: true,
    autoAlignRotation: rotation === undefined,
    clampVoidToWall: false,
    roomVertices,
  });
}

/** Picks a clean, guaranteed non-overlapping indoor or outdoor slot for a new AHU. */
export function suggestCleanPlatformSlot(
  existing: Array<{ id: string; x: number; z: number; rotation?: number }>,
  preferIndoor = true,
  roomVertices?: FloorVertex[] | null,
): { x: number; z: number; rotation: number; zone: WingZone; indoor: boolean } {
  const candidates: Array<[number, number, number]> = preferIndoor
    ? [
        [4, -6.9, 0],
        [-5, 3, 0],
        [0, -12.9, 0],
        [17, -2, 180],
        [-16, -16.9, 0],
        [-17, 3, 0],
        [2, 18.9, 180],
        [10, 15, 270],
        [-8, -13, 0],
        [14, -9, 0],
        [-12, 9, 180],
        [5, -4, 0],
      ]
    : [
        [15.1, 10.2, 270],
        [15.1, 17.8, 270],
        [12, -13.1, 180],
        [20, -13.1, 180],
        [-12, -19.1, 180],
        [-23.1, 6, 90],
        [6, 21.1, 0],
        [24, 6, 270],
        [-24, -10, 90],
      ];

  for (const [cx, cz, crot] of candidates) {
    const res = resolveWallPhysicsAndSnap(cx, cz, existing, {
      rotation: crot,
      enableWallSnap: true,
      autoAlignRotation: false,
      clampVoidToWall: false,
      roomVertices,
    });
    if (res.valid && res.zone && res.indoor === preferIndoor) {
      return {
        x: res.snappedX,
        z: res.snappedZ,
        rotation: res.rotation,
        zone: res.zone,
        indoor: res.indoor,
      };
    }
  }

  for (let x = -30; x <= 30; x += 3) {
    for (let z = -28; z <= 28; z += 3) {
      const res = resolveWallPhysicsAndSnap(x, z, existing, {
        enableWallSnap: true,
        autoAlignRotation: true,
        clampVoidToWall: false,
        roomVertices,
      });
      if (res.valid && res.zone && res.indoor === preferIndoor) {
        return {
          x: res.snappedX,
          z: res.snappedZ,
          rotation: res.rotation,
          zone: res.zone,
          indoor: res.indoor,
        };
      }
    }
  }

  return { x: 4, z: 0, rotation: 0, zone: FACILITY_ZONES[0], indoor: true };
}

/** Resolves an AHU's persisted or deterministic fallback 3D placement. */
export function resolveAhuPlacement(
  ahu: {
    id: string;
    mapX?: number | null;
    mapZ?: number | null;
    mapRotation?: number | null;
    mapZone?: string | null;
  },
  existingResolved: Array<{ id: string; x: number; z: number; rotation?: number }> = [],
  roomVertices?: FloorVertex[] | null,
): AhuPlacement {
  if (
    typeof ahu.mapX === "number" &&
    Number.isFinite(ahu.mapX) &&
    typeof ahu.mapZ === "number" &&
    Number.isFinite(ahu.mapZ)
  ) {
    const zInfo = findZoneAt(ahu.mapX, ahu.mapZ, roomVertices);
    return {
      id: ahu.id,
      x: ahu.mapX,
      z: ahu.mapZ,
      rotation: normalizeRotation(ahu.mapRotation ?? 0),
      zone: ahu.mapZone ?? zInfo?.label ?? "Facility Floor Platform",
      indoor: zInfo ? zInfo.indoor : true,
    };
  }

  const preset = DEFAULT_AHU_PLACEMENTS[ahu.id];
  if (preset) {
    const zInfo = findZoneAt(preset.x, preset.z, roomVertices);
    return {
      id: ahu.id,
      x: preset.x,
      z: preset.z,
      rotation: preset.rotation,
      zone: preset.zone,
      indoor: zInfo ? zInfo.indoor : true,
    };
  }

  const fallback = suggestCleanPlatformSlot(existingResolved, true, roomVertices);
  return {
    id: ahu.id,
    x: fallback.x,
    z: fallback.z,
    rotation: fallback.rotation,
    zone: fallback.zone.label,
    indoor: fallback.indoor,
  };
}

/* ------------------------------------------------------------------ */
/* Dynamic Randomized Outdoor Landscape Tree Generator & Room Reactor */
/* ------------------------------------------------------------------ */

export interface OutdoorTreeCandidate {
  x: number;
  z: number;
  scale: number;
  kind: "canopy" | "pine";
  rotationY: number;
}

export const OUTDOOR_TREE_WALL_CLEARANCE = 2.8;
export const OUTDOOR_TREE_AHU_CLEARANCE = 3.5;
export const MAX_VISIBLE_OUTDOOR_TREES = 8;

function minDistanceToWalls(x: number, z: number, walls: WallSegment[]): number {
  let minD = Infinity;
  for (const w of walls) {
    const d = projectPointToSegment(x, z, w.x1, w.z1, w.x2, w.z2).dist;
    if (d < minD) minD = d;
  }
  return minD;
}

/**
 * Returns true when an outdoor tree candidate at (x, z) is strictly outside the current
 * room polygon and maintains safe clearance from all room walls and AHU units.
 */
export function isOutdoorTreeSpotClear(
  x: number,
  z: number,
  roomVertices: FloorVertex[] = DEFAULT_ROOM_VERTICES,
  ahuPositions: Array<{ x: number; z: number }> = [],
): boolean {
  if (!isPointWithinCampusBounds(x, z)) return false;
  if (isPointInsideIndoorRoom(x, z, roomVertices)) return false;

  const walls = computeExteriorWallSegments(roomVertices);
  if (minDistanceToWalls(x, z, walls) < OUTDOOR_TREE_WALL_CLEARANCE) return false;

  for (const u of ahuPositions) {
    if (Math.hypot(u.x - x, u.z - z) < OUTDOOR_TREE_AHU_CLEARANCE) return false;
  }
  return true;
}

/**
 * Generates a randomized, Poisson-spaced spatial pool of outdoor tree spots:
 * - 5 sparse initial outdoor trees around the building courtyard (3.1m–11.5m outside walls),
 *   so expanding the room automatically swallows & hides trees in its path.
 * - 6 dormant randomized seeds inside the room wings, so shrinking the room automatically
 *   reveals & sprouts new trees in the newly opened outdoor space!
 */
export function generateRandomTreePool(
  baseVertices: FloorVertex[] = DEFAULT_ROOM_VERTICES,
  existingAhus: Array<{ x: number; z: number }> = [],
  rng: () => number = Math.random,
): OutdoorTreeCandidate[] {
  const pool: OutdoorTreeCandidate[] = [];
  const baseWalls = computeExteriorWallSegments(baseVertices);

  const makeSpec = (x: number, z: number): OutdoorTreeCandidate => ({
    x: Number(x.toFixed(2)),
    z: Number(z.toFixed(2)),
    scale: Number((0.92 + rng() * 0.22).toFixed(2)),
    kind: rng() < 0.62 ? "canopy" : "pine",
    rotationY: Number((rng() * Math.PI * 2).toFixed(3)),
  });

  // Pass 1: 5 sparse, randomly placed visible outdoor trees around the courtyard perimeter
  const targetInitialOutdoor = 5;
  for (let attempt = 0; attempt < 420 && pool.length < targetInitialOutdoor; attempt += 1) {
    const x = -32 + rng() * 64;
    const z = -30 + rng() * 60;
    if (!isOutdoorTreeSpotClear(x, z, baseVertices, existingAhus)) continue;
    const wallDist = minDistanceToWalls(x, z, baseWalls);
    if (wallDist < 3.1 || wallDist > 11.5) continue;
    if (pool.some((p) => Math.hypot(p.x - x, p.z - z) < 11.8)) continue;
    pool.push(makeSpec(x, z));
  }

  // Pass 2: 6 dormant randomized seeds inside the room wings (sprout automatically when room shrinks!)
  const targetDormantSeeds = 6;
  let dormantAdded = 0;
  for (let attempt = 0; attempt < 420 && dormantAdded < targetDormantSeeds; attempt += 1) {
    const x = -21 + rng() * 42;
    const z = -17 + rng() * 36;
    if (!isPointInsideIndoorRoom(x, z, baseVertices)) continue;
    const wallDist = minDistanceToWalls(x, z, baseWalls);
    // Bias toward outer wings (1.5m–7.5m inside walls) so shrinking a wing by a few meters reveals trees!
    if (wallDist < 1.4 || wallDist > 8.0) continue;
    if (pool.some((p) => Math.hypot(p.x - x, p.z - z) < 8.8)) continue;
    pool.push(makeSpec(x, z));
    dormantAdded += 1;
  }

  return pool;
}
