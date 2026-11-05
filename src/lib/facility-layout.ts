/**
 * Multi-branch 3D facility geometry, open outdoor campus grounds,
 * exterior wall extraction, solid wall collision physics, and magnetic
 * flush-to-wall AHU snapping (both indoor & anywhere outdoor).
 */

export interface WingZone {
  id: string;
  label: string;
  shortLabel: string;
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
  indoor: boolean;
  accent: string;
}

export interface AhuPlacement {
  id: string;
  x: number;
  z: number;
  rotation: number;
  zone: string;
  indoor: boolean;
}

export interface WallSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  orientation: "H" | "V";
}

export const GRID_CELL = 2;
export const AHU_HALF_LENGTH = 1.55; // local X half-extent of 3.1m plinth
export const AHU_HALF_DEPTH = 0.93; // local Z half-extent of 1.85m plinth (back is local -Z)
export const WALL_HALF_THICK = 0.14; // 0.28m solid perimeter wall
export const WALL_FLUSH_GAP = 0.03; // 3cm mounting clearance when snapped flush to wall
export const WALL_SNAP_RANGE = 1.65; // magnetic snap engagement distance from wall face
export const WALL_CLEARANCE = AHU_HALF_DEPTH + WALL_HALF_THICK + WALL_FLUSH_GAP;
export const MIN_AHU_SPACING = 3.6;

/** Full 3D architectural site bounds where outdoor AHUs can be freely placed anywhere outside the building. */
export const OUTDOOR_CAMPUS_BOUNDS = {
  xMin: -42,
  xMax: 42,
  zMin: -40,
  zMax: 40,
} as const;

/**
 * Six interconnected indoor branches forming one asymmetric open facility hall
 * (never a plain rectangle), surrounded by open unrestricted outdoor campus grounds.
 */
export const FACILITY_ZONES: WingZone[] = [
  {
    id: "central-spine",
    label: "Central Atrium Spine (Indoor)",
    shortLabel: "Central Spine",
    xMin: -8,
    xMax: 10,
    zMin: -8,
    zMax: 8,
    indoor: true,
    accent: "#2563eb",
  },
  {
    id: "northwest-cleanroom",
    label: "North-West Cleanroom Wing (Indoor)",
    shortLabel: "NW Cleanroom",
    xMin: -20,
    xMax: -4,
    zMin: -18,
    zMax: -8,
    indoor: true,
    accent: "#0284c7",
  },
  {
    id: "north-utility",
    label: "North Utility Alcove (Indoor)",
    shortLabel: "North Alcove",
    xMin: -4,
    xMax: 4,
    zMin: -14,
    zMax: -8,
    indoor: true,
    accent: "#3b82f6",
  },
  {
    id: "east-lab",
    label: "East Laboratory Branch (Indoor)",
    shortLabel: "East Lab Wing",
    xMin: 10,
    xMax: 22,
    zMin: -12,
    zMax: 2,
    indoor: true,
    accent: "#0d9488",
  },
  {
    id: "west-packing",
    label: "West Packing Branch (Indoor)",
    shortLabel: "West Logistics",
    xMin: -22,
    xMax: -8,
    zMin: 0,
    zMax: 12,
    indoor: true,
    accent: "#4f46e5",
  },
  {
    id: "southeast-warehouse",
    label: "South-East Warehouse Wing (Indoor)",
    shortLabel: "SE Warehouse",
    xMin: -2,
    xMax: 14,
    zMin: 8,
    zMax: 20,
    indoor: true,
    accent: "#059669",
  },
  {
    id: "outdoor-campus",
    label: "Outdoor Facility Grounds",
    shortLabel: "Outdoor Grounds",
    xMin: OUTDOOR_CAMPUS_BOUNDS.xMin,
    xMax: OUTDOOR_CAMPUS_BOUNDS.xMax,
    zMin: OUTDOOR_CAMPUS_BOUNDS.zMin,
    zMax: OUTDOOR_CAMPUS_BOUNDS.zMax,
    indoor: false,
    accent: "#0284c7",
  },
];

export function describeOutdoorSector(x: number, z: number): WingZone {
  let dir = "Perimeter";
  if (Math.abs(x) >= Math.abs(z)) {
    dir = x >= 0 ? "East" : "West";
  } else {
    dir = z < 0 ? "North" : "South";
  }
  return {
    id: "outdoor-campus",
    label: `Outdoor ${dir} Exterior`,
    shortLabel: `Outdoor ${dir}`,
    xMin: OUTDOOR_CAMPUS_BOUNDS.xMin,
    xMax: OUTDOOR_CAMPUS_BOUNDS.xMax,
    zMin: OUTDOOR_CAMPUS_BOUNDS.zMin,
    zMax: OUTDOOR_CAMPUS_BOUNDS.zMax,
    indoor: false,
    accent: "#0284c7",
  };
}

/**
 * Default coordinates for the 7 baseline AHU units:
 * - 5 inside the multi-branch facility hall
 * - 2 outside mounted flush against the exterior building walls (movable anywhere outdoors)
 */
export const DEFAULT_AHU_PLACEMENTS: Record<
  string,
  { x: number; z: number; rotation: number; zone: string }
> = {
  "AHU-01": { x: -12, z: -13, rotation: 0, zone: "North-West Cleanroom Wing (Indoor)" },
  "AHU-02": { x: -1, z: -2, rotation: 90, zone: "Central Atrium Spine (Indoor)" },
  "AHU-03": { x: 15, z: -6, rotation: 180, zone: "East Laboratory Branch (Indoor)" },
  "AHU-04": { x: -15, z: 6, rotation: 0, zone: "West Packing Branch (Indoor)" },
  "AHU-05": { x: 6, z: 14, rotation: 270, zone: "South-East Warehouse Wing (Indoor)" },
  "AHU-06": { x: 15.1, z: 14, rotation: 270, zone: "Outdoor East Exterior" },
  "AHU-07": { x: 16, z: -13.1, rotation: 180, zone: "Outdoor North Exterior" },
};

export function snapToPlatformGrid(v: number, step = 0.5): number {
  const s = Math.round(v / step) * step;
  return Number(s.toFixed(2));
}

export function normalizeRotation(deg: number): number {
  const n = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return n === 360 ? 0 : n;
}

export function getAhuHalfExtents(rotationDeg = 0): { hx: number; hz: number } {
  const rot = normalizeRotation(rotationDeg);
  if (rot === 90 || rot === 270) {
    return { hx: AHU_HALF_DEPTH, hz: AHU_HALF_LENGTH };
  }
  return { hx: AHU_HALF_LENGTH, hz: AHU_HALF_DEPTH };
}

export function isPointInsideIndoorRoom(x: number, z: number): boolean {
  return FACILITY_ZONES.some(
    (w) => w.indoor && x >= w.xMin && x <= w.xMax && z >= w.zMin && z <= w.zMax,
  );
}

export function isPointWithinCampusBounds(x: number, z: number): boolean {
  return (
    x >= OUTDOOR_CAMPUS_BOUNDS.xMin &&
    x <= OUTDOOR_CAMPUS_BOUNDS.xMax &&
    z >= OUTDOOR_CAMPUS_BOUNDS.zMin &&
    z <= OUTDOOR_CAMPUS_BOUNDS.zMax
  );
}

export function isPointInsideOutdoorPad(x: number, z: number): boolean {
  return isPointWithinCampusBounds(x, z) && !isPointInsideIndoorRoom(x, z);
}

export function findZoneAt(x: number, z: number): WingZone | null {
  for (const w of FACILITY_ZONES) {
    if (w.indoor && x > w.xMin && x < w.xMax && z > w.zMin && z < w.zMax) return w;
  }
  for (const w of FACILITY_ZONES) {
    if (w.indoor && x >= w.xMin && x <= w.xMax && z >= w.zMin && z <= w.zMax) return w;
  }
  if (isPointWithinCampusBounds(x, z)) {
    return describeOutdoorSector(x, z);
  }
  return null;
}

/**
 * Extracts merged outer perimeter wall segments of the union of all indoor wings.
 * Internal junctions between branches have zero walls so the room is one open
 * multi-branch space.
 */
let cachedWalls: WallSegment[] | null = null;

export function computeExteriorWallSegments(): WallSegment[] {
  if (cachedWalls) return cachedWalls;
  const cellKey = (gx: number, gz: number) => `${gx},${gz}`;
  const indoorSet = new Set<string>();

  let minGx = Infinity;
  let maxGx = -Infinity;
  let minGz = Infinity;
  let maxGz = -Infinity;

  for (const w of FACILITY_ZONES) {
    if (!w.indoor) continue;
    const gx0 = Math.round(w.xMin / GRID_CELL);
    const gx1 = Math.round(w.xMax / GRID_CELL);
    const gz0 = Math.round(w.zMin / GRID_CELL);
    const gz1 = Math.round(w.zMax / GRID_CELL);
    minGx = Math.min(minGx, gx0);
    maxGx = Math.max(maxGx, gx1);
    minGz = Math.min(minGz, gz0);
    maxGz = Math.max(maxGz, gz1);
    for (let gx = gx0; gx < gx1; gx += 1) {
      for (let gz = gz0; gz < gz1; gz += 1) {
        indoorSet.add(cellKey(gx, gz));
      }
    }
  }

  const segments: WallSegment[] = [];

  for (let gz = minGz; gz <= maxGz; gz += 1) {
    let runStart: number | null = null;
    for (let gx = minGx; gx <= maxGx; gx += 1) {
      const above = indoorSet.has(cellKey(gx, gz - 1));
      const below = indoorSet.has(cellKey(gx, gz));
      const isBoundary = gx < maxGx && above !== below;
      if (isBoundary) {
        if (runStart === null) runStart = gx;
      } else if (runStart !== null) {
        segments.push({
          x1: runStart * GRID_CELL,
          z1: gz * GRID_CELL,
          x2: gx * GRID_CELL,
          z2: gz * GRID_CELL,
          orientation: "H",
        });
        runStart = null;
      }
    }
  }

  for (let gx = minGx; gx <= maxGx; gx += 1) {
    let runStart: number | null = null;
    for (let gz = minGz; gz <= maxGz; gz += 1) {
      const left = indoorSet.has(cellKey(gx - 1, gz));
      const right = indoorSet.has(cellKey(gx, gz));
      const isBoundary = gz < maxGz && left !== right;
      if (isBoundary) {
        if (runStart === null) runStart = gz;
      } else if (runStart !== null) {
        segments.push({
          x1: gx * GRID_CELL,
          z1: runStart * GRID_CELL,
          x2: gx * GRID_CELL,
          z2: gz * GRID_CELL,
          orientation: "V",
        });
        runStart = null;
      }
    }
  }

  cachedWalls = segments;
  return segments;
}

function getWallBox(seg: WallSegment): { xMin: number; xMax: number; zMin: number; zMax: number } {
  if (seg.orientation === "H") {
    return {
      xMin: Math.min(seg.x1, seg.x2) - 0.21,
      xMax: Math.max(seg.x1, seg.x2) + 0.21,
      zMin: seg.z1 - WALL_HALF_THICK,
      zMax: seg.z1 + WALL_HALF_THICK,
    };
  }
  return {
    xMin: seg.x1 - WALL_HALF_THICK,
    xMax: seg.x1 + WALL_HALF_THICK,
    zMin: Math.min(seg.z1, seg.z2) - 0.21,
    zMax: Math.max(seg.z1, seg.z2) + 0.21,
  };
}

/** True if the AHU's oriented 3D bounding plinth physically intersects any exterior wall or column. */
export function collidesWithAnyWall(x: number, z: number, rotationDeg = 0): boolean {
  const { hx, hz } = getAhuHalfExtents(rotationDeg);
  const eps = 0.012;
  const axMin = x - hx + eps;
  const axMax = x + hx - eps;
  const azMin = z - hz + eps;
  const azMax = z + hz - eps;

  for (const seg of computeExteriorWallSegments()) {
    const wb = getWallBox(seg);
    if (axMax > wb.xMin && axMin < wb.xMax && azMax > wb.zMin && azMin < wb.zMax) {
      return true;
    }
  }
  return false;
}

/**
 * Checks that the entire oriented AHU mounting plinth sits cleanly either:
 * - wholly inside the multi-branch indoor facility floor, OR
 * - wholly outside on the open outdoor campus grounds,
 * with zero wall overlap.
 */
export function isFootprintOnPlatform(
  x: number,
  z: number,
  rotationDeg = 0,
): { ok: boolean; indoor: boolean; zone: WingZone | null } {
  if (collidesWithAnyWall(x, z, rotationDeg)) {
    return { ok: false, indoor: false, zone: null };
  }

  const { hx, hz } = getAhuHalfExtents(rotationDeg);
  const sampleOffsets = [
    [0, 0],
    [-hx, -hz],
    [hx, -hz],
    [-hx, hz],
    [hx, hz],
    [-hx, 0],
    [hx, 0],
    [0, -hz],
    [0, hz],
  ] as const;

  const centerZone = findZoneAt(x, z);
  if (!centerZone) return { ok: false, indoor: false, zone: null };

  if (centerZone.indoor) {
    const allIndoor = sampleOffsets.every(([dx, dz]) =>
      FACILITY_ZONES.some(
        (w) =>
          w.indoor &&
          x + dx >= w.xMin - 0.02 &&
          x + dx <= w.xMax + 0.02 &&
          z + dz >= w.zMin - 0.02 &&
          z + dz <= w.zMax + 0.02,
      ),
    );
    return { ok: allIndoor, indoor: true, zone: allIndoor ? centerZone : null };
  }

  // Unrestricted outdoor placement anywhere within campus site bounds and outside building walls
  const allValidOutdoor = sampleOffsets.every(([dx, dz]) => {
    const sx = x + dx;
    const sz = z + dz;
    if (!isPointWithinCampusBounds(sx, sz)) return false;
    const insideBuilding = FACILITY_ZONES.some(
      (w) => w.indoor && sx > w.xMin + 0.02 && sx < w.xMax - 0.02 && sz > w.zMin + 0.02 && sz < w.zMax - 0.02,
    );
    return !insideBuilding;
  });

  return {
    ok: allValidOutdoor,
    indoor: false,
    zone: allValidOutdoor ? describeOutdoorSector(x, z) : null,
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
 * Core solid-wall physics & magnetic flush-to-wall snap solver:
 * 1. Allows placing or moving AHUs anywhere inside the multi-wing building OR anywhere
 *    outside on the open outdoor campus grounds (no yellow-pad restriction).
 * 2. Magnetically snaps the AHU flush against any nearby wall segment (from either the
 *    indoor side OR the outdoor side!) within WALL_SNAP_RANGE.
 * 3. Iteratively resolves AABB wall & corner collisions so 0.00m wall overlap is guaranteed.
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
  },
): PlacementValidation {
  const excludeId = options?.excludeId;
  const enableWallSnap = options?.enableWallSnap !== false;
  const autoAlignRotation = options?.autoAlignRotation !== false;
  const clampVoidToWall = options?.clampVoidToWall === true;

  let rotation = normalizeRotation(options?.rotation ?? 0);

  if (!isPointWithinCampusBounds(rawX, rawZ) && !clampVoidToWall) {
    return {
      valid: false,
      snappedX: snapToPlatformGrid(rawX, 0.5),
      snappedZ: snapToPlatformGrid(rawZ, 0.5),
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

  const walls = computeExteriorWallSegments();
  let snappedToWall = false;
  let snappedWall: WallSegment | null = null;

  // Step 1: Magnetic Wall Snap check against all exterior wall segments (works on BOTH indoor & outdoor faces!)
  if (enableWallSnap) {
    let bestGap = WALL_SNAP_RANGE;
    let bestCandidate: {
      seg: WallSegment;
      side: 1 | -1;
      wallRot: number;
    } | null = null;

    for (const seg of walls) {
      if (seg.orientation === "H") {
        const minX = Math.min(seg.x1, seg.x2);
        const maxX = Math.max(seg.x1, seg.x2);
        if (workX < minX + 0.6 || workX > maxX - 0.6) continue;
        const dz = workZ - seg.z1;
        const probeSide: 1 | -1 = dz >= 0 ? 1 : -1;
        const candRot = autoAlignRotation ? (probeSide === 1 ? 0 : 180) : rotation;
        const { hz } = getAhuHalfExtents(candRot);
        const faceDist = Math.abs(Math.abs(dz) - WALL_HALF_THICK - hz);
        if (Math.abs(dz) <= WALL_HALF_THICK + hz + WALL_SNAP_RANGE && faceDist < bestGap) {
          bestGap = faceDist;
          bestCandidate = { seg, side: probeSide, wallRot: candRot };
        }
      } else {
        const minZ = Math.min(seg.z1, seg.z2);
        const maxZ = Math.max(seg.z1, seg.z2);
        if (workZ < minZ + 0.6 || workZ > maxZ - 0.6) continue;
        const dx = workX - seg.x1;
        const probeSide: 1 | -1 = dx >= 0 ? 1 : -1;
        const candRot = autoAlignRotation ? (probeSide === 1 ? 270 : 90) : rotation;
        const { hx } = getAhuHalfExtents(candRot);
        const faceDist = Math.abs(Math.abs(dx) - WALL_HALF_THICK - hx);
        if (Math.abs(dx) <= WALL_HALF_THICK + hx + WALL_SNAP_RANGE && faceDist < bestGap) {
          bestGap = faceDist;
          bestCandidate = { seg, side: probeSide, wallRot: candRot };
        }
      }
    }

    if (bestCandidate) {
      rotation = bestCandidate.wallRot;
      const { hx, hz } = getAhuHalfExtents(rotation);
      const seg = bestCandidate.seg;
      if (seg.orientation === "H") {
        const minX = Math.min(seg.x1, seg.x2) + hx + 0.24;
        const maxX = Math.max(seg.x1, seg.x2) - hx - 0.24;
        workX = minX <= maxX ? Math.min(maxX, Math.max(minX, snapToPlatformGrid(workX, 0.5))) : (seg.x1 + seg.x2) / 2;
        workZ = Number((seg.z1 + bestCandidate.side * (WALL_HALF_THICK + hz + WALL_FLUSH_GAP)).toFixed(2));
      } else {
        const minZ = Math.min(seg.z1, seg.z2) + hz + 0.24;
        const maxZ = Math.max(seg.z1, seg.z2) - hz - 0.24;
        workZ = minZ <= maxZ ? Math.min(maxZ, Math.max(minZ, snapToPlatformGrid(workZ, 0.5))) : (seg.z1 + seg.z2) / 2;
        workX = Number((seg.x1 + bestCandidate.side * (WALL_HALF_THICK + hx + WALL_FLUSH_GAP)).toFixed(2));
      }
      snappedToWall = true;
      snappedWall = seg;
    }
  }

  if (!snappedToWall) {
    workX = snapToPlatformGrid(workX, 0.5);
    workZ = snapToPlatformGrid(workZ, 0.5);
  }

  // Step 2: Iterative Solid Wall AABB Push-Out Solver (guarantees zero wall penetration!)
  const { hx, hz } = getAhuHalfExtents(rotation);
  for (let iter = 0; iter < 6; iter += 1) {
    let pushed = false;
    for (const seg of walls) {
      const wb = getWallBox(seg);
      const expandXMin = wb.xMin - hx - WALL_FLUSH_GAP;
      const expandXMax = wb.xMax + hx + WALL_FLUSH_GAP;
      const expandZMin = wb.zMin - hz - WALL_FLUSH_GAP;
      const expandZMax = wb.zMax + hz + WALL_FLUSH_GAP;

      if (workX > expandXMin && workX < expandXMax && workZ > expandZMin && workZ < expandZMax) {
        const penLeft = workX - expandXMin;
        const penRight = expandXMax - workX;
        const penTop = workZ - expandZMin;
        const penBottom = expandZMax - workZ;
        const minPen = Math.min(penLeft, penRight, penTop, penBottom);

        if (minPen === penLeft) workX = Number(expandXMin.toFixed(2));
        else if (minPen === penRight) workX = Number(expandXMax.toFixed(2));
        else if (minPen === penTop) workZ = Number(expandZMin.toFixed(2));
        else workZ = Number(expandZMax.toFixed(2));
        pushed = true;
      }
    }
    if (!pushed) break;
  }

  const footprint = isFootprintOnPlatform(workX, workZ, rotation);
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
): PlacementValidation {
  return resolveWallPhysicsAndSnap(rawX, rawZ, existing, {
    excludeId,
    rotation,
    enableWallSnap: true,
    autoAlignRotation: rotation === undefined,
    clampVoidToWall: false,
  });
}

/** Picks a clean, guaranteed non-overlapping indoor or outdoor slot for a new AHU. */
export function suggestCleanPlatformSlot(
  existing: Array<{ id: string; x: number; z: number; rotation?: number }>,
  preferIndoor = true,
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

  for (let x = -30; x <= 30; x += 4) {
    for (let z = -28; z <= 28; z += 4) {
      const res = resolveWallPhysicsAndSnap(x, z, existing, {
        enableWallSnap: true,
        autoAlignRotation: true,
        clampVoidToWall: false,
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
): AhuPlacement {
  if (
    typeof ahu.mapX === "number" &&
    Number.isFinite(ahu.mapX) &&
    typeof ahu.mapZ === "number" &&
    Number.isFinite(ahu.mapZ)
  ) {
    const zInfo = findZoneAt(ahu.mapX, ahu.mapZ);
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
    const zInfo = findZoneAt(preset.x, preset.z);
    return {
      id: ahu.id,
      x: preset.x,
      z: preset.z,
      rotation: preset.rotation,
      zone: preset.zone,
      indoor: zInfo ? zInfo.indoor : true,
    };
  }

  const fallback = suggestCleanPlatformSlot(existingResolved, true);
  return {
    id: ahu.id,
    x: fallback.x,
    z: fallback.z,
    rotation: fallback.rotation,
    zone: fallback.zone.label,
    indoor: fallback.indoor,
  };
}
