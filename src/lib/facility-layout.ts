/**
 * Multi-branch 3D facility geometry, floor platforms, exterior wall extraction,
 * and collision-safe AHU placement validation.
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
export const WALL_CLEARANCE = 1.8;
export const MIN_AHU_SPACING = 3.8;

/**
 * Six interconnected indoor branches forming one asymmetric open facility hall
 * (never a plain rectangle), plus two outdoor concrete equipment pads.
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
    accent: "#38bdf8",
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
    accent: "#22d3ee",
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
    accent: "#60a5fa",
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
    accent: "#34d399",
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
    accent: "#818cf8",
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
    accent: "#2dd4bf",
  },
  {
    id: "outdoor-east-yard",
    label: "Outdoor East Mechanical Yard",
    shortLabel: "Outdoor East Pad",
    xMin: 20,
    xMax: 34,
    zMin: 2,
    zMax: 16,
    indoor: false,
    accent: "#f59e0b",
  },
  {
    id: "outdoor-north-pad",
    label: "Outdoor North Chiller Pad",
    shortLabel: "Outdoor North Pad",
    xMin: 2,
    xMax: 18,
    zMin: -26,
    zMax: -16,
    indoor: false,
    accent: "#fb923c",
  },
];

/** Default coordinates for the 7 baseline AHU units: 5 inside branches + 2 outside. */
export const DEFAULT_AHU_PLACEMENTS: Record<
  string,
  { x: number; z: number; rotation: number; zone: string }
> = {
  "AHU-01": { x: -12, z: -13, rotation: 0, zone: "North-West Cleanroom Wing (Indoor)" },
  "AHU-02": { x: -1, z: -2, rotation: 90, zone: "Central Atrium Spine (Indoor)" },
  "AHU-03": { x: 15, z: -6, rotation: 180, zone: "East Laboratory Branch (Indoor)" },
  "AHU-04": { x: -15, z: 6, rotation: 0, zone: "West Packing Branch (Indoor)" },
  "AHU-05": { x: 6, z: 14, rotation: 270, zone: "South-East Warehouse Wing (Indoor)" },
  "AHU-06": { x: 25, z: 9, rotation: 180, zone: "Outdoor East Mechanical Yard" },
  "AHU-07": { x: 10, z: -20, rotation: 0, zone: "Outdoor North Chiller Pad" },
};

export function snapToPlatformGrid(v: number, step = 1): number {
  return Math.round(v / step) * step;
}

export function normalizeRotation(deg: number): number {
  const n = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return n === 360 ? 0 : n;
}

export function isPointInsideIndoorRoom(x: number, z: number): boolean {
  return FACILITY_ZONES.some(
    (w) => w.indoor && x >= w.xMin && x <= w.xMax && z >= w.zMin && z <= w.zMax,
  );
}

export function isPointInsideOutdoorPad(x: number, z: number): boolean {
  return FACILITY_ZONES.some(
    (w) => !w.indoor && x >= w.xMin && x <= w.xMax && z >= w.zMin && z <= w.zMax,
  );
}

export function findZoneAt(x: number, z: number): WingZone | null {
  for (const w of FACILITY_ZONES) {
    if (x >= w.xMin && x <= w.xMax && z >= w.zMin && z <= w.zMax) return w;
  }
  return null;
}

/**
 * Checks that the entire AHU mounting plinth + clearance margin stays cleanly
 * on a continuous indoor floor slab or outdoor equipment pad (never clipping walls).
 */
export function isFootprintOnPlatform(
  x: number,
  z: number,
  clearance = WALL_CLEARANCE,
): { ok: boolean; indoor: boolean; zone: WingZone | null } {
  const sampleOffsets = [
    [0, 0],
    [-clearance, -clearance],
    [clearance, -clearance],
    [-clearance, clearance],
    [clearance, clearance],
    [-clearance, 0],
    [clearance, 0],
    [0, -clearance],
    [0, clearance],
  ] as const;

  const centerZone = findZoneAt(x, z);
  if (!centerZone) return { ok: false, indoor: false, zone: null };

  if (centerZone.indoor) {
    const allIndoor = sampleOffsets.every(([dx, dz]) =>
      FACILITY_ZONES.some(
        (w) =>
          w.indoor &&
          x + dx >= w.xMin + 0.05 &&
          x + dx <= w.xMax - 0.05 &&
          z + dz >= w.zMin + 0.05 &&
          z + dz <= w.zMax - 0.05,
      ),
    );
    return { ok: allIndoor, indoor: true, zone: allIndoor ? centerZone : null };
  }

  const allOnSameOutdoorPad = sampleOffsets.every(
    ([dx, dz]) =>
      x + dx >= centerZone.xMin + 0.05 &&
      x + dx <= centerZone.xMax - 0.05 &&
      z + dz >= centerZone.zMin + 0.05 &&
      z + dz <= centerZone.zMax - 0.05,
  );
  return {
    ok: allOnSameOutdoorPad,
    indoor: false,
    zone: allOnSameOutdoorPad ? centerZone : null,
  };
}

export interface PlacementValidation {
  valid: boolean;
  snappedX: number;
  snappedZ: number;
  indoor: boolean;
  zone: WingZone | null;
  reason?: string;
}

/**
 * Clamps a hovered/clicked point inside the nearest valid platform margin when
 * close to a wall, and verifies safe separation from all existing 3D AHU units.
 */
export function validatePlatformPlacement(
  rawX: number,
  rawZ: number,
  existing: Array<{ id: string; x: number; z: number }>,
  excludeId?: string,
): PlacementValidation {
  let x = snapToPlatformGrid(rawX, 1);
  let z = snapToPlatformGrid(rawZ, 1);

  const containing = findZoneAt(rawX, rawZ);
  if (containing) {
    // Gently clamp near outer edges of the zone if that makes the footprint valid
    const clampedX = snapToPlatformGrid(
      Math.min(containing.xMax - WALL_CLEARANCE, Math.max(containing.xMin + WALL_CLEARANCE, rawX)),
      1,
    );
    const clampedZ = snapToPlatformGrid(
      Math.min(containing.zMax - WALL_CLEARANCE, Math.max(containing.zMin + WALL_CLEARANCE, rawZ)),
      1,
    );
    if (!isFootprintOnPlatform(x, z).ok && isFootprintOnPlatform(clampedX, clampedZ).ok) {
      x = clampedX;
      z = clampedZ;
    }
  }

  const footprint = isFootprintOnPlatform(x, z);
  if (!footprint.ok || !footprint.zone) {
    return {
      valid: false,
      snappedX: x,
      snappedZ: z,
      indoor: false,
      zone: null,
      reason: "Place the unit inside an indoor room wing or outdoor concrete equipment pad.",
    };
  }

  for (const unit of existing) {
    if (excludeId && unit.id === excludeId) continue;
    const dist = Math.hypot(unit.x - x, unit.z - z);
    if (dist < MIN_AHU_SPACING) {
      return {
        valid: false,
        snappedX: x,
        snappedZ: z,
        indoor: footprint.indoor,
        zone: footprint.zone,
        reason: `Maintain at least ${MIN_AHU_SPACING.toFixed(1)} m clearance from ${unit.id}.`,
      };
    }
  }

  return {
    valid: true,
    snappedX: x,
    snappedZ: z,
    indoor: footprint.indoor,
    zone: footprint.zone,
  };
}

/** Picks a clean, guaranteed non-overlapping floor platform slot for a new AHU. */
export function suggestCleanPlatformSlot(
  existing: Array<{ id: string; x: number; z: number }>,
  preferIndoor = true,
): { x: number; z: number; zone: WingZone; indoor: boolean } {
  const candidates: Array<[number, number]> = preferIndoor
    ? [
        [4, 0],
        [-5, 3],
        [0, -11],
        [17, -2],
        [-16, -13],
        [-17, 3],
        [2, 14],
        [10, 15],
        [-8, -13],
        [14, -9],
        [-12, 9],
        [5, -5],
        [23, 8],
        [7, -20],
      ]
    : [
        [30, 5],
        [22, 13],
        [31, 13],
        [5, -21],
        [15, -21],
      ];

  for (const [cx, cz] of candidates) {
    const res = validatePlatformPlacement(cx, cz, existing);
    if (res.valid && res.zone) {
      return { x: res.snappedX, z: res.snappedZ, zone: res.zone, indoor: res.indoor };
    }
  }

  // Exhaustive grid scan fallback across all platforms
  const orderedZones = [
    ...FACILITY_ZONES.filter((z) => z.indoor === preferIndoor),
    ...FACILITY_ZONES.filter((z) => z.indoor !== preferIndoor),
  ];
  for (const wz of orderedZones) {
    for (let x = wz.xMin + 2; x <= wz.xMax - 2; x += 2) {
      for (let z = wz.zMin + 2; z <= wz.zMax - 2; z += 2) {
        const res = validatePlatformPlacement(x, z, existing);
        if (res.valid && res.zone) {
          return { x: res.snappedX, z: res.snappedZ, zone: res.zone, indoor: res.indoor };
        }
      }
    }
  }

  return { x: 4, z: 0, zone: FACILITY_ZONES[0], indoor: true };
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
  existingResolved: Array<{ id: string; x: number; z: number }> = [],
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
    rotation: 0,
    zone: fallback.zone.label,
    indoor: fallback.indoor,
  };
}

/**
 * Extracts merged outer perimeter wall segments of the union of all indoor wings.
 * Internal junctions between branches have zero walls so the room is one open
 * multi-branch space.
 */
export function computeExteriorWallSegments(): WallSegment[] {
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

  // Horizontal boundary edges along each grid Z line
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

  // Vertical boundary edges along each grid X line
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

  return segments;
}
