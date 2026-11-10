/**
 * Multi-branch & custom-editable 3D facility floorplan geometry,
 * polygon wall extraction, interactive wall/vertex CAD editing helpers,
 * solid wall collision physics, and magnetic flush-to-wall AHU snapping.
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

export interface FloorVertex {
  x: number;
  z: number;
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
  orientation: "H" | "V" | "A";
  edgeIndex?: number;
}

export const AHU_HALF_LENGTH = 1.55; // local X half-extent of 3.1m plinth
export const AHU_HALF_DEPTH = 0.93; // local Z half-extent of 1.85m plinth (back is local -Z)
export const WALL_HALF_THICK = 0.14; // 0.28m solid perimeter wall
export const WALL_FLUSH_GAP = 0.03; // 3cm mounting clearance when snapped flush to wall
export const WALL_SNAP_RANGE = 1.65; // magnetic snap engagement distance from wall face
export const MIN_AHU_SPACING = 3.6;

/* AC device mount physics (detailed AC models + realistic mounting):
 *   AC_SPLIT_WALL  hangs on a wall face (back plate flush against the wall)
 *   AC_DAK         sits flush against the ceiling slab (2.85 m wall height)
 *   AC_STANDING    stands on the floor on its base plinth
 */
export const AC_SPLIT_SNAP_RANGE = 2.4; // drag-to-wall engagement distance for split units
export const AC_SPLIT_HALF_WIDTH = 0.62; // along-wall half extent of a split indoor unit
export const AC_SPLIT_HALF_DEPTH = 0.14; // perpendicular half extent (body depth / 2)
export const AC_FLOOR_HALF = 0.45; // standing / cassette footprint half extent
export const AC_MIN_SPACING = 1.3; // min center distance between an AC unit and any other unit
export const CEILING_HEIGHT = 2.85; // matches RoomMeshPool WALL_HEIGHT — cassette tops flush here

/** Full 3D architectural site bounds where outdoor AHUs & room walls can be freely placed. */
export const OUTDOOR_CAMPUS_BOUNDS = {
  xMin: -42,
  xMax: 42,
  zMin: -40,
  zMax: 40,
} as const;

/**
 * Default 22-vertex closed floorplan polygon tracing the exact perimeter of our
 * 6 interconnected indoor branches (NW Cleanroom, North Alcove, Central Spine,
 * East Lab, SE Warehouse, and West Packing).
 */
export const DEFAULT_ROOM_VERTICES: FloorVertex[] = [
  { x: -20, z: -18 },
  { x: -4, z: -18 },
  { x: -4, z: -14 },
  { x: 4, z: -14 },
  { x: 4, z: -8 },
  { x: 10, z: -8 },
  { x: 10, z: -12 },
  { x: 22, z: -12 },
  { x: 22, z: 2 },
  { x: 10, z: 2 },
  { x: 10, z: 8 },
  { x: 14, z: 8 },
  { x: 14, z: 20 },
  { x: -2, z: 20 },
  { x: -2, z: 8 },
  { x: -8, z: 8 },
  { x: -8, z: 12 },
  { x: -22, z: 12 },
  { x: -22, z: 0 },
  { x: -8, z: 0 },
  { x: -8, z: -8 },
  { x: -20, z: -8 },
];

/**
 * Six interconnected indoor branches forming the default asymmetric open facility hall,
 * surrounded by open unrestricted outdoor campus grounds.
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

export function describeIndoorSector(x: number, z: number): WingZone {
  for (const w of FACILITY_ZONES) {
    if (w.indoor && x >= w.xMin && x <= w.xMax && z >= w.zMin && z <= w.zMax) {
      return w;
    }
  }
  let sector = "Central";
  if (Math.hypot(x, z) > 7) {
    if (Math.abs(x) >= Math.abs(z)) sector = x >= 0 ? "East" : "West";
    else sector = z < 0 ? "North" : "South";
  }
  return {
    id: `custom-indoor-${sector.toLowerCase()}`,
    label: `${sector} Facility Hall (Indoor)`,
    shortLabel: `${sector} Hall`,
    xMin: OUTDOOR_CAMPUS_BOUNDS.xMin,
    xMax: OUTDOOR_CAMPUS_BOUNDS.xMax,
    zMin: OUTDOOR_CAMPUS_BOUNDS.zMin,
    zMax: OUTDOOR_CAMPUS_BOUNDS.zMax,
    indoor: true,
    accent: "#2563eb",
  };
}

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
  if (step <= 0) return Number(v.toFixed(2));
  const s = Math.round(v / step) * step;
  return Number(s.toFixed(2));
}

export function normalizeRotation(deg: number): number {
  const rounded = Math.round(deg);
  const n = ((rounded % 360) + 360) % 360;
  return n === 360 ? 0 : n;
}

/** Bounding half-extents in world X/Z for any rotation angle (exact at 0/90/180/270 AND smooth for angled walls). */
export function getAhuHalfExtents(rotationDeg = 0): { hx: number; hz: number } {
  const rad = (-rotationDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return {
    hx: Number((c * AHU_HALF_LENGTH + s * AHU_HALF_DEPTH).toFixed(4)),
    hz: Number((s * AHU_HALF_LENGTH + c * AHU_HALF_DEPTH).toFixed(4)),
  };
}

/** Point-to-segment projection & distance in 2D (X, Z). */
export function projectPointToSegment(
  px: number,
  pz: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): { cx: number; cz: number; t: number; dist: number } {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-8) {
    return { cx: x1, cz: z1, t: 0, dist: Math.hypot(px - x1, pz - z1) };
  }
  const t = Math.min(1, Math.max(0, ((px - x1) * dx + (pz - z1) * dz) / lenSq));
  const cx = x1 + t * dx;
  const cz = z1 + t * dz;
  return { cx, cz, t, dist: Math.hypot(px - cx, pz - cz) };
}

/** Exact 2D polygon inclusion test (ray-casting + boundary tolerance). */
export function isPointInPolygon(
  x: number,
  z: number,
  vertices: FloorVertex[] = DEFAULT_ROOM_VERTICES,
): boolean {
  const n = vertices.length;
  if (n < 3) return false;

  for (let i = 0; i < n; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    if (projectPointToSegment(x, z, a.x, a.z, b.x, b.z).dist <= 1e-3) {
      return true;
    }
  }

  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = vertices[i].x;
    const zi = vertices[i].z;
    const xj = vertices[j].x;
    const zj = vertices[j].z;

    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function isPointInsideIndoorRoom(
  x: number,
  z: number,
  customVertices?: FloorVertex[] | null,
): boolean {
  const verts = customVertices && customVertices.length >= 3 ? customVertices : DEFAULT_ROOM_VERTICES;
  return isPointInPolygon(x, z, verts);
}

export function isPointWithinCampusBounds(x: number, z: number): boolean {
  return (
    x >= OUTDOOR_CAMPUS_BOUNDS.xMin &&
    x <= OUTDOOR_CAMPUS_BOUNDS.xMax &&
    z >= OUTDOOR_CAMPUS_BOUNDS.zMin &&
    z <= OUTDOOR_CAMPUS_BOUNDS.zMax
  );
}

export function findZoneAt(
  x: number,
  z: number,
  customVertices?: FloorVertex[] | null,
): WingZone | null {
  if (!isPointWithinCampusBounds(x, z)) return null;
  if (isPointInsideIndoorRoom(x, z, customVertices)) {
    return describeIndoorSector(x, z);
  }
  return describeOutdoorSector(x, z);
}

/** Converts any floorplan vertex loop into 3D wall segments (supports H, V, and Angled walls!). */
export function computeExteriorWallSegments(
  customVertices?: FloorVertex[] | null,
): WallSegment[] {
  const verts = customVertices && customVertices.length >= 3 ? customVertices : DEFAULT_ROOM_VERTICES;
  const segments: WallSegment[] = [];
  for (let i = 0; i < verts.length; i += 1) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const dx = Math.abs(b.x - a.x);
    const dz = Math.abs(b.z - a.z);
    if (dx < 1e-3 && dz < 1e-3) continue;
    const orientation: "H" | "V" | "A" = dz < 1e-2 ? "H" : dx < 1e-2 ? "V" : "A";
    segments.push({
      x1: a.x,
      z1: a.z,
      x2: b.x,
      z2: b.z,
      orientation,
      edgeIndex: i,
    });
  }
  return segments;
}

/** Computes signed shoelace area (and positive m² floor area) of a polygon. */
export function computePolygonAreaSqM(vertices: FloorVertex[]): number {
  if (vertices.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return Number((Math.abs(sum) * 0.5).toFixed(1));
}

function segmentsProperlyIntersect(
  a1: FloorVertex,
  a2: FloorVertex,
  b1: FloorVertex,
  b2: FloorVertex,
): boolean {
  const cross = (o: FloorVertex, p: FloorVertex, q: FloorVertex) =>
    (p.x - o.x) * (q.z - o.z) - (p.z - o.z) * (q.x - o.x);

  const d1 = cross(a1, a2, b1);
  const d2 = cross(a1, a2, b2);
  const d3 = cross(b1, b2, a1);
  const d4 = cross(b1, b2, a2);

  if (((d1 > 1e-5 && d2 < -1e-5) || (d1 < -1e-5 && d2 > 1e-5)) &&
      ((d3 > 1e-5 && d4 < -1e-5) || (d3 < -1e-5 && d4 > 1e-5))) {
    return true;
  }
  return false;
}

/** Validates a user-edited room floorplan polygon before saving or committing a wall drag. */
export function validateFloorplanPolygon(
  vertices: FloorVertex[],
): { valid: boolean; reason?: string; areaSqM: number } {
  if (!Array.isArray(vertices) || vertices.length < 3) {
    return { valid: false, reason: "Room must have at least 3 corner points.", areaSqM: 0 };
  }
  if (vertices.length > 80) {
    return { valid: false, reason: "Room cannot exceed 80 corner points.", areaSqM: 0 };
  }

  for (let i = 0; i < vertices.length; i += 1) {
    const v = vertices[i];
    if (!Number.isFinite(v.x) || !Number.isFinite(v.z)) {
      return { valid: false, reason: "Invalid vertex coordinates.", areaSqM: 0 };
    }
    if (
      v.x < OUTDOOR_CAMPUS_BOUNDS.xMin + 2 ||
      v.x > OUTDOOR_CAMPUS_BOUNDS.xMax - 2 ||
      v.z < OUTDOOR_CAMPUS_BOUNDS.zMin + 2 ||
      v.z > OUTDOOR_CAMPUS_BOUNDS.zMax - 2
    ) {
      return { valid: false, reason: "Room walls must stay inside the site boundaries.", areaSqM: 0 };
    }
    const next = vertices[(i + 1) % vertices.length];
    if (Math.hypot(next.x - v.x, next.z - v.z) < 1.0) {
      return { valid: false, reason: "Wall segment is too short (minimum 1.0 m).", areaSqM: 0 };
    }
  }

  // Non-adjacent edges must not cross each other
  const n = vertices.length;
  for (let i = 0; i < n; i += 1) {
    const a1 = vertices[i];
    const a2 = vertices[(i + 1) % n];
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      const b1 = vertices[j];
      const b2 = vertices[(j + 1) % n];
      if (segmentsProperlyIntersect(a1, a2, b1, b2)) {
        return { valid: false, reason: "Walls cannot cross over each other.", areaSqM: 0 };
      }
      // Also prevent non-adjacent vertices from collapsing onto another wall
      if (projectPointToSegment(a1.x, a1.z, b1.x, b1.z, b2.x, b2.z).dist < 0.45) {
        return { valid: false, reason: "Wall is too close to another non-adjacent wall.", areaSqM: 0 };
      }
    }
  }

  const areaSqM = computePolygonAreaSqM(vertices);
  if (areaSqM < 24) {
    return { valid: false, reason: "Indoor room area must be at least 24 m².", areaSqM };
  }

  return { valid: true, areaSqM };
}

/* ------------------------------------------------------------------ */
/* Interactive 3D Room CAD Editing Operations                         */
/* ------------------------------------------------------------------ */

/** Snapping increment matching the visible 2m × 2m indoor floor tile grid in the 3D room. */
export const ROOM_GRID_SNAP_STEP = 2;

/** Moves a single corner vertex with optional grid snapping and 1:1 cursor grab compensation. */
export function moveFloorVertex(
  vertices: FloorVertex[],
  vertexIndex: number,
  targetX: number,
  targetZ: number,
  snapStep = 0.5,
  grabDelta?: { dx: number; dz: number },
): FloorVertex[] {
  if (vertexIndex < 0 || vertexIndex >= vertices.length) return vertices;
  const grabbedX = targetX - (grabDelta?.dx ?? 0);
  const grabbedZ = targetZ - (grabDelta?.dz ?? 0);
  const x = Math.min(OUTDOOR_CAMPUS_BOUNDS.xMax - 2.5, Math.max(OUTDOOR_CAMPUS_BOUNDS.xMin + 2.5, snapToPlatformGrid(grabbedX, snapStep)));
  const z = Math.min(OUTDOOR_CAMPUS_BOUNDS.zMax - 2.5, Math.max(OUTDOOR_CAMPUS_BOUNDS.zMin + 2.5, snapToPlatformGrid(grabbedZ, snapStep)));
  const next = vertices.map((v, idx) => (idx === vertexIndex ? { x, z } : { ...v }));
  return validateFloorplanPolygon(next).valid ? next : vertices;
}

/**
 * Pushes/pulls an entire wall segment along its perpendicular normal so you can resize wings smoothly.
 * Axis-aligned walls land exactly on the visible floor grid lines when snapStep divides the grid,
 * and `grabNormalOffset` compensates for wherever on the wall the user grabbed it (1:1 drag, no jump).
 */
export function dragFloorWall(
  vertices: FloorVertex[],
  edgeIndex: number,
  targetX: number,
  targetZ: number,
  snapStep = 0.5,
  grabNormalOffset = 0,
): FloorVertex[] {
  const n = vertices.length;
  if (edgeIndex < 0 || edgeIndex >= n) return vertices;
  const i = edgeIndex;
  const j = (edgeIndex + 1) % n;
  const a = vertices[i];
  const b = vertices[j];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return vertices;

  // Normal vector perpendicular to wall
  const nx = -dz / len;
  const nz = dx / len;
  const midX = (a.x + b.x) / 2;
  const midZ = (a.z + b.z) / 2;
  const rawOffset = (targetX - midX) * nx + (targetZ - midZ) * nz - grabNormalOffset;

  let snappedOffset: number;
  const verticalWall = Math.abs(dx) < 1e-4;
  const horizontalWall = Math.abs(dz) < 1e-4;
  if (snapStep > 0 && (verticalWall || horizontalWall)) {
    // Land the wall itself exactly on a grid line (matches the visible 2m floor tile grid)
    const axisN = verticalWall ? nx : nz;
    const midCoord = verticalWall ? midX : midZ;
    const desiredMid = midCoord + axisN * rawOffset;
    snappedOffset = (snapToPlatformGrid(desiredMid, snapStep) - midCoord) * axisN;
  } else if (snapStep > 0) {
    snappedOffset = Math.round(rawOffset / snapStep) * snapStep;
  } else {
    snappedOffset = rawOffset;
  }
  if (Math.abs(snappedOffset) < 1e-4) return vertices;

  const shiftX = Number((nx * snappedOffset).toFixed(2));
  const shiftZ = Number((nz * snappedOffset).toFixed(2));

  const candidate = vertices.map((v, idx) => {
    if (idx === i || idx === j) {
      return {
        x: Number((v.x + shiftX).toFixed(2)),
        z: Number((v.z + shiftZ).toFixed(2)),
      };
    }
    return { ...v };
  });

  return validateFloorplanPolygon(candidate).valid ? candidate : vertices;
}

/** Splits a wall segment by inserting a brand-new corner point right where clicked (or at wall midpoint). */
export function insertVertexOnWall(
  vertices: FloorVertex[],
  edgeIndex: number,
  clickPoint?: { x: number; z: number },
  snapStep = 0.5,
): { vertices: FloorVertex[]; insertedIndex: number } | null {
  const n = vertices.length;
  if (edgeIndex < 0 || edgeIndex >= n || n >= 78) return null;
  const a = vertices[edgeIndex];
  const b = vertices[(edgeIndex + 1) % n];
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 2.2) return null;

  let t = 0.5;
  if (clickPoint) {
    const proj = projectPointToSegment(clickPoint.x, clickPoint.z, a.x, a.z, b.x, b.z);
    // Keep at least 1.1m from both existing corners
    const minT = 1.1 / len;
    t = Math.min(1 - minT, Math.max(minT, proj.t));
  }

  const newPt: FloorVertex = {
    x: snapToPlatformGrid(a.x + (b.x - a.x) * t, snapStep || 0.25),
    z: snapToPlatformGrid(a.z + (b.z - a.z) * t, snapStep || 0.25),
  };

  const next = [...vertices.slice(0, edgeIndex + 1), newPt, ...vertices.slice(edgeIndex + 1)];
  if (!validateFloorplanPolygon(next).valid) return null;
  return { vertices: next, insertedIndex: edgeIndex + 1 };
}

/** Extrudes a new rectangular room wing/alcove outward from any wall segment in a single click! */
export function extrudeWingOnWall(
  vertices: FloorVertex[],
  edgeIndex: number,
  depth = 4,
): FloorVertex[] | null {
  const n = vertices.length;
  if (edgeIndex < 0 || edgeIndex >= n || n >= 74) return null;
  const a = vertices[edgeIndex];
  const b = vertices[(edgeIndex + 1) % n];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 4.5) return null;

  const tx = dx / len;
  const tz = dz / len;
  // Determine outward normal (pointing outside the current polygon)
  let nx = -tz;
  let nz = tx;
  const midX = (a.x + b.x) / 2;
  const midZ = (a.z + b.z) / 2;
  if (isPointInPolygon(midX + nx * 0.6, midZ + nz * 0.6, vertices)) {
    nx = -nx;
    nz = -nz;
  }

  const inset = Math.min(2.5, len * 0.2);
  const p1: FloorVertex = {
    x: snapToPlatformGrid(a.x + tx * inset, 0.5),
    z: snapToPlatformGrid(a.z + tz * inset, 0.5),
  };
  const p4: FloorVertex = {
    x: snapToPlatformGrid(b.x - tx * inset, 0.5),
    z: snapToPlatformGrid(b.z - tz * inset, 0.5),
  };
  const p2: FloorVertex = {
    x: snapToPlatformGrid(p1.x + nx * depth, 0.5),
    z: snapToPlatformGrid(p1.z + nz * depth, 0.5),
  };
  const p3: FloorVertex = {
    x: snapToPlatformGrid(p4.x + nx * depth, 0.5),
    z: snapToPlatformGrid(p4.z + nz * depth, 0.5),
  };

  const next = [
    ...vertices.slice(0, edgeIndex + 1),
    p1,
    p2,
    p3,
    p4,
    ...vertices.slice(edgeIndex + 1),
  ];
  return validateFloorplanPolygon(next).valid ? next : null;
}

/** Deletes a corner vertex to merge adjacent walls cleanly (requires >= 4 vertices). */
export function deleteFloorVertex(
  vertices: FloorVertex[],
  vertexIndex: number,
): FloorVertex[] | null {
  if (vertices.length <= 3 || vertexIndex < 0 || vertexIndex >= vertices.length) return null;
  const next = vertices.filter((_, idx) => idx !== vertexIndex);
  return validateFloorplanPolygon(next).valid ? next : null;
}
