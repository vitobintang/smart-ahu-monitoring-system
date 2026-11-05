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
  },
): PlacementValidation {
  const excludeId = options?.excludeId;
  const enableWallSnap = options?.enableWallSnap !== false;
  const autoAlignRotation = options?.autoAlignRotation !== false;
  const clampVoidToWall = options?.clampVoidToWall === true;
  const roomVertices = options?.roomVertices;

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
    workX = snapToPlatformGrid(workX, 0.5);
    workZ = snapToPlatformGrid(workZ, 0.5);
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

