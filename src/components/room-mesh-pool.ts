import * as THREE from "three";
import { computeExteriorWallSegments, type FloorVertex } from "@/lib/facility-layout";

/** Room CAD tool whose gizmos the pool should currently display. */
export type RoomEditTool = "drag" | "split" | "extrude" | "delete";

export interface RoomHoverTarget {
  type: "wall" | "vertex";
  index: number;
}

export interface RoomPoolSyncState {
  editing: boolean;
  tool: RoomEditTool;
  hovered: RoomHoverTarget | null;
}

/** The shared materials owned by the 3D facility scene, reused by the pool (never disposed here). */
export interface RoomPoolMaterialSet {
  indoorSlabMat: THREE.MeshStandardMaterial;
  gridLineMat: THREE.LineBasicMaterial;
  wallMat: THREE.MeshStandardMaterial;
  wallHoverMat: THREE.MeshStandardMaterial;
  wallExtrudeMat: THREE.MeshStandardMaterial;
  wallCapMat: THREE.MeshStandardMaterial;
  basePlinthMat: THREE.MeshStandardMaterial;
  columnMat: THREE.MeshStandardMaterial;
  vertexGizmoMat: THREE.MeshStandardMaterial;
  vertexHoverMat: THREE.MeshStandardMaterial;
  vertexDeleteMat: THREE.MeshStandardMaterial;
  wallGizmoMat: THREE.MeshStandardMaterial;
  wallGizmoRingMat: THREE.MeshBasicMaterial;
}

const WALL_HEIGHT = 2.85;
const WALL_THICKNESS = 0.28;
/** Preallocated float capacity for the clipped floor grid (~96 grid lines × up to 40 clipped runs each). */
const GRID_BUFFER_FLOATS = 96 * 40 * 6;

/**
 * Writes 2m × 2m floor tile grid line segments clipped strictly inside the polygon into `out`.
 * Returns the number of floats written (segments × 2 vertices × 3 components).
 */
function writeClippedFloorGrid(vertices: FloorVertex[], out: Float32Array): number {
  const n = vertices.length;
  if (n < 3) return 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.z < minZ) minZ = v.z;
    if (v.z > maxZ) maxZ = v.z;
  }

  const y = 0.008;
  let w = 0;
  const cap = out.length - 6;

  const pushRun = (ax: number, az: number, bx: number, bz: number) => {
    if (w > cap) return;
    out[w] = ax;
    out[w + 1] = y;
    out[w + 2] = az;
    out[w + 3] = bx;
    out[w + 4] = y;
    out[w + 5] = bz;
    w += 6;
  };

  // Horizontal grid lines (constant z)
  const startZ = Math.ceil(minZ / 2) * 2;
  const endZ = Math.floor(maxZ / 2) * 2;
  for (let z = startZ; z <= endZ && w <= cap; z += 2) {
    const zProbe = z + 1e-4;
    const xs: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const a = vertices[i];
      const b = vertices[(i + 1) % n];
      if ((a.z <= zProbe && b.z > zProbe) || (b.z <= zProbe && a.z > zProbe)) {
        const t = (zProbe - a.z) / (b.z - a.z);
        xs.push(a.x + t * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) pushRun(xs[k], z, xs[k + 1], z);
  }

  // Vertical grid lines (constant x)
  const startX = Math.ceil(minX / 2) * 2;
  const endX = Math.floor(maxX / 2) * 2;
  for (let x = startX; x <= endX && w <= cap; x += 2) {
    const xProbe = x + 1e-4;
    const zs: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const a = vertices[i];
      const b = vertices[(i + 1) % n];
      if ((a.x <= xProbe && b.x > xProbe) || (b.x <= xProbe && a.x > xProbe)) {
        const t = (xProbe - a.x) / (b.x - a.x);
        zs.push(a.z + t * (b.z - a.z));
      }
    }
    zs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < zs.length; k += 2) pushRun(x, zs[k], x, zs[k + 1]);
  }

  return w;
}

interface EdgeMeshes {
  wall: THREE.Mesh;
  skirt: THREE.Mesh;
  cap: THREE.Mesh;
  puck: THREE.Mesh;
  coneA: THREE.Mesh;
  coneB: THREE.Mesh;
}

interface OrbMeshes {
  orb: THREE.Mesh;
  ring: THREE.Mesh;
}

/**
 * Persistent pooled renderer for the editable 3D room (floor slab, clipped grid, perimeter walls,
 * corner columns, and CAD gizmos). Instead of tearing down and rebuilding ~250 geometries on every
 * pointer move (the old approach — a major GC/lag source), it keeps every mesh alive and mutates
 * transforms, scales, and materials in place. Only the floor slab extrusion and the clipped grid
 * buffer are rewritten, and only when the polygon signature actually changes (throttled to at most
 * once per animation frame by the caller).
 */
export class RoomMeshPool {
  private readonly facilityGroup: THREE.Group;
  private readonly wallGizmoGroup: THREE.Group;
  private readonly vertexGizmoGroup: THREE.Group;
  private readonly mats: RoomPoolMaterialSet;

  private readonly unitBoxGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly columnGeo = new THREE.CylinderGeometry(0.22, 0.22, WALL_HEIGHT + 0.18, 16);
  private readonly orbGeo = new THREE.SphereGeometry(0.42, 20, 14);
  private readonly ringGeo = new THREE.RingGeometry(0.54, 0.72, 24).rotateX(-Math.PI / 2);
  private readonly coneGeo = new THREE.ConeGeometry(0.18, 0.38, 12);
  private readonly puckGeo = new THREE.BoxGeometry(1, 0.34, 0.68);

  private readonly slabMesh: THREE.Mesh;
  private readonly gridLines: THREE.LineSegments;
  private readonly gridBuffer = new Float32Array(GRID_BUFFER_FLOATS);

  private edges: EdgeMeshes[] = [];
  private columns: THREE.Mesh[] = [];
  private orbs: OrbMeshes[] = [];

  private lastGeoSig = "";
  private lastStateSig = "";

  constructor(
    facilityGroup: THREE.Group,
    wallGizmoGroup: THREE.Group,
    vertexGizmoGroup: THREE.Group,
    mats: RoomPoolMaterialSet,
  ) {
    this.facilityGroup = facilityGroup;
    this.wallGizmoGroup = wallGizmoGroup;
    this.vertexGizmoGroup = vertexGizmoGroup;
    this.mats = mats;

    this.slabMesh = new THREE.Mesh(new THREE.BufferGeometry(), mats.indoorSlabMat);
    this.slabMesh.position.y = -0.26;
    this.slabMesh.receiveShadow = true;
    facilityGroup.add(this.slabMesh);

    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute("position", new THREE.BufferAttribute(this.gridBuffer, 3));
    this.gridLines = new THREE.LineSegments(gridGeo, mats.gridLineMat);
    this.gridLines.frustumCulled = false;
    facilityGroup.add(this.gridLines);
  }

  private vertexSignature(vertices: FloorVertex[]): string {
    let sig = "";
    for (const v of vertices) sig += `${v.x},${v.z};`;
    return sig;
  }

  private ensureEdges(count: number) {
    while (this.edges.length < count) {
      const idx = this.edges.length;
      const wall = new THREE.Mesh(this.unitBoxGeo, this.mats.wallMat);
      wall.castShadow = true;
      wall.receiveShadow = true;
      wall.userData = { edgeIndex: idx };
      this.facilityGroup.add(wall);

      const skirt = new THREE.Mesh(this.unitBoxGeo, this.mats.basePlinthMat);
      this.facilityGroup.add(skirt);

      const cap = new THREE.Mesh(this.unitBoxGeo, this.mats.wallCapMat);
      cap.userData = { edgeIndex: idx };
      this.facilityGroup.add(cap);

      const puck = new THREE.Mesh(this.puckGeo, this.mats.wallGizmoMat);
      puck.userData = { edgeIndex: idx };
      this.wallGizmoGroup.add(puck);

      const coneA = new THREE.Mesh(this.coneGeo, this.mats.wallGizmoMat);
      coneA.userData = { edgeIndex: idx };
      this.wallGizmoGroup.add(coneA);

      const coneB = new THREE.Mesh(this.coneGeo, this.mats.wallGizmoMat);
      coneB.userData = { edgeIndex: idx };
      this.wallGizmoGroup.add(coneB);

      this.edges.push({ wall, skirt, cap, puck, coneA, coneB });
    }
  }

  private ensureColumns(count: number) {
    while (this.columns.length < count) {
      const col = new THREE.Mesh(this.columnGeo, this.mats.columnMat);
      col.castShadow = true;
      this.facilityGroup.add(col);
      this.columns.push(col);
    }
  }

  private ensureOrbs(count: number) {
    while (this.orbs.length < count) {
      const idx = this.orbs.length;
      const orb = new THREE.Mesh(this.orbGeo, this.mats.vertexGizmoMat);
      orb.userData = { vertexIndex: idx };
      this.vertexGizmoGroup.add(orb);

      const ring = new THREE.Mesh(this.ringGeo, this.mats.wallGizmoRingMat);
      ring.userData = { vertexIndex: idx };
      this.vertexGizmoGroup.add(ring);

      this.orbs.push({ orb, ring });
    }
  }

  /**
   * Idempotently syncs the pooled meshes to the given polygon + editor state.
   * Cheap no-op when nothing changed; transform/material-only work when only hover/tool changed;
   * slab & grid geometry are rebuilt exclusively when the polygon coordinates changed.
   */
  sync(vertices: FloorVertex[], state: RoomPoolSyncState) {
    const geoSig = this.vertexSignature(vertices);
    const stateSig = `${state.editing ? 1 : 0}|${state.tool}|${state.hovered ? `${state.hovered.type}${state.hovered.index}` : "-"}`;
    const geoChanged = geoSig !== this.lastGeoSig;
    const stateChanged = stateSig !== this.lastStateSig;
    if (!geoChanged && !stateChanged) return;
    this.lastGeoSig = geoSig;
    this.lastStateSig = stateSig;

    if (vertices.length < 3) {
      this.slabMesh.visible = false;
      this.gridLines.visible = false;
      for (const e of this.edges) {
        e.wall.visible = false;
        e.skirt.visible = false;
        e.cap.visible = false;
        e.puck.visible = false;
        e.coneA.visible = false;
        e.coneB.visible = false;
      }
      for (const c of this.columns) c.visible = false;
      for (const o of this.orbs) {
        o.orb.visible = false;
        o.ring.visible = false;
      }
      return;
    }
    this.slabMesh.visible = true;
    this.gridLines.visible = true;

    // 1. Floor slab extrusion + clipped 2m tile grid — rebuilt ONLY when the polygon changed
    if (geoChanged) {
      const shape = new THREE.Shape();
      shape.moveTo(vertices[0].x, -vertices[0].z);
      for (let i = 1; i < vertices.length; i += 1) {
        shape.lineTo(vertices[i].x, -vertices[i].z);
      }
      shape.closePath();
      const oldSlabGeo = this.slabMesh.geometry;
      this.slabMesh.geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.26, bevelEnabled: false });
      this.slabMesh.geometry.rotateX(-Math.PI / 2);
      if (oldSlabGeo !== this.slabMesh.geometry) oldSlabGeo.dispose();

      const written = writeClippedFloorGrid(vertices, this.gridBuffer);
      const posAttr = this.gridLines.geometry.getAttribute("position") as THREE.BufferAttribute;
      posAttr.needsUpdate = true;
      this.gridLines.geometry.setDrawRange(0, written / 3);
    }

    // 2. Walls, skirts, caps, and interactive wall gizmos — transform & material updates only
    const wallSegments = computeExteriorWallSegments(vertices);
    this.ensureEdges(wallSegments.length);
    const showWallGizmos = state.editing && (state.tool === "drag" || state.tool === "extrude");

    for (let k = 0; k < this.edges.length; k += 1) {
      const e = this.edges[k];
      const seg = wallSegments[k];
      if (!seg) {
        e.wall.visible = false;
        e.skirt.visible = false;
        e.cap.visible = false;
        e.puck.visible = false;
        e.coneA.visible = false;
        e.coneB.visible = false;
        continue;
      }

      const edgeIdx = seg.edgeIndex ?? k;
      const dx = seg.x2 - seg.x1;
      const dz = seg.z2 - seg.z1;
      const length = Math.hypot(dx, dz);
      const midX = (seg.x1 + seg.x2) / 2;
      const midZ = (seg.z1 + seg.z2) / 2;
      const angleY = -Math.atan2(dz, dx);
      const isWallHovered =
        state.editing && state.hovered?.type === "wall" && state.hovered.index === edgeIdx;

      e.wall.visible = true;
      e.wall.scale.set(length, WALL_HEIGHT, WALL_THICKNESS);
      e.wall.position.set(midX, WALL_HEIGHT / 2, midZ);
      e.wall.rotation.y = angleY;
      e.wall.material = isWallHovered
        ? state.tool === "extrude" || state.tool === "split"
          ? this.mats.wallExtrudeMat
          : this.mats.wallHoverMat
        : this.mats.wallMat;
      e.wall.userData = { edgeIndex: edgeIdx };

      e.skirt.visible = true;
      e.skirt.scale.set(length + 0.04, 0.12, WALL_THICKNESS + 0.04);
      e.skirt.position.set(midX, 0.06, midZ);
      e.skirt.rotation.y = angleY;

      e.cap.visible = true;
      e.cap.scale.set(length + 0.05, 0.09, WALL_THICKNESS + 0.05);
      e.cap.position.set(midX, WALL_HEIGHT + 0.045, midZ);
      e.cap.rotation.y = angleY;
      e.cap.userData = { edgeIndex: edgeIdx };

      const gizmoOn = showWallGizmos && length >= 1.6;
      e.puck.visible = gizmoOn;
      if (gizmoOn) {
        e.puck.scale.set(Math.min(1.3, length * 0.4), 1, 1);
        e.puck.position.set(midX, WALL_HEIGHT + 0.24, midZ);
        e.puck.rotation.y = angleY;
        e.puck.material = isWallHovered ? this.mats.wallHoverMat : this.mats.wallGizmoMat;
        e.puck.userData = { edgeIndex: edgeIdx };
      }

      const nx = -dz / length;
      const nz = dx / length;
      e.coneA.visible = gizmoOn;
      e.coneB.visible = gizmoOn;
      if (gizmoOn) {
        e.coneA.position.set(midX - nx * 0.56, WALL_HEIGHT + 0.24, midZ - nz * 0.56);
        e.coneA.rotation.set(0, -Math.atan2(-nz, -nx), -Math.PI / 2);
        e.coneA.userData = { edgeIndex: edgeIdx };
        e.coneB.position.set(midX + nx * 0.56, WALL_HEIGHT + 0.24, midZ + nz * 0.56);
        e.coneB.rotation.set(0, -Math.atan2(nz, nx), -Math.PI / 2);
        e.coneB.userData = { edgeIndex: edgeIdx };
      }
    }

    // 3. Corner columns + interactive corner orbs — transform & material updates only
    this.ensureColumns(vertices.length);
    for (let vIdx = 0; vIdx < this.columns.length; vIdx += 1) {
      const col = this.columns[vIdx];
      const v = vertices[vIdx];
      if (!v) {
        col.visible = false;
        continue;
      }
      col.visible = true;
      col.position.set(v.x, (WALL_HEIGHT + 0.18) / 2, v.z);
    }

    this.ensureOrbs(vertices.length);
    const showOrbs = state.editing && (state.tool === "drag" || state.tool === "delete");
    for (let vIdx = 0; vIdx < this.orbs.length; vIdx += 1) {
      const { orb, ring } = this.orbs[vIdx];
      const v = vertices[vIdx];
      if (!v || !showOrbs) {
        orb.visible = false;
        ring.visible = false;
        continue;
      }
      const isVertHovered =
        state.editing && state.hovered?.type === "vertex" && state.hovered.index === vIdx;
      orb.visible = true;
      ring.visible = true;
      orb.position.set(v.x, WALL_HEIGHT + 0.36, v.z);
      orb.scale.setScalar(isVertHovered ? 1.24 : 1);
      orb.material =
        state.tool === "delete"
          ? this.mats.vertexDeleteMat
          : isVertHovered
            ? this.mats.vertexHoverMat
            : this.mats.vertexGizmoMat;
      orb.userData = { vertexIndex: vIdx };
      ring.position.set(v.x, WALL_HEIGHT + 0.2, v.z);
      ring.userData = { vertexIndex: vIdx };
    }
  }

  /** Removes pooled meshes from the scene and disposes pool-owned geometries (shared scene materials are untouched). */
  dispose() {
    this.facilityGroup.clear();
    this.wallGizmoGroup.clear();
    this.vertexGizmoGroup.clear();
    this.unitBoxGeo.dispose();
    this.columnGeo.dispose();
    this.orbGeo.dispose();
    this.ringGeo.dispose();
    this.coneGeo.dispose();
    this.puckGeo.dispose();
    this.slabMesh.geometry.dispose();
    this.gridLines.geometry.dispose();
    this.edges = [];
    this.columns = [];
    this.orbs = [];
  }
}
