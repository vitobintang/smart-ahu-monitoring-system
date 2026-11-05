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
  Layers,
  LayoutGrid,
  Magnet,
  MapPin,
  Move,
  Plus,
  RotateCcw,
  RotateCw,
  Settings2,
  Sparkles,
  Sun,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { AhuStatus } from "@/db/schema";
import { StatusBadge, cx } from "@/components/ui";
import {
  computeExteriorWallSegments,
  FACILITY_ZONES,
  normalizeRotation,
  resolveAhuPlacement,
  resolveWallPhysicsAndSnap,
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
  RUN: "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.95)]",
  STOP: "bg-slate-400",
  FAULT: "bg-red-500 animate-ping",
  OFFLINE: "bg-rose-500",
};

/** Builds a detailed industrial 3D Air Handling Unit on a raised floor mounting plinth. */
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
  const baseOpacity = isGhost ? 0.65 : dimmed ? 0.28 : 1;
  const ghostTint = !isGhost ? null : isValidGhost ? 0x10b981 : 0xef4444;

  // 1. Dedicated steel-framed vibration-isolation floor platform plinth (3.1m x 1.85m)
  const plinthGeo = new THREE.BoxGeometry(3.1, 0.22, 1.85);
  const plinthMat = new THREE.MeshStandardMaterial({
    color: ghostTint ?? (outdoor ? 0x334155 : 0x1e293b),
    roughness: 0.72,
    metalness: 0.28,
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
    color: isGhost ? (isValidGhost ? 0x34d399 : 0xf87171) : outdoor ? 0xf59e0b : 0x38bdf8,
    transparent: true,
    opacity: isGhost ? 0.95 : dimmed ? 0.25 : 0.6,
  });
  const trim = new THREE.LineSegments(trimGeo, trimMat);
  trim.position.copy(plinth.position);
  group.add(trim);

  // Selection / placement halo ring on floor
  const haloGeo = new THREE.RingGeometry(1.88, 2.15, 40);
  haloGeo.rotateX(-Math.PI / 2);
  const haloMat = new THREE.MeshBasicMaterial({
    color: isGhost ? (isValidGhost ? 0x10b981 : 0xef4444) : 0x38bdf8,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: isGhost ? 0.85 : 0,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.set(0, 0.025, 0);
  group.add(halo);

  // 2. Main insulated double-skin AHU cabinet sections
  const casingColor = ghostTint ?? (outdoor ? 0xdbe5f0 : 0xe8eef7);
  const frameColor = ghostTint ?? 0x334155;
  const casingMat = new THREE.MeshStandardMaterial({
    color: casingColor,
    roughness: 0.36,
    metalness: 0.32,
    transparent,
    opacity: baseOpacity,
  });
  const darkFrameMat = new THREE.MeshStandardMaterial({
    color: frameColor,
    roughness: 0.5,
    metalness: 0.55,
    transparent,
    opacity: baseOpacity,
  });

  // Rear wall-interface supply/return duct flange on local -Z (faces wall when snapped flush!)
  const wallFlangeMat = new THREE.MeshStandardMaterial({
    color: ghostTint ?? 0x64748b,
    roughness: 0.4,
    metalness: 0.65,
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

  // Section A: Intake / Mixing Box (left)
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

  // Section B: Filter + Cooling/Heating Coil Bank (center)
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
      metalness: 0.6,
      transparent,
      opacity: baseOpacity,
    });
    const cwReturnMat = new THREE.MeshStandardMaterial({
      color: hasHeater ? 0xf97316 : 0x38bdf8,
      roughness: 0.3,
      metalness: 0.6,
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

  // Section C: Supply Fan Scroll & Discharge Plenum (right)
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
        color: 0x475569,
        roughness: 0.45,
        metalness: 0.55,
        transparent,
        opacity: baseOpacity,
      }),
    );
    roofCap.position.set(0, 1.61, 0);
    roofCap.userData = { ahuId: id };
    group.add(roofCap);
  }

  // Circular inspection porthole + 3D spinning supply impeller on front (+Z)
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
    metalness: 0.5,
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
    emissiveIntensity: status === "RUN" || status === "FAULT" ? 0.9 : 0.35,
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
  draftAhuId = "AHU-08",
  draftAhuName = "New Air Handling Unit",
  placement = null,
  onPlacementChange,
}: Props) {
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

  // Resolve 3D coordinates for every AHU unit
  const resolvedUnits = useMemo(() => {
    const acc: Array<{ id: string; x: number; z: number; rotation?: number }> = [];
    return items.map((item) => {
      const p = resolveAhuPlacement(item.ahu, acc);
      acc.push({ id: item.ahu.id, x: p.x, z: p.z, rotation: p.rotation });
      return { item, placement: p };
    });
  }, [items]);

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

  const startMovingUnit = useCallback(
    (ahuId: string) => {
      const target = resolvedUnits.find((u) => u.item.ahu.id === ahuId);
      if (!target) return;
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

  // Camera spherical orbit state in ref for 60fps smooth dragging AND immediate snap presets
  const camStateRef = useRef({
    theta: mode === "placement" ? 0.62 : 0.72,
    phi: mode === "placement" ? 0.78 : 0.88,
    radius: mode === "placement" ? 44 : 45,
    targetX: 1,
    targetZ: -1,
    goalTheta: mode === "placement" ? 0.62 : 0.72,
    goalPhi: mode === "placement" ? 0.78 : 0.88,
    goalRadius: mode === "placement" ? 44 : 45,
    goalTargetX: 1,
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

  /** Immediately jumps camera to Top View (0ms lag) or 3D / Outdoor presets. */
  const setCameraPreset = useCallback((preset: "iso" | "top" | "outdoor", immediate = true) => {
    const c = camStateRef.current;
    autoRotateRef.current = false;
    setAutoRotate(false);

    let nextTheta = 0.72;
    let nextPhi = 0.88;
    let nextRadius = 45;
    let nextTx = 1;
    let nextTz = -1;

    if (preset === "top") {
      // True straight-down 90° architectural plan view
      nextTheta = 0;
      nextPhi = 0.002;
      nextRadius = 54;
      nextTx = 0;
      nextTz = 0;
      setIsTopView(true);
    } else if (preset === "outdoor") {
      nextTheta = 1.12;
      nextPhi = 0.86;
      nextRadius = 38;
      nextTx = 13;
      nextTz = 0;
      setIsTopView(false);
    } else {
      setIsTopView(false);
    }

    c.goalTheta = nextTheta;
    c.goalPhi = nextPhi;
    c.goalRadius = nextRadius;
    c.goalTargetX = nextTx;
    c.goalTargetZ = nextTz;

    if (immediate) {
      c.theta = nextTheta;
      c.phi = nextPhi;
      c.radius = nextRadius;
      c.targetX = nextTx;
      c.targetZ = nextTz;
    }
  }, []);

  const zoomBy = useCallback((delta: number) => {
    const c = camStateRef.current;
    c.goalRadius = Math.min(72, Math.max(15, c.goalRadius + delta));
  }, []);

  useEffect(() => {
    if (mode !== "explore" || !selectedUnit || isTopView) return;
    const c = camStateRef.current;
    c.goalTargetX = selectedUnit.placement.x * 0.5;
    c.goalTargetZ = selectedUnit.placement.z * 0.5;
  }, [mode, selectedUnit, isTopView]);

  const ahuSceneObjectsRef = useRef<{
    ahuRootGroup: THREE.Group;
    ghostGroup: THREE.Group;
    placedDraftGroup: THREE.Group;
    wallSnapLineGroup: THREE.Group;
    rotors: Array<{ rotor: THREE.Group; running: boolean }>;
    halos: Map<string, THREE.Mesh>;
    beacons: Array<{ mat: THREE.MeshStandardMaterial; fault: boolean }>;
  } | null>(null);

  const updateWallSnapHighlight = useCallback((seg: WallSegment | null) => {
    const objs = ahuSceneObjectsRef.current;
    if (!objs) return;
    objs.wallSnapLineGroup.clear();
    if (!seg) {
      objs.wallSnapLineGroup.visible = false;
      return;
    }
    const len = Math.hypot(seg.x2 - seg.x1, seg.z2 - seg.z1);
    const midX = (seg.x1 + seg.x2) / 2;
    const midZ = (seg.z1 + seg.z2) / 2;
    const wX = seg.orientation === "H" ? len + 0.2 : 0.42;
    const wZ = seg.orientation === "V" ? len + 0.2 : 0.42;

    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(wX, 2.96, wZ),
      new THREE.MeshBasicMaterial({
        color: 0x34d399,
        transparent: true,
        opacity: 0.34,
      }),
    );
    beam.position.set(midX, 1.48, midZ);
    objs.wallSnapLineGroup.add(beam);

    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(wX + 0.06, 0.14, wZ + 0.06),
      new THREE.MeshBasicMaterial({ color: 0x10b981 }),
    );
    rail.position.set(midX, 2.95, midZ);
    objs.wallSnapLineGroup.add(rail);
    objs.wallSnapLineGroup.visible = true;
  }, []);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      setWebglError("3D WebGL context could not be initialized on this device.");
      return;
    }

    const width = Math.max(300, container.clientWidth);
    const height = Math.max(280, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x09172e);
    scene.fog = new THREE.FogExp2(0x09172e, 0.0062);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.5, 240);

    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 1.08);
    hemi.position.set(0, 45, 0);
    scene.add(hemi);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.35);
    dirLight.position.set(26, 40, 22);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 5;
    dirLight.shadow.camera.far = 115;
    const d = 38;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    dirLight.shadow.bias = -0.0005;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.45);
    fillLight.position.set(-28, 18, -22);
    scene.add(fillLight);

    const groundGeo = new THREE.PlaneGeometry(160, 160);
    groundGeo.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({ color: 0x071224, roughness: 0.95, metalness: 0.05 }),
    );
    ground.position.y = -0.36;
    ground.receiveShadow = true;
    scene.add(ground);

    const subtleCampusGrid = new THREE.GridHelper(140, 70, 0x162b4d, 0x0e203d);
    subtleCampusGrid.position.y = -0.35;
    scene.add(subtleCampusGrid);

    const facilityGroup = new THREE.Group();
    scene.add(facilityGroup);

    const indoorSlabMat = new THREE.MeshStandardMaterial({
      color: mode === "placement" ? 0x132b4c : 0x102442,
      roughness: 0.62,
      metalness: 0.18,
    });
    const outdoorSlabMat = new THREE.MeshStandardMaterial({
      color: 0x1f2937,
      roughness: 0.85,
      metalness: 0.12,
    });

    for (const wz of FACILITY_ZONES) {
      const w = wz.xMax - wz.xMin;
      const depth = wz.zMax - wz.zMin;
      const cxPos = (wz.xMin + wz.xMax) / 2;
      const czPos = (wz.zMin + wz.zMax) / 2;

      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.34, depth),
        wz.indoor ? indoorSlabMat : outdoorSlabMat,
      );
      slab.position.set(cxPos, -0.17, czPos);
      slab.receiveShadow = true;
      facilityGroup.add(slab);

      const linePositions: number[] = [];
      for (let x = wz.xMin; x <= wz.xMax; x += 2) {
        linePositions.push(x, 0.006, wz.zMin, x, 0.006, wz.zMax);
      }
      for (let z = wz.zMin; z <= wz.zMax; z += 2) {
        linePositions.push(wz.xMin, 0.006, z, wz.xMax, 0.006, z);
      }
      const gridGeo = new THREE.BufferGeometry();
      gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
      facilityGroup.add(
        new THREE.LineSegments(
          gridGeo,
          new THREE.LineBasicMaterial({
            color: wz.indoor ? 0x2563eb : 0xf59e0b,
            transparent: true,
            opacity: 0.24,
          }),
        ),
      );

      if (!wz.indoor) {
        const curbEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 0.06, 0.36, depth + 0.06));
        const curb = new THREE.LineSegments(
          curbEdges,
          new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.75 }),
        );
        curb.position.set(cxPos, -0.17, czPos);
        facilityGroup.add(curb);

        // Place safety bollards on the outer corners (away from the building wall!)
        const bollardMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.4, metalness: 0.3 });
        const corners: Array<[number, number]> =
          wz.id === "outdoor-east-yard"
            ? [
                [wz.xMax - 0.45, wz.zMin + 0.45],
                [wz.xMax - 0.45, wz.zMax - 0.45],
              ]
            : [
                [wz.xMin + 0.45, wz.zMin + 0.45],
                [wz.xMax - 0.45, wz.zMin + 0.45],
              ];
        for (const [bx, bz] of corners) {
          const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.75, 10), bollardMat);
          bollard.position.set(bx, 0.375, bz);
          bollard.castShadow = true;
          facilityGroup.add(bollard);
        }
      }
    }

    // Solid Exterior Perimeter Walls (0.28m thick)
    const wallSegments = computeExteriorWallSegments();
    const wallHeight = 2.85;
    const wallThickness = 0.28;
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a5f,
      roughness: 0.45,
      metalness: 0.15,
      transparent: true,
      opacity: 0.76,
    });
    const wallCapMat = new THREE.MeshStandardMaterial({
      color: 0x60a5fa,
      emissive: 0x1d4ed8,
      emissiveIntensity: 0.25,
      roughness: 0.35,
      metalness: 0.5,
    });
    const columnMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.5,
      metalness: 0.45,
    });

    const cornerSet = new Set<string>();
    for (const seg of wallSegments) {
      const length = Math.hypot(seg.x2 - seg.x1, seg.z2 - seg.z1);
      const midX = (seg.x1 + seg.x2) / 2;
      const midZ = (seg.z1 + seg.z2) / 2;
      const wX = seg.orientation === "H" ? length : wallThickness;
      const wZ = seg.orientation === "V" ? length : wallThickness;

      const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(wX, wallHeight, wZ), wallMat);
      wallMesh.position.set(midX, wallHeight / 2, midZ);
      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;
      facilityGroup.add(wallMesh);

      const capMesh = new THREE.Mesh(new THREE.BoxGeometry(wX + 0.04, 0.08, wZ + 0.04), wallCapMat);
      capMesh.position.set(midX, wallHeight + 0.04, midZ);
      facilityGroup.add(capMesh);

      for (const [px, pz] of [
        [seg.x1, seg.z1],
        [seg.x2, seg.z2],
      ]) {
        const key = `${px},${pz}`;
        if (!cornerSet.has(key)) {
          cornerSet.add(key);
          const col = new THREE.Mesh(new THREE.BoxGeometry(0.42, wallHeight + 0.16, 0.42), columnMat);
          col.position.set(px, (wallHeight + 0.16) / 2, pz);
          col.castShadow = true;
          facilityGroup.add(col);
        }
      }
    }

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
      ahuRootGroup,
      ghostGroup,
      placedDraftGroup,
      wallSnapLineGroup,
      rotors: [],
      halos: new Map(),
      beacons: [],
    };

    // Raycaster + Pointer Physics (Orbit / Pan / Direct Model Drag / Wall-Physics Placement)
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const planeHit = new THREE.Vector3();

    let isDragging = false;
    let isDraggingModelDirectly = false;
    let dragButton = 0;
    let downX = 0;
    let downY = 0;
    let lastX = 0;
    let lastY = 0;
    let movedDist = 0;

    const domEl = renderer.domElement;

    const updateNdc = (clientX: number, clientY: number) => {
      const rect = domEl.getBoundingClientRect();
      pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    };

    const evaluatePhysicsAtRay = () => {
      const activeMovingId = mode === "explore" ? movingAhuIdRef.current : undefined;
      const currentDraft = mode === "placement" ? placementRef.current : moveDraftRef.current;
      const baseRot = currentDraft?.rotation ?? 0;

      const check = resolveWallPhysicsAndSnap(planeHit.x, planeHit.z, existingCoordsRef.current, {
        excludeId: activeMovingId ?? undefined,
        rotation: baseRot,
        enableWallSnap: wallSnapRef.current,
        autoAlignRotation: wallSnapRef.current && !manualRotLockedRef.current,
        clampVoidToWall: true,
      });
      return check;
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

    const handlePointerDown = (e: PointerEvent) => {
      isDragging = true;
      isDraggingModelDirectly = false;
      dragButton = e.button;
      downX = e.clientX;
      downY = e.clientY;
      lastX = e.clientX;
      lastY = e.clientY;
      movedDist = 0;
      autoRotateRef.current = false;
      setAutoRotate(false);

      // If in placement or move mode and user grabs the placed draft AHU directly with left button, drag the AHU live!
      const isEditingPlacement = mode === "placement" || Boolean(movingAhuIdRef.current);
      if (isEditingPlacement && e.button === 0) {
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

        // Live solid-wall physics drag of the 3D AHU model!
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
          c.goalTargetX = Math.min(28, Math.max(-24, c.goalTargetX - (dx * cosT + dy * sinT) * panScale));
          c.goalTargetZ = Math.min(22, Math.max(-24, c.goalTargetZ - (-dx * sinT + dy * cosT) * panScale));
        } else {
          c.goalTheta -= dx * 0.0072;
          c.goalPhi = Math.min(1.36, Math.max(0.05, c.goalPhi - dy * 0.0065));
          if (c.goalPhi > 0.12) setIsTopView(false);
        }
        return;
      }

      updateNdc(e.clientX, e.clientY);
      raycaster.setFromCamera(pointerNdc, camera);

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
      if (!isDragging) return;
      const wasDirectModelDrag = isDraggingModelDirectly;
      isDragging = false;
      isDraggingModelDirectly = false;
      domEl.releasePointerCapture?.(e.pointerId);

      if (wasDirectModelDrag) {
        domEl.style.cursor = "grab";
        return;
      }

      if (movedDist < 6 && Math.hypot(e.clientX - downX, e.clientY - downY) < 6 && dragButton === 0) {
        updateNdc(e.clientX, e.clientY);
        raycaster.setFromCamera(pointerNdc, camera);

        const isEditingPlacement = mode === "placement" || Boolean(movingAhuIdRef.current);
        if (isEditingPlacement) {
          if (raycaster.ray.intersectPlane(floorPlane, planeHit)) {
            const check = evaluatePhysicsAtRay();
            applyGhostPreview(check);
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
                if (typeof cur.userData?.ahuId === "string") {
                  clickedId = cur.userData.ahuId;
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
      }
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = camStateRef.current;
      c.goalRadius = Math.min(72, Math.max(15, c.goalRadius + e.deltaY * 0.028));
    };

    const handleContextMenu = (e: MouseEvent) => e.preventDefault();

    domEl.addEventListener("pointerdown", handlePointerDown);
    domEl.addEventListener("pointermove", handlePointerMove);
    domEl.addEventListener("pointerup", handlePointerUp);
    domEl.addEventListener("pointerleave", handlePointerLeave);
    domEl.addEventListener("wheel", handleWheel, { passive: false });
    domEl.addEventListener("contextmenu", handleContextMenu);

    const resizeObserver = new ResizeObserver(() => {
      if (!mountRef.current) return;
      const w = Math.max(280, mountRef.current.clientWidth);
      const h = Math.max(260, mountRef.current.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

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

      const damp = 1 - Math.exp(-dt * 12);
      c.theta += (c.goalTheta - c.theta) * damp;
      c.phi += (c.goalPhi - c.phi) * damp;
      c.radius += (c.goalRadius - c.radius) * damp;
      c.targetX += (c.goalTargetX - c.targetX) * damp;
      c.targetZ += (c.goalTargetZ - c.targetZ) * damp;

      const sinPhi = Math.sin(Math.max(0.0015, c.phi));
      camera.position.set(
        c.targetX + c.radius * sinPhi * Math.sin(c.theta),
        c.radius * Math.cos(Math.max(0.0015, c.phi)),
        c.targetZ + c.radius * sinPhi * Math.cos(c.theta),
      );
      camera.lookAt(c.targetX, 0.5, c.targetZ);

      const objs = ahuSceneObjectsRef.current;
      if (objs) {
        for (const r of objs.rotors) {
          if (r.running) r.rotor.rotation.z -= dt * 7.5;
        }
        for (const [id, haloMesh] of objs.halos.entries()) {
          const mat = haloMesh.material as THREE.MeshBasicMaterial;
          const isSel = id === selectedIdRef.current;
          mat.opacity = isSel ? 0.68 + Math.sin(elapsed * 4) * 0.22 : 0;
        }
        for (const b of objs.beacons) {
          if (b.fault) {
            b.mat.emissiveIntensity = 0.4 + Math.abs(Math.sin(elapsed * 5.5)) * 1.1;
          }
        }
      }

      renderer.render(scene, camera);

      const cw = domEl.clientWidth;
      const ch = domEl.clientHeight;
      for (const u of resolvedUnitsRef.current) {
        const el = labelElsRef.current.get(u.item.ahu.id);
        if (!el) continue;
        if (u.item.ahu.id === movingAhuIdRef.current) {
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
          continue;
        }
        projVec.set(u.placement.x, 2.48, u.placement.z);
        projVec.project(camera);
        if (projVec.z < -1 || projVec.z > 1) {
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
          continue;
        }
        const sx = (projVec.x * 0.5 + 0.5) * cw;
        const sy = (-projVec.y * 0.5 + 0.5) * ch;
        el.style.opacity = "1";
        el.style.pointerEvents = mode === "explore" && !movingAhuIdRef.current ? "auto" : "none";
        el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
      }

      if (cardAnchorRef.current && selectedIdRef.current && mode === "explore" && !movingAhuIdRef.current) {
        const sel = resolvedUnitsRef.current.find((u) => u.item.ahu.id === selectedIdRef.current);
        if (sel) {
          projVec.set(sel.placement.x, 2.75, sel.placement.z);
          projVec.project(camera);
          const rawX = (projVec.x * 0.5 + 0.5) * cw;
          const rawY = (-projVec.y * 0.5 + 0.5) * ch;
          const clampedX = Math.min(Math.max(158, rawX), Math.max(158, cw - 158));
          const clampedY = Math.min(Math.max(225, rawY), Math.max(225, ch - 20));
          cardAnchorRef.current.style.opacity = "1";
          cardAnchorRef.current.style.transform = `translate3d(${clampedX.toFixed(1)}px, ${clampedY.toFixed(1)}px, 0) translate(-50%, -104%)`;
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
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
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

  // Sync placed draft 3D AHU model (both in Add-AHU placement mode AND in Move-AHU mode!)
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
      color: 0x22c55e,
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
      <div className="rounded-2xl border border-slate-200 bg-slate-900 p-6 text-center text-xs text-slate-300">
        {webglError}
      </div>
    );
  }

  return (
    <div
      className={cx(
        "relative flex flex-col overflow-hidden bg-[#09172e]",
        fullPage
          ? "h-full w-full flex-1"
          : "rounded-2xl border border-[#1d355d] shadow-[0_22px_50px_-20px_rgba(9,23,46,0.65)]",
      )}
    >
      {/* Top 3D HUD Header Bar */}
      <div className="z-20 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#0b1d3a]/95 px-3.5 py-2.5 backdrop-blur-md sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-xl bg-sky-500/15 text-sky-300 ring-1 ring-sky-400/30">
            <Layers size={15} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[13.5px] font-bold tracking-tight text-white sm:text-[15px]">
                {mode === "placement"
                  ? "Place New 3D AHU (Solid Wall Physics & Snap)"
                  : movingAhuId
                    ? `Moving ${movingAhuId} in 3D Facility`
                    : "AHU Units · 3D Facility Digital Twin"}
              </h1>
              <span className="hidden rounded-full border border-sky-400/25 bg-sky-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-sky-300 md:inline-flex">
                {indoorCount} Indoor · {outdoorCount} Outdoor Wall-Mounted
              </span>
            </div>
            <p className="truncate text-[10.5px] text-slate-400">
              {mode === "placement" || movingAhuId
                ? "Solid wall physics active · drag the 3D AHU or click near any wall to snap flush against the wall"
                : pickToMove
                  ? "Select any 3D AHU model (or its label) to start moving it across the facility"
                  : "Drag to rotate 360° · scroll to zoom · click any 3D AHU for Move, Config & Detail"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Open Classic AHU Units List Page */}
          {mode === "explore" && onOpenList ? (
            <button
              type="button"
              onClick={onOpenList}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/40 bg-sky-500/15 px-3 py-1.5 text-[11.5px] font-bold text-sky-100 transition hover:bg-sky-500/25"
              title="Open classic AHU Units list view"
            >
              <LayoutGrid size={13} /> AHU List ({items.length})
            </button>
          ) : null}

          {/* Immediate Top View Button (0ms instant overhead switch!) */}
          <button
            type="button"
            onClick={() => setCameraPreset(isTopView ? "iso" : "top", true)}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-bold transition",
              isTopView
                ? "border-emerald-400/60 bg-emerald-500/25 text-emerald-100 shadow-[0_0_16px_rgba(16,185,129,0.35)]"
                : "border-white/15 bg-white/10 text-white hover:bg-white/18",
            )}
            title="Immediately switch camera to straight-down Top View"
          >
            <Eye size={13} /> Top View
          </button>

          <button
            type="button"
            onClick={() => setCameraPreset("iso", true)}
            className="inline-flex items-center gap-1 rounded-lg border border-white/12 bg-white/8 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition hover:bg-white/15"
            title="Reset 3D isometric angle immediately"
          >
            <RotateCcw size={12} /> <span className="hidden sm:inline">3D View</span>
          </button>

          <button
            type="button"
            onClick={() => setCameraPreset("outdoor", true)}
            className="hidden items-center gap-1 rounded-lg border border-amber-400/25 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-200 transition hover:bg-amber-500/20 md:inline-flex"
            title="Focus wall-mounted outdoor AHU pads"
          >
            <Sun size={12} /> Outdoor
          </button>

          {/* Wall Snap Toggle when placing or moving */}
          {mode === "placement" || movingAhuId ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setWallSnapEnabled((v) => !v);
                  setManualRotLocked(false);
                }}
                className={cx(
                  "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition",
                  wallSnapEnabled
                    ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
                    : "border-white/15 bg-white/8 text-slate-300",
                )}
                title="Toggle magnetic flush-to-wall snapping"
              >
                <Magnet size={12} /> Snap: {wallSnapEnabled ? "ON" : "OFF"}
              </button>
              <button
                type="button"
                onClick={rotateActiveDraft90}
                className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/18"
                title="Rotate 3D AHU by 90°"
              >
                <RotateCw size={12} /> {(mode === "placement" ? placement?.rotation : moveDraft?.rotation) ?? 0}°
              </button>
            </>
          ) : null}

          {/* Move 3D Model Button in Explore Toolbar */}
          {mode === "explore" && canMoveAhu && !movingAhuId ? (
            <button
              type="button"
              onClick={() => {
                if (selectedId) startMovingUnit(selectedId);
                else setPickToMove((v) => !v);
              }}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold transition",
                pickToMove
                  ? "border-amber-400/60 bg-amber-500/25 text-amber-100"
                  : "border-white/15 bg-white/10 text-slate-100 hover:bg-white/18",
              )}
              title="Move a 3D AHU model on the floor or snap it to a wall"
            >
              <Move size={13} /> {pickToMove ? "Cancel Pick" : selectedId ? `Move ${selectedId}` : "Move AHU"}
            </button>
          ) : null}

          {mode === "explore" && !movingAhuId ? (
            <button
              type="button"
              onClick={() => setAutoRotate((v) => !v)}
              className={cx(
                "hidden items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition lg:inline-flex",
                autoRotate
                  ? "border-sky-400/50 bg-sky-500/20 text-sky-200"
                  : "border-white/12 bg-white/8 text-slate-200 hover:bg-white/15",
              )}
              title="Toggle slow 360° turntable rotation"
            >
              <Compass size={12} /> Orbit
            </button>
          ) : null}

          <div className="hidden items-center overflow-hidden rounded-lg border border-white/12 bg-white/8 sm:inline-flex">
            <button
              type="button"
              onClick={() => zoomBy(-6)}
              className="px-2 py-1.5 text-slate-200 transition hover:bg-white/15"
              aria-label="Zoom in"
            >
              <ZoomIn size={12} />
            </button>
            <button
              type="button"
              onClick={() => zoomBy(6)}
              className="border-l border-white/10 px-2 py-1.5 text-slate-200 transition hover:bg-white/15"
              aria-label="Zoom out"
            >
              <ZoomOut size={12} />
            </button>
          </div>

          {mode === "explore" && canAddAhu && onRequestAddAhu && !movingAhuId ? (
            <button
              type="button"
              onClick={onRequestAddAhu}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#2563eb] to-[#1d6ef2] px-3 py-1.5 text-[11.5px] font-bold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.9)] transition hover:brightness-110"
            >
              <Plus size={13} /> Add New AHU
            </button>
          ) : null}
        </div>
      </div>

      {/* Floating Save / Cancel Action Bar while Moving an Existing 3D AHU */}
      {mode === "explore" && movingAhuId && moveDraft ? (
        <div className="z-20 flex flex-wrap items-center justify-between gap-2 border-b border-emerald-400/25 bg-emerald-950/85 px-4 py-2 text-[11.5px] text-emerald-100 backdrop-blur-md">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-0.5 font-mono text-[11px] font-bold text-emerald-200 ring-1 ring-emerald-400/40">
              <Move size={11} /> {movingAhuId}
            </span>
            <span>
              <strong>{moveDraft.zoneLabel}</strong> ·{" "}
              <span className="font-mono text-emerald-200">
                (X {moveDraft.x}m, Z {moveDraft.z}m · {moveDraft.rotation}°)
              </span>
              {moveDraft.snappedToWall ? (
                <span className="ml-2 rounded-full bg-emerald-400/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-200">
                  Snapped Flush to Wall
                </span>
              ) : null}
            </span>
            {moveError ? <span className="font-semibold text-red-300">· {moveError}</span> : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={savingMove}
              onClick={cancelMovingUnit}
              className="rounded-lg border border-white/20 bg-white/10 px-3 py-1 font-semibold text-white transition hover:bg-white/20"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={savingMove}
              onClick={() => void confirmMoveSave()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-1 font-bold text-slate-950 shadow-sm transition hover:bg-emerald-400"
            >
              <Check size={13} /> {savingMove ? "Saving…" : "Save 3D Position"}
            </button>
          </div>
        </div>
      ) : null}

      {/* 3D WebGL Viewport + Projected Hovering Labels & Floating Unit Card */}
      <div
        className={cx(
          "relative w-full select-none",
          fullPage
            ? "min-h-0 flex-1"
            : mode === "placement"
              ? "h-[340px] sm:h-[400px]"
              : "h-[430px] sm:h-[510px]",
        )}
      >
        <div ref={mountRef} className="h-full w-full touch-none" />

        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {resolvedUnits.map(({ item, placement: pos }) => {
            const isSelected = item.ahu.id === selectedId;
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
                  if (mode === "explore") {
                    if (pickToMove) startMovingUnit(item.ahu.id);
                    else setSelectedId(isSelected ? null : item.ahu.id);
                  }
                }}
                style={{ left: 0, top: 0, opacity: 0 }}
                className={cx(
                  "absolute flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-left backdrop-blur-md transition-colors",
                  isSelected
                    ? "z-20 border-sky-300 bg-[#0f2952]/95 text-white shadow-[0_0_20px_rgba(56,189,248,0.55)]"
                    : pickToMove
                      ? "z-20 border-amber-300/70 bg-amber-950/90 text-amber-100 hover:bg-amber-900"
                      : "z-10 border-white/20 bg-[#0b1930]/85 text-slate-100 hover:border-sky-400/60 hover:bg-[#102648]/95",
                )}
              >
                <span className={cx("h-2 w-2 flex-none rounded-full", STATUS_DOT_CLASS[item.status])} />
                <span className="font-mono text-[10.5px] font-extrabold tracking-tight text-white">
                  {item.ahu.id}
                </span>
                {shortName ? (
                  <span className="hidden max-w-[115px] truncate text-[10px] font-medium text-slate-300 sm:inline">
                    · {shortName}
                  </span>
                ) : null}
                {!pos.indoor ? (
                  <span className="rounded bg-amber-500/25 px-1 py-0.2 text-[8.5px] font-bold uppercase tracking-wider text-amber-300">
                    OUT
                  </span>
                ) : null}
              </button>
            );
          })}

          {/* Hovering badge above newly placed or actively moving 3D AHU */}
          {(mode === "placement" && placement) || (mode === "explore" && movingAhuId && moveDraft) ? (
            <div
              ref={draftLabelRef}
              style={{ left: 0, top: 0, opacity: 0 }}
              className="pointer-events-none absolute z-20 flex items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-400 bg-emerald-950/92 px-3 py-1 text-[11px] font-bold text-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.55)]"
            >
              <Sparkles size={11} className="text-emerald-300" />
              <span className="font-mono">
                {mode === "placement" ? draftAhuId || "NEW" : movingAhuId}
              </span>
              <span className="max-w-[140px] truncate font-normal text-emerald-100/85">
                ·{" "}
                {(mode === "placement" ? placement?.snappedToWall : moveDraft?.snappedToWall)
                  ? "Wall-Snapped"
                  : mode === "placement"
                    ? draftAhuName || "Placed"
                    : "Drag or Click"}
              </span>
            </div>
          ) : null}

          {/* Clickable Small AHU Card anchored right on the clicked 3D AHU Model */}
          {mode === "explore" && selectedUnit && !movingAhuId ? (
            <div
              ref={cardAnchorRef}
              style={{ left: 0, top: 0, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-auto absolute z-30 w-[296px] rounded-2xl border border-white/80 bg-white/96 p-3.5 text-slate-800 shadow-[0_24px_48px_-12px_rgba(7,18,36,0.75)] ring-1 ring-sky-500/25 backdrop-blur-xl"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[14px] font-extrabold text-[#12294d]">
                      {selectedUnit.item.ahu.id}
                    </span>
                    <StatusBadge status={selectedUnit.item.status} size="sm" />
                  </div>
                  <p className="mt-0.5 truncate text-[11.5px] font-semibold text-slate-700">
                    {selectedUnit.item.ahu.name}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-slate-500">
                    <MapPin size={10} className="flex-none text-sky-600" />
                    {selectedUnit.placement.zone}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label="Close AHU 3D card"
                  className="grid h-6 w-6 flex-none place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  <X size={13} />
                </button>
              </div>

              <dl className="mt-2.5 grid grid-cols-2 gap-1.5 rounded-xl bg-[#f4f7fc] p-2 text-[10.5px]">
                <div className="flex items-center justify-between px-1">
                  <dt className="text-slate-400">Supply</dt>
                  <dd className="num font-bold text-[#12294d]">
                    {selectedUnit.item.values.supplyTemp != null
                      ? `${selectedUnit.item.values.supplyTemp.toFixed(1)}°C`
                      : "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between px-1">
                  <dt className="text-slate-400">RH</dt>
                  <dd className="num font-bold text-[#12294d]">
                    {selectedUnit.item.values.humidity != null
                      ? `${selectedUnit.item.values.humidity.toFixed(0)}%`
                      : "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between px-1">
                  <dt className="text-slate-400">Fan</dt>
                  <dd className="num font-bold text-[#12294d]">
                    {selectedUnit.item.values.fanSpeed != null
                      ? `${selectedUnit.item.values.fanSpeed.toFixed(0)}%`
                      : "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between px-1">
                  <dt className="text-slate-400">Alarms</dt>
                  <dd
                    className={cx(
                      "num font-bold",
                      selectedUnit.item.activeAlarms > 0 ? "text-red-600" : "text-emerald-600",
                    )}
                  >
                    {selectedUnit.item.activeAlarms}
                  </dd>
                </div>
              </dl>

              <div className={cx("mt-2.5 grid gap-1.5", canMoveAhu ? "grid-cols-3" : "grid-cols-2")}>
                {canMoveAhu ? (
                  <button
                    type="button"
                    onClick={() => startMovingUnit(selectedUnit.item.ahu.id)}
                    className="inline-flex items-center justify-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-100"
                  >
                    <Move size={12} /> Move
                  </button>
                ) : null}
                <Link
                  href={`/config?ahu=${encodeURIComponent(selectedUnit.item.ahu.id)}`}
                  className="inline-flex items-center justify-center gap-1 rounded-xl border border-[#dbe7fb] bg-[#f4f8ff] px-2.5 py-1.5 text-[11px] font-bold text-[#1d6ef2] transition hover:bg-[#e6effe]"
                >
                  <Settings2 size={12} /> Config
                </Link>
                <Link
                  href={`/ahu/${encodeURIComponent(selectedUnit.item.ahu.id)}`}
                  className="inline-flex items-center justify-center gap-1 rounded-xl bg-gradient-to-r from-[#2563eb] to-[#1d6ef2] px-2.5 py-1.5 text-[11px] font-bold text-white shadow-[0_8px_18px_-6px_rgba(37,99,235,0.85)] transition hover:brightness-110"
                >
                  Detail <ExternalLink size={11} />
                </Link>
              </div>
            </div>
          ) : null}
        </div>

        {/* Bottom Legend & Live Wall-Snap / Physics Feedback */}
        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/12 bg-[#08152b]/88 px-3 py-1.5 text-[10.5px] text-slate-300 backdrop-blur-md">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> RUN
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-slate-400" /> STOP
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-red-500" /> FAULT
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-500" /> OFFLINE
            </span>
            <span className="hidden text-slate-500 sm:inline">|</span>
            <span className="hidden items-center gap-1 text-amber-300 sm:inline-flex">
              <Sun size={11} /> Outdoor Pads Flush Against Wall
            </span>
          </div>

          {mode === "placement" || movingAhuId ? (
            <div
              className={cx(
                "rounded-xl border px-3 py-1.5 text-[10.5px] font-medium backdrop-blur-md",
                hoverInfo && !hoverInfo.valid
                  ? "border-red-400/40 bg-red-950/88 text-red-200"
                  : hoverInfo?.snappedToWall
                    ? "border-emerald-400/50 bg-emerald-950/90 text-emerald-200"
                    : "border-sky-400/35 bg-[#08152b]/90 text-sky-200",
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                <Crosshair size={11} />
                {hoverInfo && !hoverInfo.valid
                  ? hoverInfo.reason
                  : hoverInfo?.snappedToWall
                    ? `Wall Snap Active · Flush against wall (${hoverInfo.snappedX}m, ${hoverInfo.snappedZ}m · ${hoverInfo.rotation}°)`
                    : "Drag 3D AHU or click floor/wall · solid walls block pass-through"}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
