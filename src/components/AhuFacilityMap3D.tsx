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
import type { AhuStatus } from "@/lib/types";
import { StatusBadge, cx } from "@/components/ui";
import {
  computePolygonAreaSqM,
  DEFAULT_ROOM_VERTICES,
  deleteFloorVertex,
  dragFloorWall,
  extrudeWingOnWall,
  insertVertexOnWall,
  moveFloorVertex,
  normalizeRotation,
  projectPointToSegment,
  ROOM_GRID_SNAP_STEP,
  snapToPlatformGrid,
  type FloorVertex,
  type WallSegment,
} from "@/lib/facility-layout";
import {
  generateRandomTreePool,
  isOutdoorTreeSpotClear,
  MAX_VISIBLE_OUTDOOR_TREES,
  resolveAhuPlacement,
  isAcDeviceType,
  resolveAcDevicePlacement,
  resolveWallPhysicsAndSnap,
  type PlacementValidation,
} from "@/lib/facility-placement";
import { RoomMeshPool, type RoomEditTool, type RoomHoverTarget } from "./room-mesh-pool";
import {
  DEVICE_TYPES,
  normalizeRoomRect,
  nextRoomColor,
  roomCenter,
  roomAt,
  snapRoom,
  type RoomRecord,
} from "@/lib/facility-rooms";
import { buildAhuModel3D, buildOutdoorTree3D, disposeGroupDeep } from "./ahu-model-builders";

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
    deviceType?: string | null;
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
  /** Editable 3D room floorplan props */
  roomVertices?: FloorVertex[];
  isCustomRoom?: boolean;
  canEditRoom?: boolean;
  onSaveRoomVertices?: (vertices: FloorVertex[]) => Promise<void> | void;
  onResetRoomVertices?: () => Promise<void> | void;
  /** ROOMS layer: named rectangular zones with per-room real temps (unknown = null). */
  rooms?: RoomRecord[];
  onSaveRooms?: (rooms: RoomRecord[]) => Promise<void> | void;
  /** Used in placement mode */
  draftAhuId?: string;
  draftAhuName?: string;
  /** Device kind being placed (mount-aware placement: split = wall, dak = ceiling, standing = floor). */
  draftDeviceType?: string | null;
  placement?: PendingPlacement | null;
  onPlacementChange?: (next: PendingPlacement) => void;
}


const STATUS_DOT_CLASS: Record<AhuStatus, string> = {
  RUN: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.75)]",
  STOP: "bg-slate-400",
  FAULT: "bg-red-500 animate-ping",
  OFFLINE: "bg-rose-500",
};


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
  rooms = [],
  onSaveRooms,
  draftAhuId = "AHU-08",
  draftAhuName = "New Air Handling Unit",
  draftDeviceType = null,
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
  // Emits hover state ONLY when the rendered chip content would actually change — during AHU
  // drags this reduces per-frame React re-renders to zero until a cell/zone/validity flips.
  const lastHoverSigRef = useRef<string>("\u0000");
  const pushHoverInfo = useCallback((check: PlacementValidation | null) => {
    const sig = check
      ? `${check.valid ? 1 : 0}|${check.indoor ? 1 : 0}|${check.snappedToWall ? 1 : 0}|${check.snappedX}|${check.snappedZ}|${check.rotation}|${check.valid ? "" : check.reason ?? ""}`
      : "";
    if (sig === lastHoverSigRef.current) return;
    lastHoverSigRef.current = sig;
    setHoverInfo(check);
  }, []);

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
  // Hover is tracked in a ref + applied imperatively in the 3D pool (React re-renders on every
  // pointermove were a major lag source; the scene no longer re-renders at all during drags).
  const hoveredRoomTargetRef = useRef<RoomHoverTarget | null>(null);
  const roomAreaLabelRef = useRef<HTMLSpanElement | null>(null);
  const [savingRoom, setSavingRoom] = useState(false);
  const [roomNotice, setRoomNotice] = useState<string | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);

  // ROOMS layer state (independent zones with per-room temps)
  const [roomsEditing, setRoomsEditing] = useState(false);
  const [roomsDraft, setRoomsDraft] = useState<RoomRecord[]>(rooms);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [hoverRoomId, setHoverRoomId] = useState<string | null>(null);
  const [savingRooms, setSavingRooms] = useState(false);
  const [roomsNotice, setRoomsNotice] = useState<string | null>(null);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const roomsEditingRef = useRef(roomsEditing);
  roomsEditingRef.current = roomsEditing;
  const roomsDraftRef = useRef(roomsDraft);
  roomsDraftRef.current = roomsDraft;
  const selectedRoomIdRef = useRef(selectedRoomId);
  selectedRoomIdRef.current = selectedRoomId;
  const hoverRoomIdRef = useRef(hoverRoomId);
  hoverRoomIdRef.current = hoverRoomId;
  /** live corner drag: { roomId, corner 0..3 } while the pointer is down. */
  const roomCornerDragRef = useRef<{ roomId: string; corner: number } | null>(null);
  const roomCornerDragXY = useRef<{ x: number; y: number } | null>(null);
  /** per-frame hover update throttle for room floors */
  const roomHoverDirtyRef = useRef(false);
  const roomLabelElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const roomsDirtyRef = useRef(false);

  useEffect(() => {
    if (!roomsEditing) setRoomsDraft(rooms);
  }, [rooms, roomsEditing]);


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
  // Optimistically pins a just-saved AHU at its new 3D coordinates until the polled overview
  // delivers the persisted row (prevents a visible jump-back without blocking the Save button).
  const [savedPlacementOverrides, setSavedPlacementOverrides] = useState<
    Map<string, PendingPlacement>
  >(new Map());

  const resolvedUnits = useMemo(() => {
    const acc: Array<{ id: string; x: number; z: number; rotation?: number }> = [];
    return items.map((item) => {
      const ov = savedPlacementOverrides.get(item.ahu.id);
      const ahu = ov
        ? {
            ...item.ahu,
            mapX: ov.x,
            mapZ: ov.z,
            mapRotation: ov.rotation,
            mapZone: ov.zoneLabel,
          }
        : item.ahu;
      const p = resolveAhuPlacement(ahu, acc, activeRoomVertices);
      acc.push({ id: item.ahu.id, x: p.x, z: p.z, rotation: p.rotation });
      return { item, placement: p };
    });
  }, [items, activeRoomVertices, savedPlacementOverrides]);

  /** Per-room real temperature: a unit INSIDE the room with a real room_temp reading; else null (blank). */
  const roomTemps = useMemo(() => {
    const temps: Record<string, number | null> = {};
    for (const room of roomsDraft) {
      let temp: number | null = null;
      for (const u of resolvedUnits) {
        if (u.item.values.roomTemp != null && roomAt([room], u.placement.x, u.placement.z)) {
          temp = u.item.values.roomTemp;
          break;
        }
      }
      temps[room.id] = temp;
    }
    return temps;
  }, [roomsDraft, resolvedUnits]);


  // Retire an optimistic override as soon as the polled fleet data confirms the saved position
  useEffect(() => {
    setSavedPlacementOverrides((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Map(prev);
      for (const [id, ov] of prev) {
        const card = items.find((i) => i.ahu.id === id);
        if (
          card &&
          card.ahu.mapX != null &&
          card.ahu.mapZ != null &&
          Math.abs(card.ahu.mapX - ov.x) < 0.05 &&
          Math.abs(card.ahu.mapZ - ov.z) < 0.05
        ) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
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
    hoveredRoomTargetRef.current = null;
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
      hoveredRoomTargetRef.current = null;
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
    pushHoverInfo(null);
    setMoveError(null);
  }, [pushHoverInfo]);

  const confirmMoveSave = useCallback(async () => {
    if (!movingAhuId || !moveDraft || !onMoveAhuSave) return;
    setSavingMove(true);
    setMoveError(null);
    try {
      await onMoveAhuSave(movingAhuId, moveDraft);
      const finishedId = movingAhuId;
      const savedPlacement = moveDraft;
      setMovingAhuId(null);
      setMoveDraft(null);
      pushHoverInfo(null);
      // Keep the unit visually pinned at its saved spot until the poll confirms it
      setSavedPlacementOverrides((prev) => new Map(prev).set(finishedId, savedPlacement));
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
  // Mount-aware placement (DEL-60): which device kind is being placed / moved.
  const draftDeviceTypeRef = useRef<string | null>(draftDeviceType);
  draftDeviceTypeRef.current = draftDeviceType;
  const movingDeviceTypeRef = useRef<string | null>(null);
  movingDeviceTypeRef.current =
    resolvedUnits.find((u) => u.item.ahu.id === movingAhuId)?.item.ahu.deviceType ?? null;

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
    roomsFloorGroup: THREE.Group;
    roomsHandleGroup: THREE.Group;
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
    roomPool: RoomMeshPool;
    wallSnapBeam: THREE.Mesh;
    wallSnapRail: THREE.Mesh;
  } | null>(null);

  /** Reuses two persistent highlight meshes (no geometry churn) — safe to call every animation frame. */
  const updateWallSnapHighlight = useCallback((seg: WallSegment | null) => {
    const objs = ahuSceneObjectsRef.current;
    if (!objs) return;
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

    objs.wallSnapBeam.scale.set(len + 0.2, 2.96, 0.44);
    objs.wallSnapBeam.position.set(midX, 1.48, midZ);
    objs.wallSnapBeam.rotation.y = angleY;

    objs.wallSnapRail.scale.set(len + 0.28, 0.15, 0.52);
    objs.wallSnapRail.position.set(midX, 2.95, midZ);
    objs.wallSnapRail.rotation.y = angleY;

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
    // PCFSoftShadowMap was removed in three r187 — PCF is the engine's actual fallback.
    renderer.shadowMap.type = THREE.PCFShadowMap;
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

    // ROOMS layer: colored floor zones + corner handles (independent of walls)
    const roomsFloorGroup = new THREE.Group();
    roomsFloorGroup.renderOrder = 1;
    scene.add(roomsFloorGroup);
    const roomsHandleGroup = new THREE.Group();
    scene.add(roomsHandleGroup);

    // Persistent wall-snap highlight meshes (reused in place — never rebuilt per hover)
    const wallSnapBeam = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.32 }),
    );
    wallSnapBeam.visible = true;
    wallSnapBeam.frustumCulled = false;
    wallSnapLineGroup.add(wallSnapBeam);

    const wallSnapRail = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0x059669 }),
    );
    wallSnapRail.visible = true;
    wallSnapRail.frustumCulled = false;
    wallSnapLineGroup.add(wallSnapRail);

    // Pooled, in-place-updatable 3D room (floor slab / clipped grid / walls / columns / CAD gizmos)
    const roomPool = new RoomMeshPool(facilityGroup, roomWallGizmoGroup, roomVertexGizmoGroup, sharedMats);
    roomPool.sync(activeRoomVerticesRef.current, {
      editing: editingRoomRef.current,
      tool: roomToolRef.current,
      hovered: hoveredRoomTargetRef.current,
    });

    ahuSceneObjectsRef.current = {
      facilityGroup,
      roomVertexGizmoGroup,
      roomWallGizmoGroup,
      roomsFloorGroup,
      roomsHandleGroup,
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
      roomPool,
      wallSnapBeam,
      wallSnapRail,
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
          grabDeltaX: number;
          grabDeltaZ: number;
          grabNormalOffset: number;
          latestVerts: FloorVertex[] | null;
        }
      | null = null;
    // Pointer events arrive at 125Hz–1000Hz; drag math is coalesced to one application per
    // animation frame via these pending markers (the single biggest lag fix).
    let pendingRoomDragX = 0;
    let pendingRoomDragY = 0;
    let roomDragPending = false;
    let pendingGhostX = 0;
    let pendingGhostY = 0;
    let ghostMovePending = false;
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

      // DEL-60: AC devices mount realistically — split snaps flush onto a wall,
      // dak hangs from the ceiling slab indoors, standing stands on the floor.
      const activeDeviceType = mode === "placement" ? draftDeviceTypeRef.current : movingDeviceTypeRef.current;
      if (isAcDeviceType(activeDeviceType)) {
        return resolveAcDevicePlacement(activeDeviceType, planeHit.x, planeHit.z, existingCoordsRef.current, {
          excludeId: activeMovingId ?? undefined,
          rotation: baseRot,
          roomVertices: activeRoomVerticesRef.current,
        });
      }

      return resolveWallPhysicsAndSnap(planeHit.x, planeHit.z, existingCoordsRef.current, {
        excludeId: activeMovingId ?? undefined,
        rotation: baseRot,
        enableWallSnap: wallSnapRef.current,
        autoAlignRotation: wallSnapRef.current && !manualRotLockedRef.current,
        clampVoidToWall: true,
        roomVertices: activeRoomVerticesRef.current,
        gridStep: ROOM_GRID_SNAP_STEP,
      });
    };

    const applyGhostPreview = (check: PlacementValidation) => {
      pushHoverInfo(check);
      updateWallSnapHighlight(check.snappedToWall ? check.snappedWall : null);
      const objs = ahuSceneObjectsRef.current;
      if (!objs) return;
      // Rebuild the ghost model ONLY when its look (indoor/outdoor × valid/invalid) changes;
      // while dragging across open ground it is merely repositioned — no geometry churn.
      const activeDeviceType = mode === "placement" ? draftDeviceTypeRef.current : movingDeviceTypeRef.current;
      const ghostKey = `${activeDeviceType ?? "AHU"}|${check.indoor ? 1 : 0}|${check.valid ? 1 : 0}`;
      if (objs.ghostGroup.children.length === 0 || objs.ghostGroup.userData.ghostKey !== ghostKey) {
        disposeGroupDeep(objs.ghostGroup);
        const built = buildAhuModel3D({
          id: "GHOST",
          status: "RUN",
          hasHeater: false,
          outdoor: !check.indoor,
          deviceType: activeDeviceType ?? undefined,
          isGhost: true,
          isValidGhost: check.valid,
        });
        objs.ghostGroup.add(built.group);
        objs.ghostGroup.userData.ghostKey = ghostKey;
      }
      objs.ghostGroup.children[0].rotation.y = (-check.rotation * Math.PI) / 180;
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

    const findHitRoomCorner = (): { roomId: string; corner: number } | null => {
      const objs = ahuSceneObjectsRef.current;
      if (!objs) return null;
      const hits = raycaster.intersectObjects(objs.roomsHandleGroup.children, true);
      for (const h of hits) {
        if (typeof h.object.userData?.roomId === "string" && typeof h.object.userData?.roomCorner === "number") {
          return { roomId: h.object.userData.roomId as string, corner: h.object.userData.roomCorner as number };
        }
      }
      return null;
    };

    const findHitRoomFloor = (): string | null => {
      const objs = ahuSceneObjectsRef.current;
      if (!objs) return null;
      const hits = raycaster.intersectObjects(objs.roomsFloorGroup.children, true);
      for (const h of hits) {
        if (typeof h.object.userData?.roomId === "string") return h.object.userData.roomId as string;
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

      // ── ROOMS editor: corner drag / room selection ──
      if (roomsEditingRef.current && e.button === 0) {
        updateNdc(e.clientX, e.clientY);
        raycaster.setFromCamera(pointerNdc, camera);
        const cornerHit = findHitRoomCorner();
        if (cornerHit) {
          roomCornerDragRef.current = cornerHit;
          domEl.style.cursor = "grabbing";
          domEl.setPointerCapture?.(e.pointerId);
          return;
        }
        const floorHit = findHitRoomFloor();
        setSelectedRoomId(floorHit);
        setHoverRoomId(floorHit);
        domEl.setPointerCapture?.(e.pointerId);
        return;
      }

      if (editingRoomRef.current && e.button === 0) {
        updateNdc(e.clientX, e.clientY);
        raycaster.setFromCamera(pointerNdc, camera);
        const tool = roomToolRef.current;

        if (tool === "drag") {
          const vIdx = findHitRoomVertex();
          if (vIdx !== null) {
            // Compensate the ray→floor parallax offset so the grabbed corner tracks the cursor 1:1
            updateNdc(e.clientX, e.clientY);
            raycaster.setFromCamera(pointerNdc, camera);
            let grabDeltaX = 0;
            let grabDeltaZ = 0;
            if (raycaster.ray.intersectPlane(floorPlane, planeHit)) {
              const grabbed = activeRoomVerticesRef.current[vIdx];
              if (grabbed) {
                grabDeltaX = planeHit.x - grabbed.x;
                grabDeltaZ = planeHit.z - grabbed.z;
              }
            }
            draggingRoomElement = {
              type: "vertex",
              index: vIdx,
              startVertices: activeRoomVerticesRef.current.map((v) => ({ ...v })),
              undoRecorded: false,
              grabDeltaX,
              grabDeltaZ,
              grabNormalOffset: 0,
              latestVerts: null,
            };
            domEl.style.cursor = "grabbing";
            domEl.setPointerCapture?.(e.pointerId);
            return;
          }
          const wHit = findHitRoomWall();
          if (wHit !== null) {
            // Remember where along the wall's normal it was grabbed so the wall follows the cursor
            // exactly (no snap-jump on first move) while still landing on grid lines.
            const verts = activeRoomVerticesRef.current;
            const wa = verts[wHit.edgeIndex];
            const wb = verts[(wHit.edgeIndex + 1) % verts.length];
            let grabNormalOffset = 0;
            if (wa && wb) {
              const wdx = wb.x - wa.x;
              const wdz = wb.z - wa.z;
              const wlen = Math.hypot(wdx, wdz) || 1;
              grabNormalOffset =
                (wHit.point.x - (wa.x + wb.x) / 2) * (-wdz / wlen) +
                (wHit.point.z - (wa.z + wb.z) / 2) * (wdx / wlen);
            }
            draggingRoomElement = {
              type: "wall",
              index: wHit.edgeIndex,
              startVertices: verts.map((v) => ({ ...v })),
              undoRecorded: false,
              grabDeltaX: 0,
              grabDeltaZ: 0,
              grabNormalOffset,
              latestVerts: null,
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

      // ROOMS corner drag: defer to the animation frame (same pattern as hall-vertex drags)
      if (roomCornerDragRef.current && isDragging) {
        roomCornerDragXY.current = { x: e.clientX, y: e.clientY };
        roomHoverDirtyRef.current = false;
        movedDist += Math.hypot(e.clientX - lastX, e.clientY - lastY);
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }

      // ROOMS hover highlight (cheap: a few floor planes)
      if (!movingAhuIdRef.current && mode === "explore") {
        updateNdc(e.clientX, e.clientY);
        raycaster.setFromCamera(pointerNdc, camera);
        const hit = findHitRoomFloor();
        if (hit !== hoverRoomIdRef.current) {
          setHoverRoomId(hit);
          domEl.style.cursor = roomsEditingRef.current && hit ? "pointer" : "default";
        }
      }

      if (isDragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        movedDist += Math.hypot(dx, dy);

        // Direct 3D Wall or Corner Vertex CAD Dragging!
        // Perf: only RECORD the pointer position here (pointermove can fire at 125–1000Hz).
        // The actual snap math + 3D pool update happens exactly once per animation frame below.
        if (draggingRoomElement && editingRoomRef.current) {
          pendingRoomDragX = e.clientX;
          pendingRoomDragY = e.clientY;
          roomDragPending = true;
          return;
        }

        if (isDraggingModelDirectly && isEditingPlacement) {
          pendingGhostX = e.clientX;
          pendingGhostY = e.clientY;
          ghostMovePending = true;
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
      // Perf: state lives in a ref + pooled meshes; React never re-renders on hover.
      if (editingRoomRef.current) {
        const objs = ahuSceneObjectsRef.current;
        const tool = roomToolRef.current;
        if (objs) objs.splitPreviewOrb.visible = false;

        let nextHover: RoomHoverTarget | null = null;
        let nextCursor = "grab";

        if (tool === "delete") {
          const vIdx = findHitRoomVertex();
          if (vIdx !== null) {
            nextHover = { type: "vertex", index: vIdx };
            nextCursor = "pointer";
          }
        } else if (tool === "split") {
          const wHit = findHitRoomWall();
          if (wHit && objs) {
            const verts = activeRoomVerticesRef.current;
            const a = verts[wHit.edgeIndex];
            const b = verts[(wHit.edgeIndex + 1) % verts.length];
            const len = a && b ? Math.hypot(b.x - a.x, b.z - a.z) : 0;
            if (a && b && len >= 2.2) {
              // Preview the EXACT insertion point: clamped along the wall, then snapped onto
              // the visible 2m floor-grid intersections — identical to insertVertexOnWall().
              const proj = projectPointToSegment(wHit.point.x, wHit.point.z, a.x, a.z, b.x, b.z);
              const minT = 1.1 / len;
              const t = Math.min(1 - minT, Math.max(minT, proj.t));
              const snapStep = roomSnapGridRef.current ? ROOM_GRID_SNAP_STEP : 0.05;
              objs.splitPreviewOrb.position.set(
                snapToPlatformGrid(a.x + (b.x - a.x) * t, snapStep),
                2.98,
                snapToPlatformGrid(a.z + (b.z - a.z) * t, snapStep),
              );
              objs.splitPreviewOrb.visible = true;
            }
            nextHover = { type: "wall", index: wHit.edgeIndex };
            nextCursor = "copy";
          }
        } else if (tool === "extrude") {
          const wHit = findHitRoomWall();
          if (wHit) {
            nextHover = { type: "wall", index: wHit.edgeIndex };
            nextCursor = "cell";
          }
        } else {
          // Default "drag" tool: check vertices first, then walls
          const vIdx = findHitRoomVertex();
          if (vIdx !== null) {
            nextHover = { type: "vertex", index: vIdx };
            nextCursor = "move";
          } else {
            const wHit = findHitRoomWall();
            if (wHit !== null) {
              nextHover = { type: "wall", index: wHit.edgeIndex };
              nextCursor = "ew-resize";
            }
          }
        }

        const prev = hoveredRoomTargetRef.current;
        const changed =
          (prev === null) !== (nextHover === null) ||
          (prev !== null &&
            nextHover !== null &&
            (prev.type !== nextHover.type || prev.index !== nextHover.index));
        if (changed) {
          hoveredRoomTargetRef.current = nextHover;
          objs?.roomPool.sync(activeRoomVerticesRef.current, {
            editing: true,
            tool,
            hovered: nextHover,
          });
        }
        domEl.style.cursor = nextCursor;
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
      // ROOMS corner drag commit: snap the final rect into React state exactly once
      if (roomCornerDragRef.current) {
        const { roomId, corner } = roomCornerDragRef.current;
        const last = roomCornerDragXY.current;
        roomCornerDragRef.current = null;
        roomCornerDragXY.current = null;
        domEl.style.cursor = "default";
        if (last) {
          updateNdc(last.x, last.y);
          raycaster.setFromCamera(pointerNdc, camera);
          if (raycaster.ray.intersectPlane(floorPlane, planeHit)) {
            const x = snapRoom(planeHit.x);
            const z = snapRoom(planeHit.z);
            const idx = roomsDraftRef.current.findIndex((r) => r.id === roomId);
            if (idx >= 0) {
              const room = roomsDraftRef.current[idx];
              const next = { ...room };
              if (corner === 0 || corner === 3) next.x1 = x;
              else next.x2 = x;
              if (corner === 0 || corner === 1) next.z1 = z;
              else next.z2 = z;
              const rect = normalizeRoomRect(next.x1, next.z1, next.x2, next.z2);
              if (!("error" in rect)) {
                roomsDraftRef.current = roomsDraftRef.current.map((r, i) => (i === idx ? { ...r, ...rect } : r));
                setRoomsDraft(roomsDraftRef.current);
              }
            }
          }
        }
      }

      const wasDraggingModel = isDraggingModelDirectly;
      const finishedRoomDrag = draggingRoomElement;
      if (isDragging) {
        isDragging = false;
        isDraggingModelDirectly = false;
        draggingRoomElement = null;
        domEl.releasePointerCapture?.(e.pointerId);
      }

      // Commit the drag's final snapped geometry to React exactly ONCE (the 3D pool already
      // matches it visually, so the resulting re-render is a near-zero-cost no-op).
      if (finishedRoomDrag) {
        roomDragPending = false;
        if (finishedRoomDrag.latestVerts) {
          setRoomDraftVertices(finishedRoomDrag.latestVerts);
        }
      }
      ghostMovePending = false;

      const clickDelta = Math.hypot(e.clientX - downX, e.clientY - downY);
      const isCleanClick = movedDist < 6 && clickDelta < 6 && e.button === 0;

      // Room Editor click actions (Split Wall, Extrude Wing, Delete Corner, or Double-Click Wall to Split!)
      if (editingRoomRef.current && isCleanClick) {
        updateNdc(e.clientX, e.clientY);
        raycaster.setFromCamera(pointerNdc, camera);
        const tool = roomToolRef.current;
        const verts = finishedRoomDrag?.latestVerts ?? activeRoomVerticesRef.current;
        const snapStep = roomSnapGridRef.current ? ROOM_GRID_SNAP_STEP : 0.05;

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
              hoveredRoomTargetRef.current = null;
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
            pushHoverInfo(check);
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
        hoveredRoomTargetRef.current = null;
        objs.roomPool.sync(activeRoomVerticesRef.current, {
          editing: editingRoomRef.current,
          tool: roomToolRef.current,
          hovered: null,
        });
      }
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
    // Manual frame timing (THREE.Clock is deprecated in three r187): clamped delta keeps
    // physics stable after tab pauses, and the accumulator drives pulsing animations.
    let lastFrameTime = performance.now();
    let elapsed = 0;

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
      lastFrameTime = now;
      elapsed += dt;

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

      // ── Per-frame coalesced Room CAD drag application (runs AT MOST once per frame) ──
      // Pointermove only records coordinates; all snap math + 3D pool updates happen here,
      // directly against the pooled meshes — React state is committed only on pointer-up.
      if (roomDragPending && draggingRoomElement && editingRoomRef.current && objs) {
        roomDragPending = false;
        updateNdc(pendingRoomDragX, pendingRoomDragY);
        raycaster.setFromCamera(pointerNdc, camera);
        if (raycaster.ray.intersectPlane(floorPlane, planeHit)) {
          const snapStep = roomSnapGridRef.current ? ROOM_GRID_SNAP_STEP : 0.05;
          const nextVerts =
            draggingRoomElement.type === "vertex"
              ? moveFloorVertex(
                  draggingRoomElement.startVertices,
                  draggingRoomElement.index,
                  planeHit.x,
                  planeHit.z,
                  snapStep,
                  { dx: draggingRoomElement.grabDeltaX, dz: draggingRoomElement.grabDeltaZ },
                )
              : dragFloorWall(
                  draggingRoomElement.startVertices,
                  draggingRoomElement.index,
                  planeHit.x,
                  planeHit.z,
                  snapStep,
                  draggingRoomElement.grabNormalOffset,
                );

          if (nextVerts !== draggingRoomElement.startVertices) {
            if (!draggingRoomElement.undoRecorded) {
              pushRoomUndoRef.current(draggingRoomElement.startVertices);
              draggingRoomElement.undoRecorded = true;
            }
            draggingRoomElement.latestVerts = nextVerts;
            objs.roomPool.sync(nextVerts, {
              editing: true,
              tool: roomToolRef.current,
              hovered: hoveredRoomTargetRef.current,
            });
            const areaEl = roomAreaLabelRef.current;
            if (areaEl) {
              areaEl.textContent = `${computePolygonAreaSqM(nextVerts)} m² · ${nextVerts.length} Corners`;
            }
          }
        }
      }

      // ── Per-frame coalesced AHU placement/move ghost update ──
      if (ghostMovePending && isDraggingModelDirectly && !draggingRoomElement && objs) {
        ghostMovePending = false;
        updateNdc(pendingGhostX, pendingGhostY);
        raycaster.setFromCamera(pointerNdc, camera);
        if (raycaster.ray.intersectPlane(floorPlane, planeHit)) {
          const check = evaluatePhysicsAtRay();
          pushHoverInfo(check);
          updateWallSnapHighlight(check.snappedToWall ? check.snappedWall : null);
          commitPlacementFromCheck(check);
        }
      }

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

      // ROOMS: apply deferred corner drag once per frame (plane intersect → grid snap)
      if (roomCornerDragRef.current && roomCornerDragXY.current) {
        updateNdc(roomCornerDragXY.current.x, roomCornerDragXY.current.y);
        raycaster.setFromCamera(pointerNdc, camera);
        if (raycaster.ray.intersectPlane(floorPlane, planeHit)) {
          applyRoomCornerDrag(
            roomCornerDragRef.current.roomId,
            roomCornerDragRef.current.corner,
            snapRoom(planeHit.x),
            snapRoom(planeHit.z),
          );
        }
      }

      const cw = domEl.clientWidth;
      const ch = domEl.clientHeight;
      // ROOMS: project per-room temp labels
      for (const room of roomsDraftRef.current) {
        const el = roomLabelElsRef.current.get(room.id);
        if (!el) continue;
        const center = roomCenter(room);
        projVec.set(center.x, 0.5, center.z);
        projVec.project(camera);
        if (projVec.z < -1 || projVec.z > 1) {
          el.style.opacity = "0";
          continue;
        }
        const sx = (projVec.x * 0.5 + 0.5) * cw;
        const sy = (-projVec.y * 0.5 + 0.5) * ch;
        const isActive = hoverRoomIdRef.current === room.id || selectedRoomIdRef.current === room.id;
        el.style.opacity = isActive ? "1" : "0.82";
        el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -50%)`;
      }
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
      ahuSceneObjectsRef.current?.roomPool.dispose();
      renderer.dispose();
      ahuSceneObjectsRef.current = null;
    };
  }, [mode, setSelectedId, updateWallSnapHighlight]);

  // Sync the pooled 3D room to React state changes (drag commits, tool switches, edit mode).
  // During active drags this is a no-op: the animation loop already applied the identical
  // geometry directly to the pool, and the pool early-returns when nothing changed.
  useEffect(() => {
    const objs = ahuSceneObjectsRef.current;
    if (!objs) return;
    objs.roomPool.sync(activeRoomVertices, {
      editing: editingRoom,
      tool: roomTool,
      hovered: hoveredRoomTargetRef.current,
    });
  }, [activeRoomVertices, editingRoom, roomTool]);

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

  // ── ROOMS layer: floor zones + corner handles (rebuilt on draft/hover/selection change) ──
  const roomFloorMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());

  useEffect(() => {
    const objs = ahuSceneObjectsRef.current;
    if (!objs) return;
    const floors = objs.roomsFloorGroup;
    disposeGroupDeep(floors);
    roomFloorMeshesRef.current.clear();

    for (const room of roomsDraft) {
      const w = Math.max(0.1, room.x2 - room.x1);
      const d = Math.max(0.1, room.z2 - room.z1);
      const hovered = hoverRoomIdRef.current === room.id;
      const selected = selectedRoomIdRef.current === room.id;
      const color = new THREE.Color(room.color);
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: hovered || selected ? 0.34 : 0.14,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set((room.x1 + room.x2) / 2, 0.03, (room.z1 + room.z2) / 2);
      floor.renderOrder = 2;
      floor.userData = { roomId: room.id };
      floors.add(floor);
      roomFloorMeshesRef.current.set(room.id, floor);

      // subtle border
      const border = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(room.x1, 0.05, room.z1),
          new THREE.Vector3(room.x2, 0.05, room.z1),
          new THREE.Vector3(room.x2, 0.05, room.z2),
          new THREE.Vector3(room.x1, 0.05, room.z2),
        ]),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: hovered || selected ? 0.95 : 0.5 }),
      );
      floors.add(border);
    }

    // corner handles for the SELECTED room while editing
    disposeGroupDeep(objs.roomsHandleGroup);
    if (roomsEditingRef.current) {
      const sel = roomsDraftRef.current.find((r) => r.id === selectedRoomIdRef.current);
      if (sel) {
        const corners: Array<[number, number]> = [
          [sel.x1, sel.z1],
          [sel.x2, sel.z1],
          [sel.x2, sel.z2],
          [sel.x1, sel.z2],
        ];
        corners.forEach(([cx, cz], corner) => {
          const handle = new THREE.Mesh(
            new THREE.SphereGeometry(0.22, 14, 14),
            new THREE.MeshBasicMaterial({ color: 0xffffff }),
          );
          handle.position.set(cx, 0.16, cz);
          handle.userData = { roomId: sel.id, roomCorner: corner };
          objs.roomsHandleGroup.add(handle);
        });
      }
    }
  }, [roomsDraft, hoverRoomId, selectedRoomId, roomsEditing]);

  /** Imperatively re-positions a room's floor/border + handles during a corner drag (no re-render). */
  const applyRoomCornerDrag = useCallback((roomId: string, corner: number, x: number, z: number) => {
    const idx = roomsDraftRef.current.findIndex((r) => r.id === roomId);
    if (idx < 0) return;
    const room = roomsDraftRef.current[idx];
    const next = { ...room };
    if (corner === 0 || corner === 3) next.x1 = x;
    else next.x2 = x;
    if (corner === 0 || corner === 1) next.z1 = z;
    else next.z2 = z;
    // normalize live so the rect stays valid while dragging
    const xs = [next.x1, next.x2].sort((a, b) => a - b);
    const zs = [next.z1, next.z2].sort((a, b) => a - b);
    const norm = { ...room, x1: xs[0], x2: xs[1], z1: zs[0], z2: zs[1] };
    roomsDraftRef.current = roomsDraftRef.current.map((r, i) => (i === idx ? norm : r));

    const floor = roomFloorMeshesRef.current.get(roomId);
    if (floor) {
      const w = Math.max(0.1, norm.x2 - norm.x1);
      const d = Math.max(0.1, norm.z2 - norm.z1);
      floor.geometry.dispose();
      floor.geometry = new THREE.PlaneGeometry(w, d);
      floor.position.set((norm.x1 + norm.x2) / 2, 0.03, (norm.z1 + norm.z2) / 2);
    }
    const objs = ahuSceneObjectsRef.current;
    if (objs) {
      const corners: Array<[number, number]> = [
        [norm.x1, norm.z1],
        [norm.x2, norm.z1],
        [norm.x2, norm.z2],
        [norm.x1, norm.z2],
      ];
      objs.roomsHandleGroup.children.forEach((h, i) => {
        const [cx, cz] = corners[i] ?? [0, 0];
        h.position.set(cx, 0.16, cz);
      });
    }
  }, []);

  // Rebuild 3D AHU models whenever unit statuses, positions, or moving state change
  useEffect(() => {
    const objs = ahuSceneObjectsRef.current;
    if (!objs) return;
    disposeGroupDeep(objs.ahuRootGroup);
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
        deviceType: item.ahu.deviceType,
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

  // Sync placed draft 3D AHU model (both in Add-AHU placement mode AND in Move-AHU mode).
  // Rebuilds the model ONLY when its look changes (unit / indoor / status); while dragging it
  // merely repositions the existing group in place — zero allocations per frame.
  useEffect(() => {
    const objs = ahuSceneObjectsRef.current;
    if (!objs) return;
    const activeDraft = mode === "placement" ? placement : moveDraft;
    const activeId = mode === "placement" ? draftAhuId : movingAhuId;
    if (!activeDraft || !activeId) {
      objs.placedDraftGroup.visible = false;
      objs.ghostGroup.visible = false;
      objs.wallSnapLineGroup.visible = false;
      objs.placedDraftGroup.userData.modelKey = "";
      return;
    }
    const movingSource = resolvedUnits.find((u) => u.item.ahu.id === activeId);
    const status = movingSource?.item.status ?? "RUN";
    const draftType = movingSource?.item.ahu.deviceType ?? (mode === "placement" ? draftDeviceType : null);
    const modelKey = `${mode}|${activeId}|${draftType ?? "AHU"}|${activeDraft.indoor ? 1 : 0}|${status}`;
    if (objs.placedDraftGroup.userData.modelKey !== modelKey || objs.placedDraftGroup.children.length === 0) {
      disposeGroupDeep(objs.placedDraftGroup);
      const built = buildAhuModel3D({
        id: activeId,
        status,
        hasHeater: movingSource?.item.ahu.hasHeater ?? true,
        outdoor: !activeDraft.indoor,
        deviceType: draftType,
      });
      built.halo.material = new THREE.MeshBasicMaterial({
        color: 0x10b981,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.88,
      });
      objs.placedDraftGroup.add(built.group);
      objs.placedDraftGroup.userData.modelKey = modelKey;
    }
    objs.placedDraftGroup.children[0].rotation.y = (-activeDraft.rotation * Math.PI) / 180;
    objs.placedDraftGroup.position.set(activeDraft.x, 0, activeDraft.z);
    objs.placedDraftGroup.visible = true;
  }, [mode, placement, moveDraft, draftAhuId, draftDeviceType, movingAhuId, resolvedUnits]);

  const indoorCount = resolvedUnits.filter((u) => u.placement.indoor).length;
  const outdoorCount = resolvedUnits.length - indoorCount;

  const rotateActiveDraft90 = useCallback(
    (direction: 1 | -1 = 1) => {
      setManualRotLocked(true);
      if (mode === "placement" && placement && onPlacementChange) {
        const nextRot = normalizeRotation(placement.rotation + 90 * direction);
        const check = isAcDeviceType(draftDeviceType)
          ? resolveAcDevicePlacement(draftDeviceType, placement.x, placement.z, existingCoords, {
              rotation: nextRot,
              roomVertices: activeRoomVertices,
            })
          : resolveWallPhysicsAndSnap(placement.x, placement.z, existingCoords, {
          rotation: nextRot,
          enableWallSnap: wallSnapEnabled,
          autoAlignRotation: false,
          clampVoidToWall: true,
          roomVertices: activeRoomVertices,
          gridStep: ROOM_GRID_SNAP_STEP,
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
        const nextRot = normalizeRotation(moveDraft.rotation + 90 * direction);
        const movingType = movingDeviceTypeRef.current;
        const check = isAcDeviceType(movingType)
          ? resolveAcDevicePlacement(movingType, moveDraft.x, moveDraft.z, existingCoords, {
              excludeId: movingAhuId,
              rotation: nextRot,
              roomVertices: activeRoomVertices,
            })
          : resolveWallPhysicsAndSnap(moveDraft.x, moveDraft.z, existingCoords, {
          excludeId: movingAhuId,
          rotation: nextRot,
          enableWallSnap: wallSnapEnabled,
          autoAlignRotation: false,
          clampVoidToWall: true,
          roomVertices: activeRoomVertices,
          gridStep: ROOM_GRID_SNAP_STEP,
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
    },
    [mode, placement, onPlacementChange, existingCoords, wallSnapEnabled, activeRoomVertices, movingAhuId, moveDraft, draftDeviceType],
  );

  // Keyboard rotation while placing or moving an AHU: R = 90° clockwise, Shift+R = counter-clockwise.
  // Ignored while typing in inputs, and while editing the room (R stays reserved there).
  useEffect(() => {
    if (mode !== "placement" && !movingAhuId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "r" && e.key !== "R") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      rotateActiveDraft90(e.shiftKey ? -1 : 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, movingAhuId, rotateActiveDraft90]);

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
                {roomsEditing
                  ? "Rooms Editor · Zones & Temperatures"
                  : editingRoom
                  ? "3D Room Architect · Edit Walls & Corners"
                  : mode === "placement"
                    ? "Place New 3D AHU · Indoor or Outdoor"
                    : movingAhuId
                      ? `Moving ${movingAhuId} in 3D Facility`
                      : "AHU Units · 3D Facility Digital Twin"}
              </h1>
              <span
                ref={roomAreaLabelRef}
                className="hidden rounded-full border border-[#cbe0fd] bg-[#eef5ff] px-2.5 py-0.5 font-mono text-[10px] font-bold text-[#1d6ef2] md:inline-flex"
              >
                {editingRoom
                  ? `${activeRoomAreaSqM} m² · ${activeRoomVertices.length} Corners`
                  : `${indoorCount} Indoor · ${outdoorCount} Outdoor`}
              </span>
            </div>
            <p className="truncate text-[11px] text-[#475569]">
              {roomsEditing
                ? "Drag a room's corner points on the grid · click a colored floor to select · add or remove rooms below"
                : editingRoom
                ? "Drag any wall or corner orb · double-click a wall to add a point · extrude new wings in 1 click"
                : mode === "placement" || movingAhuId
                  ? "Place inside any wing or anywhere outside · snaps onto the 2m floor grid · R / Shift+R rotates 90°"
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
                onClick={() => rotateActiveDraft90(1)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  rotateActiveDraft90(-1);
                }}
                className={cx(hudBtnBase, hudBtnNeutral)}
                title="Rotate 90° clockwise (R) · Shift+R or right-click for counter-clockwise"
              >
                <RotateCw size={12} /> {(mode === "placement" ? placement?.rotation : moveDraft?.rotation) ?? 0}°
                <kbd className="ml-0.5 rounded border border-slate-300 bg-white/80 px-1 font-mono text-[9px] font-bold text-slate-500">
                  R
                </kbd>
              </button>
            </>
          ) : null}

          {/* ROOMS editor Button */}
          {mode === "explore" && canEditRoom && !movingAhuId && !editingRoom ? (
            <button
              type="button"
              onClick={() => {
                if (roomsEditing) {
                  setRoomsEditing(false);
                  setSelectedRoomId(null);
                  setRoomsDraft(rooms);
                  setRoomsError(null);
                  setRoomsNotice(null);
                } else {
                  setRoomsEditing(true);
                  setRoomsDraft(rooms);
                  setRoomsNotice("Drag the corner points to resize a room. Click a colored floor to select it.");
                }
              }}
              className={cx(
                hudBtnBase,
                roomsEditing
                  ? "border-indigo-600 bg-indigo-600 text-white shadow-[0_8px_18px_-6px_rgba(79,70,229,0.75)]"
                  : hudBtnNeutral,
              )}
              title="Edit rooms: add rooms, drag corners on the grid, resize or remove"
            >
              <LayoutGrid size={13} /> {roomsEditing ? "Exit Rooms" : "Rooms"}
            </button>
          ) : null}

          {/* Edit 3D Room Button */}
          {mode === "explore" && canEditRoom && !movingAhuId && !roomsEditing ? (
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
              title="Snap wall & corner drags exactly onto the visible 2m × 2m floor grid lines"
            >
              <Grid size={12} /> {roomSnapGrid ? "Snap 2m Grid" : "Freeform"}
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

        {/* ROOMS editor floating panel */}
        {roomsEditing ? (
          <div className="absolute left-3 top-3 z-20 w-64 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-[0_18px_40px_-16px_rgba(18,41,77,0.4)] backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Rooms ({roomsDraft.length})</span>
              <button
                type="button"
                onClick={() => {
                  const candidate: RoomRecord = {
                    id: `room-${Math.random().toString(36).slice(2, 8)}`,
                    name: `Room ${roomsDraft.length + 1}`,
                    color: nextRoomColor(roomsDraft),
                    x1: -2,
                    z1: -6,
                    x2: 2,
                    z2: -2,
                  };
                  // nudge onto a free spot
                  let rect = { x1: candidate.x1, z1: candidate.z1, x2: candidate.x2, z2: candidate.z2 };
                  for (let attempt = 0; attempt < 40; attempt += 1) {
                    const cx = rect.x1 + (rect.x2 - rect.x1) / 2;
                    const cz = rect.z1 + (rect.z2 - rect.z1) / 2;
                    if (!roomAt(roomsDraft, cx, cz)) break;
                    rect = { x1: rect.x1 + 1, z1: rect.z1 + 1, x2: rect.x2 + 1, z2: rect.z2 + 1 };
                  }
                  const room = { ...candidate, ...rect };
                  setRoomsDraft([...roomsDraft, room]);
                  setSelectedRoomId(room.id);
                  setRoomsNotice(null);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-[#cbe0fd] bg-[#eef5ff] px-2 py-0.5 text-[10.5px] font-bold text-[#1d6ef2] transition hover:bg-[#dceaff]"
              >
                <Plus size={11} /> Add Room
              </button>
            </div>
            <div className="max-h-44 space-y-1 overflow-y-auto">
              {roomsDraft.map((room) => {
                const temp = roomTemps[room.id];
                const sel = selectedRoomId === room.id;
                const size = `${(room.x2 - room.x1).toFixed(1)}×${(room.z2 - room.z1).toFixed(1)} m`;
                return (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => setSelectedRoomId(room.id)}
                    className={cx(
                      "flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition",
                      sel ? "border-[#1d6ef2] bg-[#eef5ff]" : "border-slate-200 hover:bg-slate-50",
                    )}
                  >
                    <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: room.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px] font-bold text-[#12294d]">{room.name}</span>
                      <span className="block font-mono text-[10px] text-slate-400">
                        {size} · {temp != null ? `${temp.toFixed(1)}°C` : "temp unknown"}
                      </span>
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setRoomsDraft(roomsDraft.filter((r) => r.id !== room.id));
                        if (selectedRoomId === room.id) setSelectedRoomId(null);
                      }}
                      className="rounded p-1 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
                      title="Delete room"
                    >
                      <Trash2 size={12} />
                    </span>
                  </button>
                );
              })}
              {roomsDraft.length === 0 ? (
                <p className="px-1 py-2 text-[11px] text-slate-400">No rooms yet — add the first one.</p>
              ) : null}
            </div>
            {roomsNotice ? <p className="mt-2 text-[10.5px] leading-snug text-emerald-600">{roomsNotice}</p> : null}
            {roomsError ? <p className="mt-2 text-[10.5px] leading-snug text-rose-600">{roomsError}</p> : null}
            <div className="mt-2.5 flex gap-1.5">
              <button
                type="button"
                disabled={savingRooms}
                onClick={async () => {
                  setSavingRooms(true);
                  setRoomsError(null);
                  try {
                    await onSaveRooms?.(roomsDraft);
                    setRoomsEditing(false);
                    setSelectedRoomId(null);
                    setRoomsNotice(null);
                  } catch (err) {
                    setRoomsError(err instanceof Error ? err.message : "Failed to save rooms");
                  } finally {
                    setSavingRooms(false);
                  }
                }}
                className="flex-1 rounded-lg bg-[#1d6ef2] px-2 py-1.5 text-[11px] font-bold text-white transition hover:bg-[#1456c7] disabled:opacity-60"
              >
                {savingRooms ? "Saving…" : "Save Rooms"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRoomsEditing(false);
                  setRoomsDraft(rooms);
                  setSelectedRoomId(null);
                  setRoomsError(null);
                  setRoomsNotice(null);
                }}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-bold text-slate-500 transition hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {/* ROOM temp pills: real reading inside the room, or blank (unknown) */}
          {roomsDraft.map((room) => {
            const temp = roomTemps[room.id];
            const active = hoverRoomId === room.id || selectedRoomId === room.id;
            return (
              <div
                key={room.id}
                ref={(el) => {
                  if (el) roomLabelElsRef.current.set(room.id, el);
                  else roomLabelElsRef.current.delete(room.id);
                }}
                style={{ left: 0, top: 0, opacity: 0, borderColor: active ? room.color : undefined }}
                className={cx(
                  "absolute z-[9] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-xl border bg-white/90 px-3 py-1.5 text-center shadow-[0_10px_24px_-10px_rgba(18,41,77,0.35)] backdrop-blur-md transition-[opacity,border-color] duration-150",
                  active ? "shadow-lg" : "",
                )}
              >
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: room.color }} />
                  {room.name}
                </span>
                <span className={cx("font-mono text-[15px] font-bold", temp != null ? "text-[#12294d]" : "text-slate-300")}>
                  {temp != null ? `${temp.toFixed(1)}°C` : "—"}
                </span>
              </div>
            );
          })}
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
                    href={`/ahu/${encodeURIComponent(displayedCardUnit.item.ahu.id)}?from=/ahu`}
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
                    : "Drag 3D AHU or click anywhere indoors or outdoors · R / Shift+R rotates 90°"}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
