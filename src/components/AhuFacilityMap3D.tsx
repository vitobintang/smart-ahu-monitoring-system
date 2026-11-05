"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as THREE from "three";
import {
  Check,
  Compass,
  Crosshair,
  ExternalLink,
  Eye,
  Grid,
  Layers,
  LayoutGrid,
  Magnet,
  MapPin,
  Move,
  PenTool,
  Plus,
  PlusCircle,
  RotateCcw,
  RotateCw,
  Settings2,
  Sparkles,
  SquarePlus,
  Trash2,
  Trees,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { AhuStatus } from "@/db/schema";
import { StatusBadge, cx } from "@/components/ui";
import {
  computeExteriorWallSegments,
  computePolygonAreaSqM,
  DEFAULT_ROOM_VERTICES,
  deleteFloorVertex,
  dragFloorWall,
  extrudeWingOnWall,
  generateRandomTreePool,
  insertVertexOnWall,
  isOutdoorTreeSpotClear,
  MAX_VISIBLE_OUTDOOR_TREES,
  moveFloorVertex,
  normalizeRotation,
  projectPointToSegment,
  resolveAhuPlacement,
  resolveWallPhysicsAndSnap,
  type FloorVertex,
  type OutdoorTreeCandidate,
  type PlacementValidation,
  type WallSegment,
} from "@/lib/facility-layout";

export interface FacilityAhuItem {
  ahu: {
    id: string;
    name: string;
    location: string;
    hasHeater: boolean;
    installedSensors: string[];
    setpoint: number;
    controlMode: "AUTO" | "MANUAL";
    desiredRunState: "RUN" | "STOP";
    mapX?: number | null;
    mapZ?: number | null;
    mapRotation?: number | null;
    mapZone?: string | null;
  };
  status: AhuStatus;
  lastSeenAt: string | null;
  source: string | null;
  values: Record<string, number | null>;
  activeAlarms: number;
  unackedAlarms: number;
}

export interface PendingPlacement {
  x: number;
  z: number;
  rotation: number;
  zoneLabel: string;
  indoor: boolean;
  snappedToWall?: boolean;
}

type RoomEditTool = "drag" | "split" | "extrude" | "delete";

interface Props {
  items: FacilityAhuItem[];
  mode?: "explore" | "placement";
  fullPage?: boolean;
  selectedAhuId?: string | null;
  onSelectAhu?: (id: string | null) => void;
  onOpenList?: () => void;
  onRequestAddAhu?: () => void;
  canAddAhu?: boolean;
  canMoveAhu?: boolean;
  onMoveAhuSave?: (ahuId: string, next: PendingPlacement) => Promise<void> | void;
  /** Editable 3D room floorplan props */
  roomVertices?: FloorVertex[];
  isCustomRoom?: boolean;
  canEditRoom?: boolean;
  onSaveRoomVertices?: (vertices: FloorVertex[]) => Promise<void> | void;
  onResetRoomVertices?: () => Promise<void> | void;
  /** Used in placement mode */
  draftAhuId?: string;
  draftAhuName?: string;
  placement?: PendingPlacement | null;
  onPlacementChange?: (next: PendingPlacement) => void;
}

const STATUS_HEX: Record<AhuStatus, number> = {
  RUN: 0x10b981,
  STOP: 0x64748b,
  FAULT: 0xef4444,
  OFFLINE: 0xf43f5e,
};

const STATUS_DOT_CLASS: Record<AhuStatus, string> = {
  RUN: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.75)]",
  STOP: "bg-slate-400",
  FAULT: "bg-red-500 animate-ping",
  OFFLINE: "bg-rose-500",
};

/** Procedurally generates a crisp 3D architectural tree (deciduous shade canopy or layered pine) with planter ring. */
function buildOutdoorTree3D(spec: OutdoorTreeCandidate): { group: THREE.Group; crown: THREE.Group } {
  const group = new THREE.Group();
  const s = spec.scale;

  const ringPatch = new THREE.Mesh(
    new THREE.CylinderGeometry(1.35 * s, 1.45 * s, 0.06, 20),
    new THREE.MeshStandardMaterial({ color: 0xbbf7d0, roughness: 0.92, metalness: 0.02 }),
  );
  ringPatch.position.set(0, -0.21, 0);
  ringPatch.receiveShadow = true;
  group.add(ringPatch);

  const ringCurb = new THREE.Mesh(
    new THREE.TorusGeometry(1.4 * s, 0.055, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.7, metalness: 0.1 }),
  );
  ringCurb.rotation.x = Math.PI / 2;
  ringCurb.position.set(0, -0.19, 0);
  group.add(ringCurb);

  const trunkHeight = (spec.kind === "pine" ? 1.35 : 1.55) * s;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14 * s, 0.22 * s, trunkHeight, 10),
    new THREE.MeshStandardMaterial({ color: 0x7c5338, roughness: 0.88, metalness: 0.04 }),
  );
  trunk.position.set(0, -0.2 + trunkHeight / 2, 0);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  const crown = new THREE.Group();
  crown.position.set(0, -0.2 + trunkHeight, 0);

  if (spec.kind === "pine") {
    const layers: Array<[number, number, number, number]> = [
      [1.22 * s, 1.55 * s, 0.35 * s, 0x15803d],
      [0.95 * s, 1.35 * s, 1.15 * s, 0x16a34a],
      [0.66 * s, 1.08 * s, 1.85 * s, 0x22c55e],
    ];
    for (const [radius, height, yOff, hex] of layers) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(radius, height, 9),
        new THREE.MeshStandardMaterial({ color: hex, roughness: 0.78, metalness: 0.04, flatShading: true }),
      );
      cone.position.set(0, yOff, 0);
      cone.castShadow = true;
      cone.receiveShadow = true;
      crown.add(cone);
    }
  } else {
    const lobes: Array<[number, number, number, number, number]> = [
      [0, 0.65 * s, 0, 1.05 * s, 0x16a34a],
      [-0.55 * s, 0.42 * s, 0.32 * s, 0.76 * s, 0x22c55e],
      [0.58 * s, 0.46 * s, -0.28 * s, 0.78 * s, 0x15803d],
      [0.24 * s, 0.98 * s, 0.26 * s, 0.72 * s, 0x4ade80],
      [-0.28 * s, 0.85 * s, -0.36 * s, 0.68 * s, 0x22c55e],
    ];
    for (const [lx, ly, lz, rad, hex] of lobes) {
      const puff = new THREE.Mesh(
        new THREE.IcosahedronGeometry(rad, 1),
        new THREE.MeshStandardMaterial({ color: hex, roughness: 0.76, metalness: 0.03, flatShading: true }),
      );
      puff.position.set(lx, ly, lz);
      puff.castShadow = true;
      puff.receiveShadow = true;
      crown.add(puff);
    }
  }

  crown.rotation.y = spec.rotationY;
  group.add(crown);
  group.position.set(spec.x, 0, spec.z);
  return { group, crown };
}

/** Computes clean 2m × 2m indoor floor grid line segments clipped strictly inside any polygon. */
function buildClippedFloorGridPositions(vertices: FloorVertex[]): Float32Array {
  if (vertices.length < 3) return new Float32Array(0);
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

  const coords: number[] = [];
  const y = 0.008;
  const n = vertices.length;

  // Horizontal grid lines (constant z)
  const startZ = Math.ceil(minZ / 2) * 2;
  const endZ = Math.floor(maxZ / 2) * 2;
  for (let z = startZ; z <= endZ; z += 2) {
    const zProbe = z + 1e-4; // tiny offset avoids exact vertex double-counting
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
    for (let k = 0; k + 1 < xs.length; k += 2) {
      coords.push(xs[k], y, z, xs[k + 1], y, z);
    }
  }

  // Vertical grid lines (constant x)
  const startX = Math.ceil(minX / 2) * 2;
  const endX = Math.floor(maxX / 2) * 2;
  for (let x = startX; x <= endX; x += 2) {
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
    for (let k = 0; k + 1 < zs.length; k += 2) {
      coords.push(x, y, zs[k], x, y, zs[k + 1]);
    }
  }

  return new Float32Array(coords);
}

/** Disposes geometries inside a group without destroying shared materials. */
function clearGroupGeometries(group: THREE.Group) {
  group.traverse((obj) => {
    const maybeMesh = obj as THREE.Mesh | THREE.LineSegments;
    if (maybeMesh.geometry) {
      maybeMesh.geometry.dispose();
    }
  });
  group.clear();
}

/** Builds a detailed daylight-lit industrial 3D Air Handling Unit on a raised mounting plinth. */
function buildAhuModel3D(opts: {
  id: string;
  status: AhuStatus;
  hasHeater: boolean;
  outdoor: boolean;
  dimmed?: boolean;
  isGhost?: boolean;
  isValidGhost?: boolean;
}): {
  group: THREE.Group;
  rotor: THREE.Group;
  halo: THREE.Mesh;
  beaconMat: THREE.MeshStandardMaterial;
} {
  const {
    id,
    status,
    hasHeater,
    outdoor,
    dimmed = false,
    isGhost = false,
    isValidGhost = true,
  } = opts;
  const group = new THREE.Group();
  group.userData = { ahuId: id, isAhuRoot: !isGhost };

  const transparent = isGhost || dimmed;
  const baseOpacity = isGhost ? 0.68 : dimmed ? 0.3 : 1;
  const ghostTint = !isGhost ? null : isValidGhost ? 0x10b981 : 0xef4444;

  const plinthGeo = new THREE.BoxGeometry(3.1, 0.22, 1.85);
  const plinthMat = new THREE.MeshStandardMaterial({
    color: ghostTint ?? (outdoor ? 0x334155 : 0x1e293b),
    roughness: 0.65,
    metalness: 0.3,
    transparent,
    opacity: isGhost ? 0.55 : baseOpacity,
  });
  const plinth = new THREE.Mesh(plinthGeo, plinthMat);
  plinth.position.set(0, 0.11, 0);
  plinth.castShadow = !transparent;
  plinth.receiveShadow = true;
  plinth.userData = { ahuId: id };
  group.add(plinth);

  const trimGeo = new THREE.EdgesGeometry(plinthGeo);
  const trimMat = new THREE.LineBasicMaterial({
    color: isGhost ? (isValidGhost ? 0x10b981 : 0xef4444) : outdoor ? 0x0284c7 : 0x2563eb,
    transparent: true,
    opacity: isGhost ? 0.95 : dimmed ? 0.25 : 0.65,
  });
  const trim = new THREE.LineSegments(trimGeo, trimMat);
  trim.position.copy(plinth.position);
  group.add(trim);

  const haloGeo = new THREE.RingGeometry(1.88, 2.18, 44);
  haloGeo.rotateX(-Math.PI / 2);
  const haloMat = new THREE.MeshBasicMaterial({
    color: isGhost ? (isValidGhost ? 0x10b981 : 0xef4444) : 0x2563eb,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: isGhost ? 0.85 : 0,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.set(0, 0.03, 0);
  group.add(halo);

  const casingColor = ghostTint ?? (outdoor ? 0xeef4fb : 0xffffff);
  const frameColor = ghostTint ?? 0x334155;
  const casingMat = new THREE.MeshStandardMaterial({
    color: casingColor,
    roughness: 0.34,
    metalness: 0.18,
    transparent,
    opacity: baseOpacity,
  });
  const darkFrameMat = new THREE.MeshStandardMaterial({
    color: frameColor,
    roughness: 0.48,
    metalness: 0.45,
    transparent,
    opacity: baseOpacity,
  });

  const wallFlangeMat = new THREE.MeshStandardMaterial({
    color: ghostTint ?? 0x64748b,
    roughness: 0.42,
    metalness: 0.55,
    transparent,
    opacity: baseOpacity,
  });
  const rearSupplyDuct = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.52, 0.28), wallFlangeMat);
  rearSupplyDuct.position.set(0.95, 1.12, -0.8);
  rearSupplyDuct.userData = { ahuId: id };
  group.add(rearSupplyDuct);

  const rearReturnDuct = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.48, 0.28), wallFlangeMat);
  rearReturnDuct.position.set(-0.95, 1.05, -0.8);
  rearReturnDuct.userData = { ahuId: id };
  group.add(rearReturnDuct);

  const intakeBox = new THREE.Mesh(new THREE.BoxGeometry(0.76, 1.18, 1.38), casingMat);
  intakeBox.position.set(-1.02, 0.81, 0);
  intakeBox.castShadow = !transparent;
  intakeBox.receiveShadow = true;
  intakeBox.userData = { ahuId: id };
  group.add(intakeBox);

  for (let i = -2; i <= 2; i += 1) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 1.05), darkFrameMat);
    slat.position.set(-1.42, 0.81 + i * 0.18, 0);
    slat.rotation.z = status === "RUN" ? 0.3 : 0.02;
    slat.userData = { ahuId: id };
    group.add(slat);
  }

  const coilBox = new THREE.Mesh(new THREE.BoxGeometry(1.12, 1.28, 1.44), casingMat);
  coilBox.position.set(-0.04, 0.86, 0);
  coilBox.castShadow = !transparent;
  coilBox.receiveShadow = true;
  coilBox.userData = { ahuId: id };
  group.add(coilBox);

  for (const mx of [-0.62, -0.04, 0.52]) {
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.3, 1.48), darkFrameMat);
    mullion.position.set(mx, 0.86, 0);
    mullion.userData = { ahuId: id };
    group.add(mullion);
  }

  if (!isGhost) {
    const cwSupplyMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.3,
      metalness: 0.55,
      transparent,
      opacity: baseOpacity,
    });
    const cwReturnMat = new THREE.MeshStandardMaterial({
      color: hasHeater ? 0xf97316 : 0x38bdf8,
      roughness: 0.3,
      metalness: 0.55,
      transparent,
      opacity: baseOpacity,
    });
    const pipeGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.85, 12);
    const p1 = new THREE.Mesh(pipeGeo, cwSupplyMat);
    p1.position.set(-0.22, 0.65, 0.8);
    p1.userData = { ahuId: id };
    group.add(p1);

    const p2 = new THREE.Mesh(pipeGeo, cwReturnMat);
    p2.position.set(0.16, 0.65, 0.8);
    p2.userData = { ahuId: id };
    group.add(p2);
  }

  const fanBox = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.36, 1.42), casingMat);
  fanBox.position.set(1.0, 0.9, 0);
  fanBox.castShadow = !transparent;
  fanBox.receiveShadow = true;
  fanBox.userData = { ahuId: id };
  group.add(fanBox);

  const supplyCollar = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.55, 0.86), wallFlangeMat);
  supplyCollar.position.set(1.12, 1.82, 0);
  supplyCollar.castShadow = !transparent;
  supplyCollar.userData = { ahuId: id };
  group.add(supplyCollar);

  if (outdoor && !isGhost) {
    const roofCap = new THREE.Mesh(
      new THREE.BoxGeometry(3.04, 0.09, 1.72),
      new THREE.MeshStandardMaterial({
        color: 0x64748b,
        roughness: 0.42,
        metalness: 0.45,
        transparent,
        opacity: baseOpacity,
      }),
    );
    roofCap.position.set(0, 1.61, 0);
    roofCap.userData = { ahuId: id };
    group.add(roofCap);
  }

  const portholeRing = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.04, 10, 24), darkFrameMat);
  portholeRing.position.set(1.0, 0.92, 0.72);
  portholeRing.userData = { ahuId: id };
  group.add(portholeRing);

  const boreBack = new THREE.Mesh(
    new THREE.CircleGeometry(0.3, 20),
    new THREE.MeshBasicMaterial({ color: 0x0f172a, transparent, opacity: baseOpacity }),
  );
  boreBack.position.set(1.0, 0.92, 0.715);
  boreBack.userData = { ahuId: id };
  group.add(boreBack);

  const rotor = new THREE.Group();
  rotor.position.set(1.0, 0.92, 0.73);
  const bladeMat = new THREE.MeshStandardMaterial({
    color: status === "RUN" ? 0x38bdf8 : 0x94a3b8,
    emissive: status === "RUN" ? 0x0ea5e9 : 0x000000,
    emissiveIntensity: status === "RUN" ? 0.35 : 0,
    metalness: 0.45,
    roughness: 0.3,
    transparent,
    opacity: baseOpacity,
  });
  for (let b = 0; b < 6; b += 1) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.055, 0.02), bladeMat);
    const angle = (b * Math.PI) / 3;
    blade.position.set(Math.cos(angle) * 0.13, Math.sin(angle) * 0.13, 0);
    blade.rotation.z = angle + 0.35;
    rotor.add(blade);
  }
  group.add(rotor);

  const statusColor = ghostTint ?? STATUS_HEX[status];
  const beaconMat = new THREE.MeshStandardMaterial({
    color: statusColor,
    emissive: statusColor,
    emissiveIntensity: status === "RUN" || status === "FAULT" ? 0.75 : 0.25,
    roughness: 0.2,
    transparent,
    opacity: baseOpacity,
  });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.2, 16), beaconMat);
  beacon.position.set(-0.04, 1.62, 0);
  beacon.userData = { ahuId: id };
  group.add(beacon);

  return { group, rotor, halo, beaconMat };
}

/** High-contrast architectural button styles for the Light-Mode 3D HUD toolbar. */
const hudBtnBase =
  "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11.5px] font-semibold transition-all duration-200 select-none";
const hudBtnNeutral =
  "border-[#cbd8ea] bg-white text-[#12294d] shadow-[0_1px_2px_rgba(16,24,40,0.05)] hover:border-[#93c5fd] hover:bg-[#f2f7ff] hover:text-[#1d6ef2]";
const hudBtnActiveBlue =
  "border-[#1d6ef2] bg-[#1d6ef2] text-white shadow-[0_8px_18px_-6px_rgba(29,110,242,0.7)] hover:bg-[#185fd6]";

export default function AhuFacilityMap3D({
  items,
  mode = "explore",
  fullPage = false,
  selectedAhuId: controlledSelectedId,
  onSelectAhu,
  onOpenList,
  onRequestAddAhu,
  canAddAhu = false,
  canMoveAhu = false,
  onMoveAhuSave,
  roomVertices = DEFAULT_ROOM_VERTICES,
  isCustomRoom = false,
  canEditRoom = false,
  onSaveRoomVertices,
  onResetRoomVertices,
  draftAhuId = "AHU-08",
  draftAhuName = "New Air Handling Unit",
  placement = null,
  onPlacementChange,
}: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const labelElsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const cardAnchorRef = useRef<HTMLDivElement | null>(null);
  const draftLabelRef = useRef<HTMLDivElement | null>(null);

  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const selectedId = controlledSelectedId !== undefined ? controlledSelectedId : internalSelectedId;
  const setSelectedId = useCallback(
    (id: string | null) => {
      if (onSelectAhu) onSelectAhu(id);
      else setInternalSelectedId(id);
    },
    [onSelectAhu],
  );

  const [autoRotate, setAutoRotate] = useState(false);
  const [isTopView, setIsTopView] = useState(false);
  const [wallSnapEnabled, setWallSnapEnabled] = useState(true);
  const [manualRotLocked, setManualRotLocked] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<PlacementValidation | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);

  // Interactive Move-3D-Model state (explore mode)
  const [pickToMove, setPickToMove] = useState(false);
  const [movingAhuId, setMovingAhuId] = useState<string | null>(null);
  const [moveDraft, setMoveDraft] = useState<PendingPlacement | null>(null);
  const [savingMove, setSavingMove] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  // Interactive 3D Room Editor ("Edit Room") state
  const [editingRoom, setEditingRoom] = useState(false);
  const [roomTool, setRoomTool] = useState<RoomEditTool>("drag");
  const [roomSnapGrid, setRoomSnapGrid] = useState(true);
  const [roomDraftVertices, setRoomDraftVertices] = useState<FloorVertex[]>(roomVertices);
  const [roomHistory, setRoomHistory] = useState<FloorVertex[][]>([]);
  const [hoveredRoomTarget, setHoveredRoomTarget] = useState<
    { type: "wall" | "vertex"; index: number } | null
  >(null);
  const [savingRoom, setSavingRoom] = useState(false);
  const [roomNotice, setRoomNotice] = useState<string | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);

  // Keep draft vertices synced when not actively editing
  useEffect(() => {
    if (!editingRoom) {
      setRoomDraftVertices(roomVertices);
    }
  }, [roomVertices, editingRoom]);

  const activeRoomVertices = editingRoom ? roomDraftVertices : roomVertices;
  const activeRoomAreaSqM = useMemo(
    () => computePolygonAreaSqM(activeRoomVertices),
    [activeRoomVertices],
  );

  // Resolve 3D coordinates for every AHU unit against the active room polygon
  const resolvedUnits = useMemo(() => {
    const acc: Array<{ id: string; x: number; z: number; rotation?: number }> = [];
    return items.map((item) => {
      const p = resolveAhuPlacement(item.ahu, acc, activeRoomVertices);
      acc.push({ id: item.ahu.id, x: p.x, z: p.z, rotation: p.rotation });
      return { item, placement: p };
    });
  }, [items, activeRoomVertices]);

  const existingCoords = useMemo(
    () =>
      resolvedUnits.map((u) => ({
        id: u.item.ahu.id,
        x: u.placement.x,
        z: u.placement.z,
        rotation: u.placement.rotation,
      })),
    [resolvedUnits],
  );

  const selectedUnit = useMemo(
    () => resolvedUnits.find((u) => u.item.ahu.id === selectedId) ?? null,
    [resolvedUnits, selectedId],
  );

  // Keep last selected unit mounted briefly for a silky GPU scale+fade close animation
  const [displayedCardId, setDisplayedCardId] = useState<string | null>(null);
  const [cardVisible, setCardVisible] = useState(false);

  useEffect(() => {
    const active = mode === "explore" && !movingAhuId && !editingRoom ? selectedId : null;
    if (active) {
      setDisplayedCardId(active);
      const raf = requestAnimationFrame(() => setCardVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setCardVisible(false);
    const timer = setTimeout(() => setDisplayedCardId(null), 180);
    return () => clearTimeout(timer);
  }, [selectedId, mode, movingAhuId, editingRoom]);

  const displayedCardUnit = useMemo(
    () => resolvedUnits.find((u) => u.item.ahu.id === displayedCardId) ?? null,
    [resolvedUnits, displayedCardId],
  );

  const displayedCardIdRef = useRef(displayedCardId);
  displayedCardIdRef.current = displayedCardId;

  const pushRoomUndo = useCallback((snapshot: FloorVertex[]) => {
    setRoomHistory((prev) => [...prev.slice(-29), snapshot.map((v) => ({ ...v }))]);
  }, []);

  const undoRoomEdit = useCallback(() => {
    setRoomHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRoomDraftVertices(last);
      setRoomError(null);
      setRoomNotice("Undid last wall edit.");
      return prev.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    if (!editingRoom) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undoRoomEdit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingRoom, undoRoomEdit]);

  const startEditingRoom = useCallback(() => {
    setPickToMove(false);
    setMovingAhuId(null);
    setMoveDraft(null);
    setSelectedId(null);
    setRoomDraftVertices(roomVertices.map((v) => ({ ...v })));
    setRoomHistory([]);
    setRoomTool("drag");
    setRoomError(null);
    setRoomNotice(null);
    setEditingRoom(true);
  }, [roomVertices, setSelectedId]);

  const cancelEditingRoom = useCallback(() => {
    setEditingRoom(false);
    setHoveredRoomTarget(null);
    setRoomDraftVertices(roomVertices.map((v) => ({ ...v })));
    setRoomHistory([]);
    setRoomError(null);
    setRoomNotice(null);
  }, [roomVertices]);

  const handleResetRoomToDefault = useCallback(async () => {
    pushRoomUndo(roomDraftVertices);
    setRoomDraftVertices(DEFAULT_ROOM_VERTICES.map((v) => ({ ...v })));
    setRoomError(null);
    if (isCustomRoom && onResetRoomVertices) {
      setSavingRoom(true);
      try {
        await onResetRoomVertices();
        setRoomNotice("Room reset to default multi-branch floorplan.");
      } catch (err) {
        setRoomError(err instanceof Error ? err.message : "Failed to reset room");
      } finally {
        setSavingRoom(false);
      }
    } else {
      setRoomNotice("Previewing default 22-corner multi-branch floorplan.");
    }
  }, [isCustomRoom, onResetRoomVertices, pushRoomUndo, roomDraftVertices]);

  const handleSaveRoom = useCallback(async () => {
    if (!onSaveRoomVertices) return;
    setSavingRoom(true);
    setRoomError(null);
    try {
      await onSaveRoomVertices(roomDraftVertices);
      setEditingRoom(false);
      setHoveredRoomTarget(null);
      setRoomHistory([]);
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : "Failed to save custom room geometry");
    } finally {
      setSavingRoom(false);
    }
  }, [onSaveRoomVertices, roomDraftVertices]);

  const startMovingUnit = useCallback(
    (ahuId: string) => {
      const target = resolvedUnits.find((u) => u.item.ahu.id === ahuId);
      if (!target) return;
      setEditingRoom(false);
      setPickToMove(false);
      setSelectedId(null);
      setMovingAhuId(ahuId);
      setManualRotLocked(false);
      setMoveError(null);
      setMoveDraft({
        x: target.placement.x,
        z: target.placement.z,
        rotation: target.placement.rotation,
        zoneLabel: target.placement.zone,
        indoor: target.placement.indoor,
        snappedToWall: false,
      });
    },
    [resolvedUnits, setSelectedId],
  );

  const cancelMovingUnit = useCallback(() => {
    setPickToMove(false);
    setMovingAhuId(null);
    setMoveDraft(null);
    setHoverInfo(null);
    setMoveError(null);
  }, []);

  const confirmMoveSave = useCallback(async () => {
    if (!movingAhuId || !moveDraft || !onMoveAhuSave) return;
    setSavingMove(true);
    setMoveError(null);
    try {
      await onMoveAhuSave(movingAhuId, moveDraft);
      const finishedId = movingAhuId;
      setMovingAhuId(null);
      setMoveDraft(null);
      setHoverInfo(null);
      setSelectedId(finishedId);
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : "Failed to save new 3D position");
    } finally {
      setSavingMove(false);
    }
  }, [movingAhuId, moveDraft, onMoveAhuSave, setSelectedId]);

  // Camera spherical orbit state in ref for 60fps smooth gliding & dragging
  const camStateRef = useRef({
    theta: mode === "placement" ? 0.62 : 0.72,
    phi: mode === "placement" ? 0.78 : 0.88,
    radius: mode === "placement" ? 46 : 48,
    targetX: 0,
    targetZ: -1,
    goalTheta: mode === "placement" ? 0.62 : 0.72,
    goalPhi: mode === "placement" ? 0.78 : 0.88,
    goalRadius: mode === "placement" ? 46 : 48,
    goalTargetX: 0,
    goalTargetZ: -1,
  });

  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;

  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const pickToMoveRef = useRef(pickToMove);
  pickToMoveRef.current = pickToMove;

  const movingAhuIdRef = useRef(movingAhuId);
  movingAhuIdRef.current = movingAhuId;

  const moveDraftRef = useRef(moveDraft);
  moveDraftRef.current = moveDraft;

  const editingRoomRef = useRef(editingRoom);
  editingRoomRef.current = editingRoom;

  const roomToolRef = useRef(roomTool);
  roomToolRef.current = roomTool;

  const roomSnapGridRef = useRef(roomSnapGrid);
  roomSnapGridRef.current = roomSnapGrid;

  const activeRoomVerticesRef = useRef(activeRoomVertices);
  activeRoomVerticesRef.current = activeRoomVertices;

  const pushRoomUndoRef = useRef(pushRoomUndo);
  pushRoomUndoRef.current = pushRoomUndo;

  const wallSnapRef = useRef(wallSnapEnabled);
  wallSnapRef.current = wallSnapEnabled;

  const manualRotLockedRef = useRef(manualRotLocked);
  manualRotLockedRef.current = manualRotLocked;

  const placementRef = useRef(placement);
  placementRef.current = placement;

  const existingCoordsRef = useRef(existingCoords);
  existingCoordsRef.current = existingCoords;

  const onPlacementChangeRef = useRef(onPlacementChange);
  onPlacementChangeRef.current = onPlacementChange;

  const resolvedUnitsRef = useRef(resolvedUnits);
  resolvedUnitsRef.current = resolvedUnits;

  const startMovingUnitRef = useRef(startMovingUnit);
  startMovingUnitRef.current = startMovingUnit;

  /** Smoothly glides camera to Top View or 3D Isometric View along shortest angular path. */
  const setCameraPreset = useCallback((preset: "iso" | "top") => {
    const c = camStateRef.current;
    autoRotateRef.current = false;
    setAutoRotate(false);

    let desiredTheta = 0.72;
    let nextPhi = 0.88;
    let nextRadius = 48;
    let nextTx = 0;
    let nextTz = -1;

    if (preset === "top") {
      desiredTheta = 0;
      nextPhi = 0.004;
      nextRadius = 56;
      nextTx = 0;
      nextTz = 0;
      setIsTopView(true);
    } else {
      setIsTopView(false);
    }

    let delta = (desiredTheta - c.theta) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;

    c.goalTheta = c.theta + delta;
    c.goalPhi = nextPhi;
    c.goalRadius = nextRadius;
    c.goalTargetX = nextTx;
    c.goalTargetZ = nextTz;
  }, []);

  const zoomBy = useCallback((delta: number) => {
    const c = camStateRef.current;
    c.goalRadius = Math.min(82, Math.max(15, c.goalRadius + delta));
  }, []);

  useEffect(() => {
    if (mode !== "explore" || !selectedUnit || isTopView || editingRoom) return;
    const c = camStateRef.current;
    c.goalTargetX = selectedUnit.placement.x * 0.42;
    c.goalTargetZ = selectedUnit.placement.z * 0.42;
  }, [mode, selectedUnit, isTopView, editingRoom]);

  const ahuSceneObjectsRef = useRef<{
    facilityGroup: THREE.Group;
    roomVertexGizmoGroup: THREE.Group;
    roomWallGizmoGroup: THREE.Group;
    splitPreviewOrb: THREE.Mesh;
    ahuRootGroup: THREE.Group;
    ghostGroup: THREE.Group;
    placedDraftGroup: THREE.Group;
    wallSnapLineGroup: THREE.Group;
    sharedMats: {
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
    };
    trees: Array<{
      group: THREE.Group;
      crown: THREE.Group;
      x: number;
      z: number;
      phase: number;
      targetVisible: boolean;
      currentScale: number;
    }>;
    rotors: Array<{ rotor: THREE.Group; running: boolean }>;
    halos: Map<string, THREE.Mesh>;
    beacons: Array<{ mat: THREE.MeshStandardMaterial; fault: boolean }>;
  } | null>(null);

  const updateWallSnapHighlight = useCallback((seg: WallSegment | null) => {
    const objs = ahuSceneObjectsRef.current;
    if (!objs) return;
    clearGroupGeometries(objs.wallSnapLineGroup);
    if (!seg) {
      objs.wallSnapLineGroup.visible = false;
      return;
    }
    const dx = seg.x2 - seg.x1;
    const dz = seg.z2 - seg.z1;
    const len = Math.hypot(dx, dz);
    const midX = (seg.x1 + seg.x2) / 2;
    const midZ = (seg.z1 + seg.z2) / 2;
    const angleY = -Math.atan2(dz, dx);

    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(len + 0.2, 2.96, 0.44),
      new THREE.MeshBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.32,
      }),
    );
    beam.position.set(midX, 1.48, midZ);
    beam.rotation.y = angleY;
    objs.wallSnapLineGroup.add(beam);

    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(len + 0.28, 0.15, 0.52),
      new THREE.MeshBasicMaterial({ color: 0x059669 }),
    );
    rail.position.set(midX, 2.95, midZ);
    rail.rotation.y = angleY;
    objs.wallSnapLineGroup.add(rail);
    objs.wallSnapLineGroup.visible = true;
  }, []);

  // Initialize Three.js WebGL stage once
  useEffect(() => {
    const container = mountRef.current;
    const stageEl = viewportRef.current ?? container;
    if (!container || !stageEl) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      setWebglError("3D WebGL context could not be initialized on this device.");
      return;
    }

    const domEl = renderer.domElement;
    domEl.style.display = "block";
    domEl.style.width = "100%";
    domEl.style.height = "100%";

    const initialRect = stageEl.getBoundingClientRect();
    const initW = Math.max(320, Math.round(initialRect.width || window.innerWidth));
    const initH = Math.max(320, Math.round(initialRect.height || window.innerHeight - 120));

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(initW, initH, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    container.innerHTML = "";
    container.appendChild(domEl);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeaf1fb);
    scene.fog = new THREE.FogExp2(0xeaf1fb, 0.0033);

    const camera = new THREE.PerspectiveCamera(42, initW / initH, 0.5, 260);

    const hemi = new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 1.25);
    hemi.position.set(0, 50, 0);
    scene.add(hemi);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.35);
    sunLight.position.set(28, 44, 24);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 5;
    sunLight.shadow.camera.far = 140;
    const d = 48;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0004;
    scene.add(sunLight);

    const skyFillLight = new THREE.DirectionalLight(0x93c5fd, 0.45);
    skyFillLight.position.set(-30, 22, -24);
    scene.add(skyFillLight);

    // Open Exterior Grounds
    const groundGeo = new THREE.PlaneGeometry(190, 190);
    groundGeo.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({ color: 0xe2ece9, roughness: 0.92, metalness: 0.03 }),
    );
    ground.position.y = -0.265;
    ground.receiveShadow = true;
    scene.add(ground);

    const campusGrid = new THREE.GridHelper(160, 80, 0xc1d3e6, 0xd4e2ef);
    campusGrid.position.y = -0.245;
    scene.add(campusGrid);

    const facilityGroup = new THREE.Group();
    const roomWallGizmoGroup = new THREE.Group();
    const roomVertexGizmoGroup = new THREE.Group();
    scene.add(facilityGroup);
    scene.add(roomWallGizmoGroup);
    scene.add(roomVertexGizmoGroup);

    const splitPreviewOrb = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 20, 20),
      new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x059669,
        emissiveIntensity: 0.65,
        roughness: 0.2,
      }),
    );
    splitPreviewOrb.visible = false;
    scene.add(splitPreviewOrb);

    const sharedMats = {
      indoorSlabMat: new THREE.MeshStandardMaterial({
        color: 0xf9fbff,
        roughness: 0.48,
        metalness: 0.06,
      }),
      gridLineMat: new THREE.LineBasicMaterial({
        color: 0xbfdbfe,
        transparent: true,
        opacity: 0.65,
      }),
      wallMat: new THREE.MeshStandardMaterial({
        color: 0xcbdcf4,
        roughness: 0.34,
        metalness: 0.1,
        transparent: true,
        opacity: 0.72,
      }),
      wallHoverMat: new THREE.MeshStandardMaterial({
        color: 0x3b82f6,
        emissive: 0x1d4ed8,
        emissiveIntensity: 0.35,
        roughness: 0.25,
        metalness: 0.15,
        transparent: true,
        opacity: 0.85,
      }),
      wallExtrudeMat: new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x059669,
        emissiveIntensity: 0.35,
        roughness: 0.25,
        metalness: 0.15,
        transparent: true,
        opacity: 0.86,
      }),
      wallCapMat: new THREE.MeshStandardMaterial({
        color: 0x2563eb,
        roughness: 0.32,
        metalness: 0.35,
      }),
      basePlinthMat: new THREE.MeshStandardMaterial({
        color: 0x64748b,
        roughness: 0.55,
        metalness: 0.25,
      }),
      columnMat: new THREE.MeshStandardMaterial({
        color: 0x64748b,
        roughness: 0.45,
        metalness: 0.35,
      }),
      vertexGizmoMat: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x2563eb,
        emissiveIntensity: 0.38,
        roughness: 0.2,
        metalness: 0.1,
      }),
      vertexHoverMat: new THREE.MeshStandardMaterial({
        color: 0x2563eb,
        emissive: 0x1d4ed8,
        emissiveIntensity: 0.65,
        roughness: 0.18,
      }),
      vertexDeleteMat: new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xb91c1c,
        emissiveIntensity: 0.55,
        roughness: 0.2,
      }),
      wallGizmoMat: new THREE.MeshStandardMaterial({
        color: 0x1d6ef2,
        emissive: 0x1e40af,
        emissiveIntensity: 0.4,
        roughness: 0.24,
      }),
      wallGizmoRingMat: new THREE.MeshBasicMaterial({
        color: 0x2563eb,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.72,
      }),
    };

    // Randomized sparse 3D Outdoor Trees + dormant seeds that sprout/disappear automatically as the room shrinks or expands
    const landscapeGroup = new THREE.Group();
    const randomTreePool = generateRandomTreePool(
      activeRoomVerticesRef.current,
      existingCoordsRef.current,
    );
    const treeEntries: Array<{
      group: THREE.Group;
      crown: THREE.Group;
      x: number;
      z: number;
      phase: number;
      targetVisible: boolean;
      currentScale: number;
    }> = [];
    let initialShown = 0;
    for (let idx = 0; idx < randomTreePool.length; idx += 1) {
      const spec = randomTreePool[idx];
      const builtTree = buildOutdoorTree3D(spec);
      const isClear =
        initialShown < MAX_VISIBLE_OUTDOOR_TREES &&
        isOutdoorTreeSpotClear(
          spec.x,
          spec.z,
          activeRoomVerticesRef.current,
          existingCoordsRef.current,
        );
      if (isClear) initialShown += 1;
      builtTree.group.visible = isClear;
      builtTree.group.scale.setScalar(isClear ? 1 : 0.001);
      landscapeGroup.add(builtTree.group);
      treeEntries.push({
        group: builtTree.group,
        crown: builtTree.crown,
        x: spec.x,
        z: spec.z,
        phase: idx * 0.9,
        targetVisible: isClear,
        currentScale: isClear ? 1 : 0,
      });
    }
    scene.add(landscapeGroup);

    const ahuRootGroup = new THREE.Group();
    const ghostGroup = new THREE.Group();
    ghostGroup.visible = false;
    const placedDraftGroup = new THREE.Group();
    placedDraftGroup.visible = false;
    const wallSnapLineGroup = new THREE.Group();
    wallSnapLineGroup.visible = false;

    scene.add(ahuRootGroup);
    scene.add(ghostGroup);
    scene.add(placedDraftGroup);
    scene.add(wallSnapLineGroup);

    ahuSceneObjectsRef.current = {
      facilityGroup,
      roomVertexGizmoGroup,
      roomWallGizmoGroup,
      splitPreviewOrb,
      ahuRootGroup,
      ghostGroup,
      placedDraftGroup,
      wallSnapLineGroup,
      sharedMats,
      trees: treeEntries,
      rotors: [],
      halos: new Map(),
      beacons: [],
    };

    // Raycaster + Pointer Physics (Orbit / Pan / Direct AHU Drag / Direct Wall & Vertex CAD Drag!)
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const planeHit = new THREE.Vector3();

    let isDragging = false;
    let isDraggingModelDirectly = false;
    let draggingRoomElement:
      | {
          type: "wall" | "vertex";
          index: number;
          startVertices: FloorVertex[];
          undoRecorded: boolean;
        }
      | null = null;
    let dragButton = 0;
    let downX = 0;
    let downY = 0;
    let lastX = 0;
    let lastY = 0;
    let movedDist = 0;
    let lastWallClickAt = 0;
    let lastWallClickedIdx = -1;

    const updateNdc = (clientX: number, clientY: number) => {
      const rect = domEl.getBoundingClientRect();
      pointerNdc.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    };

    const evaluatePhysicsAtRay = () => {
      const activeMovingId = mode === "explore" ? movingAhuIdRef.current : undefined;
      const currentDraft = mode === "placement" ? placementRef.current : moveDraftRef.current;
      const baseRot = currentDraft?.rotation ?? 0;

      return resolveWallPhysicsAndSnap(planeHit.x, planeHit.z, existingCoordsRef.current, {
        excludeId: activeMovingId ?? undefined,
        rotation: baseRot,
        enableWallSnap: wallSnapRef.current,
        autoAlignRotation: wallSnapRef.current && !manualRotLockedRef.current,
        clampVoidToWall: true,
        roomVertices: activeRoomVerticesRef.current,
      });
    };

    const applyGhostPreview = (check: PlacementValidation) => {
      setHoverInfo(check);
      updateWallSnapHighlight(check.snappedToWall ? check.snappedWall : null);
      const objs = ahuSceneObjectsRef.current;
      if (!objs) return;
      objs.ghostGroup.clear();
      const built = buildAhuModel3D({
        id: "GHOST",
        status: "RUN",
        hasHeater: false,
        outdoor: !check.indoor,
        isGhost: true,
        isValidGhost: check.valid,
      });
      built.group.rotation.y = (-check.rotation * Math.PI) / 180;
      objs.ghostGroup.add(built.group);
      objs.ghostGroup.position.set(check.snappedX, 0, check.snappedZ);
      objs.ghostGroup.visible = true;
    };

    const commitPlacementFromCheck = (check: PlacementValidation) => {
      if (!check.valid || !check.zone) return;
      const next: PendingPlacement = {
        x: check.snappedX,
        z: check.snappedZ,
        rotation: check.rotation,
        zoneLabel: check.zone.label,
        indoor: check.indoor,
        snappedToWall: check.snappedToWall,
      };
      if (mode === "placement") {
        onPlacementChangeRef.current?.(next);
      } else if (movingAhuIdRef.current) {
        setMoveDraft(next);
      }
    };

    const findHitRoomVertex = (): number | null => {
      const objs = ahuSceneObjectsRef.current;
      if (!objs) return null;
      const hits = raycaster.intersectObjects(objs.roomVertexGizmoGroup.children, true);
      for (const h of hits) {
        if (typeof h.object.userData?.vertexIndex === "number") {
          return h.object.userData.vertexIndex as number;
        }
      }
      return null;
    };

    const findHitRoomWall = (): { edgeIndex: number; point: THREE.Vector3 } | null => {
      const objs = ahuSceneObjectsRef.current;
      if (!objs) return null;
      const gizmoHits = raycaster.intersectObjects(objs.roomWallGizmoGroup.children, true);
      for (const h of gizmoHits) {
        if (typeof h.object.userData?.edgeIndex === "number") {
          return { edgeIndex: h.object.userData.edgeIndex as number, point: h.point };
        }
      }
      const wallHits = raycaster.intersectObjects(objs.facilityGroup.children, true);
      for (const h of wallHits) {
        if (typeof h.object.userData?.edgeIndex === "number") {
          return { edgeIndex: h.object.userData.edgeIndex as number, point: h.point };
        }
      }
      return null;
    };

    const handlePointerDown = (e: PointerEvent) => {
      isDragging = true;
      isDraggingModelDirectly = false;
      draggingRoomElement = null;
      dragButton = e.button;
      downX = e.clientX;
      downY = e.clientY;
      lastX = e.clientX;
      lastY = e.clientY;
      movedDist = 0;
      autoRotateRef.current = false;
      setAutoRotate(false);

      if (editingRoomRef.current && e.button === 0) {
        updateNdc(e.clientX, e.clientY);
        raycaster.setFromCamera(pointerNdc, camera);
        const tool = roomToolRef.current;

        if (tool === "drag") {
          const vIdx = findHitRoomVertex();
          if (vIdx !== null) {
            draggingRoomElement = {
              type: "vertex",
              index: vIdx,
              startVertices: activeRoomVerticesRef.current.map((v) => ({ ...v })),
              undoRecorded: false,
            };
            domEl.style.cursor = "grabbing";
            domEl.setPointerCapture?.(e.pointerId);
            return;
          }
          const wHit = findHitRoomWall();
          if (wHit !== null) {
            draggingRoomElement = {
              type: "wall",
              index: wHit.edgeIndex,
              startVertices: activeRoomVerticesRef.current.map((v) => ({ ...v })),
              undoRecorded: false,
            };
            domEl.style.cursor = "grabbing";
            domEl.setPointerCapture?.(e.pointerId);
            return;
          }
        }
      }

      const isEditingPlacement = mode === "placement" || Boolean(movingAhuIdRef.current);
      if (isEditingPlacement && e.button === 0 && !editingRoomRef.current) {
        updateNdc(e.clientX, e.clientY);
        raycaster.setFromCamera(pointerNdc, camera);
        const objs = ahuSceneObjectsRef.current;
        if (objs && objs.placedDraftGroup.visible) {
          const hits = raycaster.intersectObjects(objs.placedDraftGroup.children, true);
          if (hits.length > 0) {
            isDraggingModelDirectly = true;
            domEl.style.cursor = "grabbing";
          }
        }
      }

      domEl.setPointerCapture?.(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
      const isEditingPlacement = mode === "placement" || Boolean(movingAhuIdRef.current);

      if (isDragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        movedDist += Math.hypot(dx, dy);

        // Direct 3D Wall or Corner Vertex CAD Dragging!
        if (draggingRoomElement && editingRoomRef.current) {
          updateNdc(e.clientX, e.clientY);
          raycaster.setFromCamera(pointerNdc, camera);
          if (raycaster.ray.intersectPlane(floorPlane, planeHit)) {
            const snapStep = roomSnapGridRef.current ? 0.5 : 0.05;
            const nextVerts =
              draggingRoomElement.type === "vertex"
                ? moveFloorVertex(
                    draggingRoomElement.startVertices,
                    draggingRoomElement.index,
                    planeHit.x,
                    planeHit.z,
                    snapStep,
                  )
                : dragFloorWall(
                    draggingRoomElement.startVertices,
                    draggingRoomElement.index,
                    planeHit.x,
                    planeHit.z,
                    snapStep,
                  );

            if (nextVerts !== draggingRoomElement.startVertices) {
              if (!draggingRoomElement.undoRecorded) {
                pushRoomUndoRef.current(draggingRoomElement.startVertices);
                draggingRoomElement.undoRecorded = true;
              }
              setRoomError(null);
              setRoomDraftVertices(nextVerts);
            }
          }
          return;
        }

        if (isDraggingModelDirectly && isEditingPlacement) {
          updateNdc(e.clientX, e.clientY);
          raycaster.setFromCamera(pointerNdc, camera);
          if (raycaster.ray.intersectPlane(floorPlane, planeHit)) {
            const check = evaluatePhysicsAtRay();
            setHoverInfo(check);
            updateWallSnapHighlight(check.snappedToWall ? check.snappedWall : null);
            commitPlacementFromCheck(check);
          }
          return;
        }

        const c = camStateRef.current;
        if (dragButton === 2 || e.shiftKey) {
          const panScale = c.goalRadius * 0.0016;
          const sinT = Math.sin(c.theta);
          const cosT = Math.cos(c.theta);
          c.goalTargetX = Math.min(34, Math.max(-34, c.goalTargetX - (dx * cosT + dy * sinT) * panScale));
          c.goalTargetZ = Math.min(32, Math.max(-32, c.goalTargetZ - (-dx * sinT + dy * cosT) * panScale));
        } else {
          c.goalTheta -= dx * 0.0072;
          c.goalPhi = Math.min(1.36, Math.max(0.05, c.goalPhi - dy * 0.0065));
          if (c.goalPhi > 0.14) setIsTopView(false);
        }
        return;
      }

      updateNdc(e.clientX, e.clientY);
      raycaster.setFromCamera(pointerNdc, camera);

      // Room Editor hover feedback (vertex handles, wall handles, split preview orb)
      if (editingRoomRef.current) {
        const objs = ahuSceneObjectsRef.current;
        const tool = roomToolRef.current;
        if (objs) objs.splitPreviewOrb.visible = false;

        if (tool === "delete") {
          const vIdx = findHitRoomVertex();
          setHoveredRoomTarget(vIdx !== null ? { type: "vertex", index: vIdx } : null);
          domEl.style.cursor = vIdx !== null ? "pointer" : "grab";
          return;
        }

        if (tool === "split") {
          const wHit = findHitRoomWall();
          if (wHit && objs) {
            const verts = activeRoomVerticesRef.current;
            const a = verts[wHit.edgeIndex];
            const b = verts[(wHit.edgeIndex + 1) % verts.length];
            if (a && b) {
              const proj = projectPointToSegment(wHit.point.x, wHit.point.z, a.x, a.z, b.x, b.z);
              objs.splitPreviewOrb.position.set(proj.cx, 2.98, proj.cz);
              objs.splitPreviewOrb.visible = true;
            }
            setHoveredRoomTarget({ type: "wall", index: wHit.edgeIndex });
            domEl.style.cursor = "copy";
          } else {
            setHoveredRoomTarget(null);
            domEl.style.cursor = "grab";
          }
          return;
        }

        if (tool === "extrude") {
          const wHit = findHitRoomWall();
          setHoveredRoomTarget(wHit ? { type: "wall", index: wHit.edgeIndex } : null);
          domEl.style.cursor = wHit ? "cell" : "grab";
          return;
        }

        // Default "drag" tool: check vertices first, then walls
        const vIdx = findHitRoomVertex();
        if (vIdx !== null) {
          setHoveredRoomTarget({ type: "vertex", index: vIdx });
          domEl.style.cursor = "move";
          return;
        }
        const wHit = findHitRoomWall();
        if (wHit !== null) {
          setHoveredRoomTarget({ type: "wall", index: wHit.edgeIndex });
          domEl.style.cursor = "ew-resize";
          return;
        }
        setHoveredRoomTarget(null);
        domEl.style.cursor = "grab";
        return;
      }

      if (isEditingPlacement) {
        const objs = ahuSceneObjectsRef.current;
        if (objs && objs.placedDraftGroup.visible) {
          const draftHits = raycaster.intersectObjects(objs.placedDraftGroup.children, true);
          if (draftHits.length > 0) {
            domEl.style.cursor = "grab";
            objs.ghostGroup.visible = false;
            return;
          }
        }
        if (raycaster.ray.intersectPlane(floorPlane, planeHit)) {
          const check = evaluatePhysicsAtRay();
          applyGhostPreview(check);
          domEl.style.cursor = check.valid ? "crosshair" : "not-allowed";
        }
      } else {
        const objs = ahuSceneObjectsRef.current;
        if (objs) {
          const hits = raycaster.intersectObjects(objs.ahuRootGroup.children, true);
          domEl.style.cursor = hits.length > 0 ? "pointer" : "grab";
        }
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const wasDraggingModel = isDraggingModelDirectly;
      const finishedRoomDrag = draggingRoomElement;
      if (isDragging) {
        isDragging = false;
        isDraggingModelDirectly = false;
        draggingRoomElement = null;
        domEl.releasePointerCapture?.(e.pointerId);
      }

      const clickDelta = Math.hypot(e.clientX - downX, e.clientY - downY);
      const isCleanClick = movedDist < 6 && clickDelta < 6 && e.button === 0;

      // Room Editor click actions (Split Wall, Extrude Wing, Delete Corner, or Double-Click Wall to Split!)
      if (editingRoomRef.current && isCleanClick) {
        updateNdc(e.clientX, e.clientY);
        raycaster.setFromCamera(pointerNdc, camera);
        const tool = roomToolRef.current;
        const verts = activeRoomVerticesRef.current;
        const snapStep = roomSnapGridRef.current ? 0.5 : 0.05;

        if (tool === "split") {
          const wHit = findHitRoomWall();
          if (wHit) {
            const res = insertVertexOnWall(
              verts,
              wHit.edgeIndex,
              { x: wHit.point.x, z: wHit.point.z },
              snapStep,
            );
            if (res) {
              pushRoomUndoRef.current(verts);
              setRoomDraftVertices(res.vertices);
              setRoomTool("drag");
              setRoomError(null);
              setRoomNotice("New corner point added — drag it or any adjacent wall to sculpt.");
            } else {
              setRoomError("Wall segment is too short to split further.");
            }
          }
          return;
        }

        if (tool === "extrude") {
          const wHit = findHitRoomWall();
          if (wHit) {
            const next = extrudeWingOnWall(verts, wHit.edgeIndex, 4);
            if (next) {
              pushRoomUndoRef.current(verts);
              setRoomDraftVertices(next);
              setRoomTool("drag");
              setRoomError(null);
              setRoomNotice("New room wing extruded — drag its walls to customize dimensions.");
            } else {
              setRoomError("Select an exterior wall at least 4.5m long with clear outdoor space.");
            }
          }
          return;
        }

        if (tool === "delete") {
          const vIdx = findHitRoomVertex();
          if (vIdx !== null) {
            const next = deleteFloorVertex(verts, vIdx);
            if (next) {
              pushRoomUndoRef.current(verts);
              setRoomDraftVertices(next);
              setHoveredRoomTarget(null);
              setRoomError(null);
              setRoomNotice("Corner point removed.");
            } else {
              setRoomError("Cannot delete this corner without causing walls to cross.");
            }
          }
          return;
        }

        // Double-click shortcut on any wall in Drag mode to insert a new corner point!
        if (tool === "drag" && finishedRoomDrag?.type === "wall") {
          const now = performance.now();
          if (now - lastWallClickAt < 340 && lastWallClickedIdx === finishedRoomDrag.index) {
            const wHit = findHitRoomWall();
            const res = insertVertexOnWall(
              verts,
              finishedRoomDrag.index,
              wHit ? { x: wHit.point.x, z: wHit.point.z } : undefined,
              snapStep,
            );
            if (res) {
              pushRoomUndoRef.current(verts);
              setRoomDraftVertices(res.vertices);
              setRoomNotice("Corner point created on wall — drag it freely!");
            }
            lastWallClickAt = 0;
            lastWallClickedIdx = -1;
            return;
          }
          lastWallClickAt = now;
          lastWallClickedIdx = finishedRoomDrag.index;
        }
        return;
      }

      if (finishedRoomDrag || wasDraggingModel) {
        domEl.style.cursor = "grab";
        return;
      }

      if (isCleanClick) {
        updateNdc(e.clientX, e.clientY);
        raycaster.setFromCamera(pointerNdc, camera);

        const isEditingPlacement = mode === "placement" || Boolean(movingAhuIdRef.current);
        if (isEditingPlacement) {
          if (raycaster.ray.intersectPlane(floorPlane, planeHit)) {
            const check = evaluatePhysicsAtRay();
            setHoverInfo(check);
            updateWallSnapHighlight(check.snappedToWall ? check.snappedWall : null);
            commitPlacementFromCheck(check);
          }
        } else {
          const objs = ahuSceneObjectsRef.current;
          if (objs) {
            const hits = raycaster.intersectObjects(objs.ahuRootGroup.children, true);
            let clickedId: string | null = null;
            for (const h of hits) {
              let cur: THREE.Object3D | null = h.object;
              while (cur) {
                if (cur.userData?.ahuId) {
                  clickedId = String(cur.userData.ahuId);
                  break;
                }
                cur = cur.parent;
              }
              if (clickedId) break;
            }
            if (clickedId && pickToMoveRef.current) {
              startMovingUnitRef.current(clickedId);
            } else {
              setSelectedId(clickedId === selectedIdRef.current ? null : clickedId);
            }
          }
        }
      }
    };

    const handlePointerLeave = () => {
      const objs = ahuSceneObjectsRef.current;
      if (objs) {
        objs.ghostGroup.visible = false;
        objs.wallSnapLineGroup.visible = false;
        objs.splitPreviewOrb.visible = false;
      }
      setHoveredRoomTarget(null);
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = camStateRef.current;
      c.goalRadius = Math.min(82, Math.max(15, c.goalRadius + e.deltaY * 0.028));
    };

    const handleContextMenu = (e: MouseEvent) => e.preventDefault();

    domEl.addEventListener("pointerdown", handlePointerDown);
    domEl.addEventListener("pointermove", handlePointerMove);
    domEl.addEventListener("pointerup", handlePointerUp);
    domEl.addEventListener("pointerleave", handlePointerLeave);
    domEl.addEventListener("wheel", handleWheel, { passive: false });
    domEl.addEventListener("contextmenu", handleContextMenu);

    const syncRendererSize = () => {
      const rect = stageEl.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w < 40 || h < 40) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };

    const resizeObserver = new ResizeObserver(syncRendererSize);
    resizeObserver.observe(stageEl);
    window.addEventListener("resize", syncRendererSize);
    const initRaf = requestAnimationFrame(syncRendererSize);

    let rafId = 0;
    const projVec = new THREE.Vector3();
    const clock = new THREE.Clock();

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min(0.05, clock.getDelta());
      const elapsed = clock.elapsedTime;

      const c = camStateRef.current;
      if (autoRotateRef.current && !isDragging) {
        c.goalTheta += dt * 0.16;
      }

      const speed = isDragging ? 15 : 4.2;
      const damp = 1 - Math.exp(-dt * speed);
      c.theta += (c.goalTheta - c.theta) * damp;
      c.phi += (c.goalPhi - c.phi) * damp;
      c.radius += (c.goalRadius - c.radius) * damp;
      c.targetX += (c.goalTargetX - c.targetX) * damp;
      c.targetZ += (c.goalTargetZ - c.targetZ) * damp;

      const sinPhi = Math.sin(Math.max(0.002, c.phi));
      camera.position.set(
        c.targetX + c.radius * sinPhi * Math.sin(c.theta),
        c.radius * Math.cos(Math.max(0.002, c.phi)),
        c.targetZ + c.radius * sinPhi * Math.cos(c.theta),
      );
      camera.lookAt(c.targetX, 0.5, c.targetZ);

      const objs = ahuSceneObjectsRef.current;
      if (objs) {
        for (const r of objs.rotors) {
          if (r.running) r.rotor.rotation.z -= dt * 7.5;
        }
        for (const t of objs.trees) {
          const goal = t.targetVisible ? 1 : 0;
          if (Math.abs(t.currentScale - goal) > 0.002) {
            const rate = goal > t.currentScale ? 9.5 : 12.5;
            t.currentScale += (goal - t.currentScale) * (1 - Math.exp(-dt * rate));
            const s = Math.max(0.001, t.currentScale);
            t.group.scale.setScalar(s);
            t.group.visible = t.currentScale > 0.015;
          } else {
            t.currentScale = goal;
            t.group.visible = goal > 0.5;
            if (t.group.visible) t.group.scale.setScalar(1);
          }
          if (t.group.visible) {
            t.crown.rotation.z = Math.sin(elapsed * 1.25 + t.phase) * 0.016;
          }
        }
        for (const [id, haloMesh] of objs.halos.entries()) {
          const mat = haloMesh.material as THREE.MeshBasicMaterial;
          const isSel = id === selectedIdRef.current && !editingRoomRef.current;
          mat.opacity = isSel ? 0.65 + Math.sin(elapsed * 4) * 0.2 : 0;
        }
        for (const b of objs.beacons) {
          if (b.fault) {
            b.mat.emissiveIntensity = 0.4 + Math.abs(Math.sin(elapsed * 5.5)) * 1.0;
          }
        }
      }

      renderer.render(scene, camera);

      const cw = domEl.clientWidth;
      const ch = domEl.clientHeight;
      for (const u of resolvedUnitsRef.current) {
        const el = labelElsRef.current.get(u.item.ahu.id);
        if (!el) continue;
        const isHidden =
          u.item.ahu.id === movingAhuIdRef.current ||
          (mode === "explore" && !editingRoomRef.current && u.item.ahu.id === selectedIdRef.current);
        if (isHidden) {
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
          continue;
        }
        projVec.set(u.placement.x, 2.52, u.placement.z);
        projVec.project(camera);
        if (projVec.z < -1 || projVec.z > 1) {
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
          continue;
        }
        const sx = (projVec.x * 0.5 + 0.5) * cw;
        const sy = (-projVec.y * 0.5 + 0.5) * ch;
        el.style.opacity = editingRoomRef.current ? "0.45" : "1";
        el.style.pointerEvents =
          mode === "explore" && !movingAhuIdRef.current && !editingRoomRef.current ? "auto" : "none";
        el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
      }

      if (cardAnchorRef.current && displayedCardIdRef.current) {
        const cardOwner = resolvedUnitsRef.current.find((u) => u.item.ahu.id === displayedCardIdRef.current);
        if (cardOwner) {
          projVec.set(cardOwner.placement.x, 2.65, cardOwner.placement.z);
          projVec.project(camera);
          const rawX = (projVec.x * 0.5 + 0.5) * cw;
          const rawY = (-projVec.y * 0.5 + 0.5) * ch;
          const clampedX = Math.min(Math.max(162, rawX), Math.max(162, cw - 162));
          const clampedY = Math.min(Math.max(235, rawY), Math.max(235, ch - 20));
          cardAnchorRef.current.style.transform = `translate3d(${clampedX.toFixed(1)}px, ${clampedY.toFixed(1)}px, 0) translate(-50%, -100%)`;
        }
      }

      const activeDraft = mode === "placement" ? placementRef.current : moveDraftRef.current;
      if (draftLabelRef.current && activeDraft) {
        projVec.set(activeDraft.x, 2.62, activeDraft.z);
        projVec.project(camera);
        const sx = (projVec.x * 0.5 + 0.5) * cw;
        const sy = (-projVec.y * 0.5 + 0.5) * ch;
        draftLabelRef.current.style.opacity = "1";
        draftLabelRef.current.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
      }
    };

    animate();

    return () => {
      cancelAnimationFrame(initRaf);
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncRendererSize);
      domEl.removeEventListener("pointerdown", handlePointerDown);
      domEl.removeEventListener("pointermove", handlePointerMove);
      domEl.removeEventListener("pointerup", handlePointerUp);
      domEl.removeEventListener("pointerleave", handlePointerLeave);
      domEl.removeEventListener("wheel", handleWheel);
      domEl.removeEventListener("contextmenu", handleContextMenu);
      renderer.dispose();
      ahuSceneObjectsRef.current = null;
    };
  }, [mode, setSelectedId, updateWallSnapHighlight]);

  // Dynamically rebuild the 3D Room Floor Slab, Clipped Grid, Arbitrary-Angle Walls & Interactive CAD Handles!
  useEffect(() => {
    const objs = ahuSceneObjectsRef.current;
    if (!objs || activeRoomVertices.length < 3) return;

    clearGroupGeometries(objs.facilityGroup);
    clearGroupGeometries(objs.roomWallGizmoGroup);
    clearGroupGeometries(objs.roomVertexGizmoGroup);

    const { sharedMats } = objs;

    // 1. Extruded Cleanroom Floor Slab for ANY custom polygon
    const shape = new THREE.Shape();
    shape.moveTo(activeRoomVertices[0].x, -activeRoomVertices[0].z);
    for (let i = 1; i < activeRoomVertices.length; i += 1) {
      shape.lineTo(activeRoomVertices[i].x, -activeRoomVertices[i].z);
    }
    shape.closePath();

    const slabGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.26, bevelEnabled: false });
    slabGeo.rotateX(-Math.PI / 2);
    const slabMesh = new THREE.Mesh(slabGeo, sharedMats.indoorSlabMat);
    slabMesh.position.y = -0.26;
    slabMesh.receiveShadow = true;
    objs.facilityGroup.add(slabMesh);

    // 2. Clean 2m × 2m floor tile grid clipped to the custom polygon
    const gridCoords = buildClippedFloorGridPositions(activeRoomVertices);
    if (gridCoords.length > 0) {
      const gridGeo = new THREE.BufferGeometry();
      gridGeo.setAttribute("position", new THREE.BufferAttribute(gridCoords, 3));
      objs.facilityGroup.add(new THREE.LineSegments(gridGeo, sharedMats.gridLineMat));
    }

    // 3. Oriented Frosted Architectural Perimeter Walls (supports H, V, & Diagonal walls!)
    const wallSegments = computeExteriorWallSegments(activeRoomVertices);
    const wallHeight = 2.85;
    const wallThickness = 0.28;

    for (const seg of wallSegments) {
      const edgeIdx = seg.edgeIndex ?? 0;
      const dx = seg.x2 - seg.x1;
      const dz = seg.z2 - seg.z1;
      const length = Math.hypot(dx, dz);
      const midX = (seg.x1 + seg.x2) / 2;
      const midZ = (seg.z1 + seg.z2) / 2;
      const angleY = -Math.atan2(dz, dx);

      const isWallHovered =
        editingRoom && hoveredRoomTarget?.type === "wall" && hoveredRoomTarget.index === edgeIdx;
      const chosenWallMat = isWallHovered
        ? roomTool === "extrude" || roomTool === "split"
          ? sharedMats.wallExtrudeMat
          : sharedMats.wallHoverMat
        : sharedMats.wallMat;

      const wallMesh = new THREE.Mesh(
        new THREE.BoxGeometry(length, wallHeight, wallThickness),
        chosenWallMat,
      );
      wallMesh.position.set(midX, wallHeight / 2, midZ);
      wallMesh.rotation.y = angleY;
      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;
      wallMesh.userData = { edgeIndex: edgeIdx };
      objs.facilityGroup.add(wallMesh);

      const baseSkirt = new THREE.Mesh(
        new THREE.BoxGeometry(length + 0.04, 0.12, wallThickness + 0.04),
        sharedMats.basePlinthMat,
      );
      baseSkirt.position.set(midX, 0.06, midZ);
      baseSkirt.rotation.y = angleY;
      objs.facilityGroup.add(baseSkirt);

      const capMesh = new THREE.Mesh(
        new THREE.BoxGeometry(length + 0.05, 0.09, wallThickness + 0.05),
        sharedMats.wallCapMat,
      );
      capMesh.position.set(midX, wallHeight + 0.045, midZ);
      capMesh.rotation.y = angleY;
      capMesh.userData = { edgeIndex: edgeIdx };
      objs.facilityGroup.add(capMesh);

      // Interactive Wall Push/Pull Midpoint Handle when Edit Room is active
      if (editingRoom && (roomTool === "drag" || roomTool === "extrude") && length >= 1.6) {
        const puck = new THREE.Mesh(
          new THREE.BoxGeometry(Math.min(1.3, length * 0.4), 0.34, 0.68),
          isWallHovered ? sharedMats.wallHoverMat : sharedMats.wallGizmoMat,
        );
        puck.position.set(midX, wallHeight + 0.24, midZ);
        puck.rotation.y = angleY;
        puck.userData = { edgeIndex: edgeIdx };
        objs.roomWallGizmoGroup.add(puck);

        // Bidirectional push/pull arrow cones perpendicular to wall
        const nx = -dz / length;
        const nz = dx / length;
        for (const side of [-1, 1]) {
          const cone = new THREE.Mesh(
            new THREE.ConeGeometry(0.18, 0.38, 12),
            sharedMats.wallGizmoMat,
          );
          cone.position.set(midX + nx * side * 0.56, wallHeight + 0.24, midZ + nz * side * 0.56);
          cone.rotation.z = -Math.PI / 2;
          cone.rotation.y = -Math.atan2(nz * side, nx * side);
          cone.userData = { edgeIndex: edgeIdx };
          objs.roomWallGizmoGroup.add(cone);
        }
      }
    }

    // 4. Rounded Corner Columns + Interactive Corner Vertex Handles
    for (let vIdx = 0; vIdx < activeRoomVertices.length; vIdx += 1) {
      const v = activeRoomVertices[vIdx];
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, wallHeight + 0.18, 16),
        sharedMats.columnMat,
      );
      col.position.set(v.x, (wallHeight + 0.18) / 2, v.z);
      col.castShadow = true;
      objs.facilityGroup.add(col);

      if (editingRoom && (roomTool === "drag" || roomTool === "delete")) {
        const isVertHovered =
          hoveredRoomTarget?.type === "vertex" && hoveredRoomTarget.index === vIdx;
        const handleMat =
          roomTool === "delete"
            ? sharedMats.vertexDeleteMat
            : isVertHovered
              ? sharedMats.vertexHoverMat
              : sharedMats.vertexGizmoMat;

        const orb = new THREE.Mesh(
          new THREE.SphereGeometry(isVertHovered ? 0.52 : 0.42, 20, 20),
          handleMat,
        );
        orb.position.set(v.x, wallHeight + 0.36, v.z);
        orb.userData = { vertexIndex: vIdx };
        objs.roomVertexGizmoGroup.add(orb);

        const ringGeo = new THREE.RingGeometry(0.54, 0.72, 24);
        ringGeo.rotateX(-Math.PI / 2);
        const ring = new THREE.Mesh(ringGeo, sharedMats.wallGizmoRingMat);
        ring.position.set(v.x, wallHeight + 0.2, v.z);
        ring.userData = { vertexIndex: vIdx };
        objs.roomVertexGizmoGroup.add(ring);
      }
    }
  }, [activeRoomVertices, editingRoom, roomTool, hoveredRoomTarget]);

  // Automatically sprout or hide outdoor trees in real time as the room shrinks/expands or AHUs move!
  useEffect(() => {
    const objs = ahuSceneObjectsRef.current;
    if (!objs) return;
    const activeDraft = mode === "placement" ? placement : moveDraft;
    const occupiedAhuPoints = resolvedUnits
      .filter((u) => u.item.ahu.id !== movingAhuId)
      .map((u) => ({ x: u.placement.x, z: u.placement.z }));
    if (activeDraft) {
      occupiedAhuPoints.push({ x: activeDraft.x, z: activeDraft.z });
    }

    let shownCount = 0;
    for (const t of objs.trees) {
      const clear =
        shownCount < MAX_VISIBLE_OUTDOOR_TREES &&
        isOutdoorTreeSpotClear(t.x, t.z, activeRoomVertices, occupiedAhuPoints);
      if (clear) shownCount += 1;
      t.targetVisible = clear;
    }
  }, [resolvedUnits, placement, moveDraft, mode, movingAhuId, activeRoomVertices]);

  // Rebuild 3D AHU models whenever unit statuses, positions, or moving state change
  useEffect(() => {
    const objs = ahuSceneObjectsRef.current;
    if (!objs) return;
    objs.ahuRootGroup.clear();
    objs.rotors = [];
    objs.halos.clear();
    objs.beacons = [];

    for (const { item, placement: pos } of resolvedUnits) {
      const isBeingMoved = item.ahu.id === movingAhuId;
      const built = buildAhuModel3D({
        id: item.ahu.id,
        status: item.status,
        hasHeater: item.ahu.hasHeater,
        outdoor: !pos.indoor,
        dimmed: isBeingMoved,
      });
      built.group.position.set(pos.x, 0, pos.z);
      built.group.rotation.y = (-pos.rotation * Math.PI) / 180;
      objs.ahuRootGroup.add(built.group);
      objs.rotors.push({ rotor: built.rotor, running: item.status === "RUN" && !isBeingMoved });
      objs.halos.set(item.ahu.id, built.halo);
      objs.beacons.push({ mat: built.beaconMat, fault: item.status === "FAULT" && !isBeingMoved });
    }
  }, [resolvedUnits, movingAhuId]);

  // Sync placed draft 3D AHU model (both in Add-AHU placement mode AND in Move-AHU mode)
  useEffect(() => {
    const objs = ahuSceneObjectsRef.current;
    if (!objs) return;
    objs.placedDraftGroup.clear();
    const activeDraft = mode === "placement" ? placement : moveDraft;
    const activeId = mode === "placement" ? draftAhuId : movingAhuId;
    if (!activeDraft || !activeId) {
      objs.placedDraftGroup.visible = false;
      objs.ghostGroup.visible = false;
      objs.wallSnapLineGroup.visible = false;
      return;
    }
    const movingSource = resolvedUnits.find((u) => u.item.ahu.id === activeId);
    const built = buildAhuModel3D({
      id: activeId,
      status: movingSource?.item.status ?? "RUN",
      hasHeater: movingSource?.item.ahu.hasHeater ?? true,
      outdoor: !activeDraft.indoor,
    });
    built.halo.material = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
    });
    built.group.rotation.y = (-activeDraft.rotation * Math.PI) / 180;
    objs.placedDraftGroup.add(built.group);
    objs.placedDraftGroup.position.set(activeDraft.x, 0, activeDraft.z);
    objs.placedDraftGroup.visible = true;
  }, [mode, placement, moveDraft, draftAhuId, movingAhuId, resolvedUnits]);

  const indoorCount = resolvedUnits.filter((u) => u.placement.indoor).length;
  const outdoorCount = resolvedUnits.length - indoorCount;

  const rotateActiveDraft90 = () => {
    setManualRotLocked(true);
    if (mode === "placement" && placement && onPlacementChange) {
      const nextRot = normalizeRotation(placement.rotation + 90);
      const check = resolveWallPhysicsAndSnap(placement.x, placement.z, existingCoords, {
        rotation: nextRot,
        enableWallSnap: wallSnapEnabled,
        autoAlignRotation: false,
        clampVoidToWall: true,
        roomVertices: activeRoomVertices,
      });
      onPlacementChange({
        x: check.snappedX,
        z: check.snappedZ,
        rotation: check.rotation,
        zoneLabel: check.zone?.label ?? placement.zoneLabel,
        indoor: check.indoor,
        snappedToWall: check.snappedToWall,
      });
    } else if (movingAhuId && moveDraft) {
      const nextRot = normalizeRotation(moveDraft.rotation + 90);
      const check = resolveWallPhysicsAndSnap(moveDraft.x, moveDraft.z, existingCoords, {
        excludeId: movingAhuId,
        rotation: nextRot,
        enableWallSnap: wallSnapEnabled,
        autoAlignRotation: false,
        clampVoidToWall: true,
        roomVertices: activeRoomVertices,
      });
      setMoveDraft({
        x: check.snappedX,
        z: check.snappedZ,
        rotation: check.rotation,
        zoneLabel: check.zone?.label ?? moveDraft.zoneLabel,
        indoor: check.indoor,
        snappedToWall: check.snappedToWall,
      });
    }
  };

  if (webglError) {
    return (
      <div className="rounded-2xl border border-[#dbe4f0] bg-white p-6 text-center text-xs text-slate-600">
        {webglError}
      </div>
    );
  }

  return (
    <div
      className={cx(
        "flex flex-col overflow-hidden",
        fullPage
          ? "absolute inset-0 h-full w-full bg-transparent"
          : "relative rounded-2xl border border-[#d6e2f2] bg-[#eaf1fb] shadow-[0_18px_42px_-20px_rgba(18,41,77,0.24)]",
      )}
    >
      {/* Translucent Frosted Architectural Top HUD Bar (harmonizes with Mountain Topbar above) */}
      <div className="z-20 flex flex-none flex-wrap items-center justify-between gap-2 border-y border-[#dbe5f2]/90 bg-white/84 px-3.5 py-2.5 shadow-[0_4px_20px_-14px_rgba(18,41,77,0.16)] backdrop-blur-md sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-[#eef4ff] text-[#1d6ef2] ring-1 ring-[#bfd6fb]">
            <Layers size={16} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[14px] font-bold tracking-tight text-[#12294d] sm:text-[15.5px]">
                {editingRoom
                  ? "3D Room Architect · Edit Walls & Corners"
                  : mode === "placement"
                    ? "Place New 3D AHU · Indoor or Outdoor"
                    : movingAhuId
                      ? `Moving ${movingAhuId} in 3D Facility`
                      : "AHU Units · 3D Facility Digital Twin"}
              </h1>
              <span className="hidden rounded-full border border-[#cbe0fd] bg-[#eef5ff] px-2.5 py-0.5 font-mono text-[10px] font-bold text-[#1d6ef2] md:inline-flex">
                {editingRoom
                  ? `${activeRoomAreaSqM} m² · ${activeRoomVertices.length} Corners`
                  : `${indoorCount} Indoor · ${outdoorCount} Outdoor`}
              </span>
            </div>
            <p className="truncate text-[11px] text-[#475569]">
              {editingRoom
                ? "Drag any wall or corner orb · double-click a wall to add a point · extrude new wings in 1 click"
                : mode === "placement" || movingAhuId
                  ? "Place inside any wing or anywhere outside · solid walls snap flush & prevent clipping"
                  : pickToMove
                    ? "Click any 3D AHU model (or its name badge) to drag & move it indoors or anywhere outdoors"
                    : "Drag to rotate 360° · scroll to zoom · click any 3D AHU to view live status & controls"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Open Classic AHU Units List View */}
          {mode === "explore" && !editingRoom && onOpenList ? (
            <button
              type="button"
              onClick={onOpenList}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#9ec2fb] bg-[#eaf2ff] px-3 py-1.5 text-[11.5px] font-bold text-[#1456c7] shadow-[0_1px_2px_rgba(29,110,242,0.08)] transition-all hover:border-[#60a5fa] hover:bg-[#dceaff]"
              title="Open AHU Units Fleet List"
            >
              <LayoutGrid size={13} /> AHU List ({items.length})
            </button>
          ) : null}

          {/* Smooth Animated Top View Camera Glide */}
          <button
            type="button"
            onClick={() => setCameraPreset(isTopView ? "iso" : "top")}
            className={cx(hudBtnBase, isTopView ? hudBtnActiveBlue : hudBtnNeutral)}
            title="Smoothly glide camera to overhead Top View"
          >
            <Eye size={13} /> Top View
          </button>

          <button
            type="button"
            onClick={() => setCameraPreset("iso")}
            className={cx(hudBtnBase, !isTopView ? "border-[#bfd6fb] bg-[#f4f8ff] text-[#1d6ef2]" : hudBtnNeutral)}
            title="Smoothly glide camera to 3D isometric angle"
          >
            <RotateCcw size={12} /> <span className="hidden sm:inline">3D View</span>
          </button>

          {/* Wall Snap & Rotate Controls in Placement / Move Mode */}
          {mode === "placement" || movingAhuId ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setWallSnapEnabled((v) => !v);
                  setManualRotLocked(false);
                }}
                className={cx(
                  hudBtnBase,
                  wallSnapEnabled
                    ? "border-emerald-600 bg-emerald-600 text-white shadow-[0_6px_16px_-6px_rgba(5,150,105,0.65)]"
                    : hudBtnNeutral,
                )}
                title="Toggle magnetic flush-to-wall snapping"
              >
                <Magnet size={12} /> Snap: {wallSnapEnabled ? "ON" : "OFF"}
              </button>
              <button
                type="button"
                onClick={rotateActiveDraft90}
                className={cx(hudBtnBase, hudBtnNeutral)}
                title="Rotate 3D AHU by 90°"
              >
                <RotateCw size={12} /> {(mode === "placement" ? placement?.rotation : moveDraft?.rotation) ?? 0}°
              </button>
            </>
          ) : null}

          {/* Edit 3D Room Button */}
          {mode === "explore" && canEditRoom && !movingAhuId ? (
            <button
              type="button"
              onClick={() => (editingRoom ? cancelEditingRoom() : startEditingRoom())}
              className={cx(
                hudBtnBase,
                editingRoom
                  ? "border-indigo-600 bg-indigo-600 text-white shadow-[0_8px_18px_-6px_rgba(79,70,229,0.75)]"
                  : hudBtnNeutral,
              )}
              title="Reshape the 3D facility room: drag walls, add/move corners, or extrude wings"
            >
              <PenTool size={13} /> {editingRoom ? "Exit Room Editor" : "Edit Room"}
            </button>
          ) : null}

          {/* Move 3D Model Button */}
          {mode === "explore" && canMoveAhu && !movingAhuId && !editingRoom ? (
            <button
              type="button"
              onClick={() => {
                if (selectedId) startMovingUnit(selectedId);
                else setPickToMove((v) => !v);
              }}
              className={cx(
                hudBtnBase,
                pickToMove
                  ? "border-amber-500 bg-amber-500 text-white shadow-[0_6px_16px_-6px_rgba(245,158,11,0.7)]"
                  : hudBtnNeutral,
              )}
              title="Move a 3D AHU model indoors or anywhere outdoors"
            >
              <Move size={13} /> {pickToMove ? "Cancel Pick" : selectedId ? `Move ${selectedId}` : "Move AHU"}
            </button>
          ) : null}

          {mode === "explore" && !movingAhuId && !editingRoom ? (
            <button
              type="button"
              onClick={() => setAutoRotate((v) => !v)}
              className={cx(hudBtnBase, "hidden lg:inline-flex", autoRotate ? hudBtnActiveBlue : hudBtnNeutral)}
              title="Toggle 360° turntable orbit"
            >
              <Compass size={13} /> Orbit
            </button>
          ) : null}

          <div className="hidden items-center overflow-hidden rounded-xl border border-[#cbd8ea] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)] sm:inline-flex">
            <button
              type="button"
              onClick={() => zoomBy(-6)}
              className="px-2.5 py-1.5 text-[#12294d] transition hover:bg-[#f2f7ff] hover:text-[#1d6ef2]"
              aria-label="Zoom in"
            >
              <ZoomIn size={13} />
            </button>
            <button
              type="button"
              onClick={() => zoomBy(6)}
              className="border-l border-[#e2e8f0] px-2.5 py-1.5 text-[#12294d] transition hover:bg-[#f2f7ff] hover:text-[#1d6ef2]"
              aria-label="Zoom out"
            >
              <ZoomOut size={13} />
            </button>
          </div>

          {mode === "explore" && canAddAhu && onRequestAddAhu && !movingAhuId && !editingRoom ? (
            <button
              type="button"
              onClick={onRequestAddAhu}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#2563eb] to-[#1d6ef2] px-3.5 py-1.5 text-[11.5px] font-bold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.85)] transition hover:brightness-105"
            >
              <Plus size={14} /> Add New AHU
            </button>
          ) : null}
        </div>
      </div>

      {/* Interactive 3D Room Architect CAD Sub-Toolbar */}
      {mode === "explore" && editingRoom ? (
        <div className="z-20 flex flex-none flex-wrap items-center justify-between gap-2 border-b border-indigo-200 bg-indigo-50/95 px-3.5 py-2 text-[11.5px] text-[#12294d] backdrop-blur-md sm:px-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setRoomTool("drag");
                setRoomError(null);
              }}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1 font-bold transition",
                roomTool === "drag"
                  ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                  : "border-indigo-200 bg-white text-[#12294d] hover:bg-indigo-100/60",
              )}
              title="Drag walls to push/pull wings, or drag corner orbs to reshape angles"
            >
              <Move size={12} /> Drag Walls &amp; Corners
            </button>

            <button
              type="button"
              onClick={() => {
                setRoomTool("split");
                setRoomError(null);
                setRoomNotice("Click anywhere along a wall to insert a new corner point.");
              }}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1 font-bold transition",
                roomTool === "split"
                  ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                  : "border-indigo-200 bg-white text-[#12294d] hover:bg-indigo-100/60",
              )}
              title="Click any wall to split it and create a new draggable corner point"
            >
              <PlusCircle size={12} /> + Add Corner
            </button>

            <button
              type="button"
              onClick={() => {
                setRoomTool("extrude");
                setRoomError(null);
                setRoomNotice("Click any wall (≥4.5m) to extrude a new 4m room wing outward.");
              }}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1 font-bold transition",
                roomTool === "extrude"
                  ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                  : "border-indigo-200 bg-white text-[#12294d] hover:bg-indigo-100/60",
              )}
              title="Click any exterior wall to pop out a new rectangular room wing"
            >
              <SquarePlus size={12} /> Extrude Wing
            </button>

            <button
              type="button"
              onClick={() => {
                setRoomTool("delete");
                setRoomError(null);
                setRoomNotice("Click any red corner orb to remove that point.");
              }}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1 font-bold transition",
                roomTool === "delete"
                  ? "border-red-600 bg-red-600 text-white shadow-sm"
                  : "border-indigo-200 bg-white text-[#12294d] hover:bg-indigo-100/60",
              )}
              title="Click a corner orb to delete it and merge adjacent walls"
            >
              <Trash2 size={12} /> Delete Corner
            </button>

            <span className="mx-1 hidden h-4 w-px bg-indigo-200 sm:inline-block" />

            <button
              type="button"
              onClick={() => setRoomSnapGrid((v) => !v)}
              className={cx(
                "inline-flex items-center gap-1 rounded-xl border px-2.5 py-1 font-semibold transition",
                roomSnapGrid
                  ? "border-blue-300 bg-blue-100/90 text-[#12294d]"
                  : "border-slate-300 bg-white text-slate-600",
              )}
              title="Snap wall & corner drags to clean 0.5m architectural increments"
            >
              <Grid size={12} /> {roomSnapGrid ? "Snap 0.5m" : "Freeform"}
            </button>

            <button
              type="button"
              disabled={roomHistory.length === 0}
              onClick={undoRoomEdit}
              className="inline-flex items-center gap-1 rounded-xl border border-indigo-200 bg-white px-2.5 py-1 font-semibold text-[#12294d] transition hover:bg-slate-50 disabled:opacity-40"
              title="Undo last room edit (Ctrl+Z)"
            >
              <Undo2 size={12} /> Undo
            </button>

            <button
              type="button"
              disabled={savingRoom}
              onClick={() => void handleResetRoomToDefault()}
              className="inline-flex items-center gap-1 rounded-xl border border-indigo-200 bg-white px-2.5 py-1 font-semibold text-slate-700 transition hover:bg-slate-50"
              title="Restore default 22-corner multi-branch floorplan"
            >
              <RotateCcw size={11} /> Default
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {roomError ? (
              <span className="font-semibold text-red-600">{roomError}</span>
            ) : roomNotice ? (
              <span className="hidden font-medium text-indigo-800 xl:inline">{roomNotice}</span>
            ) : null}

            <button
              type="button"
              disabled={savingRoom}
              onClick={cancelEditingRoom}
              className="rounded-xl border border-[#cbd8ea] bg-white px-3 py-1 font-semibold text-[#12294d] transition hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={savingRoom}
              onClick={() => void handleSaveRoom()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1 font-bold text-white shadow-sm transition hover:bg-indigo-700"
            >
              <Check size={13} /> {savingRoom ? "Saving…" : "Save Room"}
            </button>
          </div>
        </div>
      ) : null}

      {/* Action Bar while Moving an Existing 3D AHU */}
      {mode === "explore" && movingAhuId && moveDraft ? (
        <div className="z-20 flex flex-none flex-wrap items-center justify-between gap-2 border-b border-emerald-200 bg-emerald-50/95 px-4 py-2 text-[11.5px] text-emerald-950 backdrop-blur-md">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-0.5 font-mono text-[11px] font-bold text-white">
              <Move size={11} /> {movingAhuId}
            </span>
            <span>
              <strong className="text-[#12294d]">{moveDraft.zoneLabel}</strong> ·{" "}
              <span className="font-mono text-emerald-800">
                (X {moveDraft.x}m, Z {moveDraft.z}m · {moveDraft.rotation}°)
              </span>
              {moveDraft.snappedToWall ? (
                <span className="ml-2 rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                  Snapped Flush to Wall
                </span>
              ) : null}
            </span>
            {moveError ? <span className="font-semibold text-red-600">· {moveError}</span> : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={savingMove}
              onClick={cancelMovingUnit}
              className="rounded-xl border border-[#cbd8ea] bg-white px-3 py-1 font-semibold text-[#12294d] transition hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={savingMove}
              onClick={() => void confirmMoveSave()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1 font-bold text-white shadow-sm transition hover:bg-emerald-700"
            >
              <Check size={13} /> {savingMove ? "Saving…" : "Save 3D Position"}
            </button>
          </div>
        </div>
      ) : null}

      {/* Full-Height 3D WebGL Stage + Lightweight GPU-Smooth Badges & Card */}
      <div
        ref={viewportRef}
        className={cx(
          "relative w-full select-none overflow-hidden bg-[#eaf1fb]",
          fullPage
            ? "min-h-0 flex-1"
            : mode === "placement"
              ? "h-[360px] sm:h-[420px]"
              : "h-[450px] sm:h-[530px]",
        )}
      >
        <div ref={mountRef} className="absolute inset-0 h-full w-full touch-none" />

        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {/* Compact Floating Name Pills */}
          {resolvedUnits.map(({ item, placement: pos }) => {
            const shortName = item.ahu.name.replace(new RegExp(`^${item.ahu.id}\\s*[-·]?\\s*`, "i"), "").trim();
            return (
              <button
                key={item.ahu.id}
                type="button"
                ref={(el) => {
                  if (el) labelElsRef.current.set(item.ahu.id, el);
                  else labelElsRef.current.delete(item.ahu.id);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (mode !== "explore" || editingRoom) return;
                  if (pickToMove) startMovingUnit(item.ahu.id);
                  else setSelectedId(item.ahu.id);
                }}
                style={{ left: 0, top: 0, opacity: 0 }}
                className={cx(
                  "absolute z-10 flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-left backdrop-blur-md transition-[opacity,border-color,background-color] duration-150 will-change-transform",
                  pickToMove
                    ? "border-amber-400 bg-amber-50/95 text-[#12294d] shadow-[0_8px_20px_-8px_rgba(245,158,11,0.4)] hover:bg-amber-100"
                    : "border-[#cbd8ea] bg-white/92 text-[#12294d] shadow-[0_8px_20px_-8px_rgba(18,41,77,0.2)] hover:border-[#60a5fa] hover:bg-white",
                )}
              >
                <span className={cx("h-2 w-2 flex-none rounded-full", STATUS_DOT_CLASS[item.status])} />
                <span className="font-mono text-[11px] font-extrabold tracking-tight text-[#12294d]">
                  {item.ahu.id}
                </span>
                {shortName ? (
                  <span className="hidden max-w-[115px] truncate text-[10.5px] font-medium text-[#475569] sm:inline">
                    · {shortName}
                  </span>
                ) : null}
                {!pos.indoor ? (
                  <span className="rounded-full bg-emerald-100 px-1.5 py-0.2 text-[8.5px] font-bold uppercase tracking-wider text-emerald-800">
                    OUT
                  </span>
                ) : null}
              </button>
            );
          })}

          {/* Simple, Silky-Smooth GPU Scale+Fade AHU Card anchored right above the clicked 3D AHU */}
          {displayedCardUnit ? (
            <div
              ref={cardAnchorRef}
              style={{ left: 0, top: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-none absolute z-30 will-change-transform"
            >
              <div
                style={{ transformOrigin: "50% 100%" }}
                className={cx(
                  "w-[296px] rounded-2xl border border-[#bfd6fb] bg-white/96 p-3.5 text-[#12294d] shadow-[0_24px_48px_-14px_rgba(18,41,77,0.3)] ring-1 ring-[#3b82f6]/15 backdrop-blur-xl transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-[transform,opacity]",
                  cardVisible
                    ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
                    : "pointer-events-none translate-y-2 scale-[0.9] opacity-0",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[14px] font-extrabold text-[#12294d]">
                        {displayedCardUnit.item.ahu.id}
                      </span>
                      <StatusBadge status={displayedCardUnit.item.status} size="sm" />
                    </div>
                    <p className="mt-0.5 truncate text-[11.5px] font-semibold text-slate-700">
                      {displayedCardUnit.item.ahu.name}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 truncate text-[10.5px] text-slate-500">
                      <MapPin size={10.5} className="flex-none text-[#1d6ef2]" />
                      {displayedCardUnit.placement.zone}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    aria-label="Close AHU card"
                    className="grid h-6 w-6 flex-none place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  >
                    <X size={13} />
                  </button>
                </div>

                <dl className="mt-2.5 grid grid-cols-2 gap-1.5 rounded-xl border border-[#e6eef8] bg-[#f4f8fd] p-2 text-[10.5px]">
                  <div className="flex items-center justify-between px-1">
                    <dt className="text-slate-500">Supply</dt>
                    <dd className="num font-bold text-[#12294d]">
                      {displayedCardUnit.item.values.supplyTemp != null
                        ? `${displayedCardUnit.item.values.supplyTemp.toFixed(1)}°C`
                        : "—"}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between px-1">
                    <dt className="text-slate-500">RH</dt>
                    <dd className="num font-bold text-[#12294d]">
                      {displayedCardUnit.item.values.humidity != null
                        ? `${displayedCardUnit.item.values.humidity.toFixed(0)}%`
                        : "—"}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between px-1">
                    <dt className="text-slate-500">Fan</dt>
                    <dd className="num font-bold text-[#12294d]">
                      {displayedCardUnit.item.values.fanSpeed != null
                        ? `${displayedCardUnit.item.values.fanSpeed.toFixed(0)}%`
                        : "—"}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between px-1">
                    <dt className="text-slate-500">Alarms</dt>
                    <dd
                      className={cx(
                        "num font-bold",
                        displayedCardUnit.item.activeAlarms > 0 ? "text-red-600" : "text-emerald-600",
                      )}
                    >
                      {displayedCardUnit.item.activeAlarms}
                    </dd>
                  </div>
                </dl>

                <div className={cx("mt-2.5 grid gap-1.5", canMoveAhu ? "grid-cols-3" : "grid-cols-2")}>
                  {canMoveAhu ? (
                    <button
                      type="button"
                      onClick={() => startMovingUnit(displayedCardUnit.item.ahu.id)}
                      className="inline-flex items-center justify-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-100"
                    >
                      <Move size={12} /> Move
                    </button>
                  ) : null}
                  <Link
                    href={`/config?ahu=${encodeURIComponent(displayedCardUnit.item.ahu.id)}`}
                    className="inline-flex items-center justify-center gap-1 rounded-xl border border-[#dbe7fb] bg-[#f4f8ff] px-2.5 py-1.5 text-[11px] font-bold text-[#1d6ef2] transition hover:bg-[#e6effe]"
                  >
                    <Settings2 size={12} /> Config
                  </Link>
                  <Link
                    href={`/ahu/${encodeURIComponent(displayedCardUnit.item.ahu.id)}`}
                    className="inline-flex items-center justify-center gap-1 rounded-xl bg-gradient-to-r from-[#2563eb] to-[#1d6ef2] px-2.5 py-1.5 text-[11px] font-bold text-white shadow-[0_6px_16px_-6px_rgba(37,99,235,0.8)] transition hover:brightness-105"
                  >
                    Detail <ExternalLink size={11} />
                  </Link>
                </div>
              </div>
            </div>
          ) : null}

          {/* Hovering badge above newly placed or actively moving 3D AHU */}
          {(mode === "placement" && placement) || (mode === "explore" && movingAhuId && moveDraft) ? (
            <div
              ref={draftLabelRef}
              style={{ left: 0, top: 0, opacity: 0 }}
              className="pointer-events-none absolute z-20 flex items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-500 bg-emerald-600 px-3 py-1 text-[11px] font-bold text-white shadow-[0_10px_24px_-6px_rgba(5,150,105,0.65)]"
            >
              <Sparkles size={11} />
              <span className="font-mono">
                {mode === "placement" ? draftAhuId || "NEW" : movingAhuId}
              </span>
              <span className="max-w-[150px] truncate font-normal text-white/90">
                ·{" "}
                {(mode === "placement" ? placement?.snappedToWall : moveDraft?.snappedToWall)
                  ? "Snapped to Wall"
                  : mode === "placement"
                    ? draftAhuName || "Placed"
                    : "Drag Anywhere"}
              </span>
            </div>
          ) : null}
        </div>

        {/* Clean Frosted-White Bottom Legend & Live Wall-Physics / Room-Editor Status */}
        <div className="pointer-events-none absolute inset-x-3.5 bottom-3.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-[#d5e1f0] bg-white/92 px-3.5 py-1.5 text-[11px] font-semibold text-[#1e293b] shadow-[0_8px_24px_-12px_rgba(18,41,77,0.22)] backdrop-blur-xl">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> RUN
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-400" /> STOP
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> FAULT
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> OFFLINE
            </span>
            <span className="hidden text-slate-300 sm:inline">|</span>
            <span className="hidden items-center gap-1 text-emerald-700 sm:inline-flex">
              <Trees size={12} /> Exterior = Outdoor Grounds
            </span>
          </div>

          {editingRoom ? (
            <div className="rounded-xl border border-indigo-300 bg-white/95 px-3.5 py-1.5 text-[11px] font-semibold text-[#12294d] shadow-sm backdrop-blur-xl">
              <span className="inline-flex items-center gap-1.5">
                <PenTool size={12} className="text-indigo-600" />
                {roomTool === "drag"
                  ? `Floor Area: ${activeRoomAreaSqM} m² (${activeRoomVertices.length} corners) · Drag blue wall handles or white corner orbs · Double-click wall to split`
                  : roomTool === "split"
                    ? "Click anywhere on a highlighted green wall to insert a new corner point"
                    : roomTool === "extrude"
                      ? "Click any exterior wall (≥4.5m) to extrude a new 4m rectangular room wing"
                      : "Click any red corner orb to delete that vertex and straighten walls"}
              </span>
            </div>
          ) : mode === "placement" || movingAhuId ? (
            <div
              className={cx(
                "rounded-xl border px-3.5 py-1.5 text-[11px] font-semibold shadow-sm backdrop-blur-xl",
                hoverInfo && !hoverInfo.valid
                  ? "border-red-300 bg-red-50/95 text-red-700"
                  : hoverInfo?.snappedToWall
                    ? "border-emerald-300 bg-emerald-50/95 text-emerald-800"
                    : "border-[#bfd6fb] bg-white/95 text-[#12294d]",
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                <Crosshair size={12} className="text-[#1d6ef2]" />
                {hoverInfo && !hoverInfo.valid
                  ? hoverInfo.reason
                  : hoverInfo?.snappedToWall
                    ? `Wall Snap Active · Flush against wall (${hoverInfo.snappedX}m, ${hoverInfo.snappedZ}m · ${hoverInfo.rotation}°)`
                    : "Drag 3D AHU or click anywhere indoors or outdoors"}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
