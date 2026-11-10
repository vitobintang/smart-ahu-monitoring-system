"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { AhuStatus } from "@/lib/ahu";
import { disposeGroupDeep } from "@/components/ahu-model-builders";

/**
 * AhuDetailed3DView — the detailed 3D "inside of the machine" viewer
 * (2026-11-10). Replaces the flat side-elevation schematic with a rotatable
 * 3D cut-away per device type:
 *
 *   AHU            intake grille → panel filter → (bag filter) → cooling coil
 *                  → heating coil (if fitted) → fan → supply duct
 *   AC_SPLIT_WALL  top intake + filter → angled evaporator coil → cross-flow
 *                  fan → oscillating front louver
 *   AC_DAK         bottom intake → scroll fan → circular coil ring → 4-way
 *                  oscillating louvers (flush with the ceiling)
 *   AC_STANDING    front slats + filter → vertical coil → top discharge fan
 *
 * RUN spins the fans and drives colored airflow particles through the
 * components (blue after the cooling coil, warm after the heater); STOP
 * spools everything down. Drag to rotate, scroll to zoom.
 */

const STATUS_COLOR: Record<AhuStatus, number> = {
  RUN: 0x10b981,
  STOP: 0x94a3b8,
  FAULT: 0xef4444,
  OFFLINE: 0xf43f5e,
};

const COLOR_INTAKE = new THREE.Color(0x8fa3ba);
const COLOR_FILTERED = new THREE.Color(0xcbd5e1);
const COLOR_COOLED = new THREE.Color(0x38bdf8);
const COLOR_HEATED = new THREE.Color(0xfb923c);
const COLOR_OUT = new THREE.Color(0x7dd3fc);

interface Props {
  ahuId: string;
  deviceType?: string | null;
  status: AhuStatus;
  hasHeater: boolean;
  fanSpeed?: number | null;
  className?: string;
}

interface Particle {
  t: number;
  lane: number;
  lift: number;
  speed: number;
}

function buildComponentMeshes(deviceType: string, hasHeater: boolean): {
  group: THREE.Group;
  rotors: THREE.Group[];
  flaps: THREE.Object3D[];
  pathZones: Array<{ at: number; color: THREE.Color }>;
} {
  const group = new THREE.Group();
  const rotors: THREE.Group[] = [];
  const flaps: THREE.Object3D[] = [];
  const pathZones: Array<{ at: number; color: THREE.Color }> = [];

  const std = (color: number, extra?: Partial<THREE.MeshStandardMaterialParameters>) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.2, ...extra });
  const frameMat = std(0x334155, { roughness: 0.6 });
  const whiteMat = std(0xe2e8f0, { roughness: 0.45 });
  const filterMat = std(0xf1f5f9, { roughness: 0.9 });
  const coolMat = std(0x0ea5e9, { roughness: 0.35, metalness: 0.45 });
  const heatMat = std(0xf97316, { roughness: 0.4, metalness: 0.5 });
  const fanMat = std(0x64748b, { roughness: 0.35, metalness: 0.55 });
  const darkMat = std(0x1e293b, { roughness: 0.7 });

  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };

  if (deviceType === "AC_SPLIT_WALL") {
    // 1.1 × 0.32 × 0.2 slab; x = along, z+ = room side (air outlet).
    mesh(new THREE.BoxGeometry(1.04, 0.3, 0.025), whiteMat, 0, 0, -0.09); // back plate
    pathZones.push({ at: 0, color: COLOR_INTAKE });
    mesh(new THREE.BoxGeometry(1.0, 0.05, 0.18), filterMat, 0, 0.115, 0); // top intake filter
    pathZones.push({ at: 0.22, color: COLOR_FILTERED });
    // angled evaporator coil: two fin stacks in a shallow V
    const fin = new THREE.BoxGeometry(0.96, 0.2, 0.028);
    const coilA = mesh(fin, coolMat, 0, 0.02, -0.02);
    coilA.rotation.x = 0.5;
    const coilB = mesh(fin, coolMat, 0, 0.02, 0.02);
    coilB.rotation.x = -0.5;
    pathZones.push({ at: 0.45, color: COLOR_COOLED });
    // cross-flow fan: long rotor with curved blades along x
    const rotor = new THREE.Group();
    rotor.position.set(0, -0.06, 0.02);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.92, 12), fanMat);
    shaft.rotation.z = Math.PI / 2;
    rotor.add(shaft);
    for (let b = 0; b < 18; b += 1) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.012, 0.07), fanMat);
      blade.rotation.x = (b / 18) * Math.PI * 2;
      blade.position.applyAxisAngle(new THREE.Vector3(1, 0, 0), (b / 18) * Math.PI * 2);
      blade.position.set(0, Math.sin((b / 18) * Math.PI * 2) * 0.075, 0.02 + Math.cos((b / 18) * Math.PI * 2) * 0.075);
      rotor.add(blade);
    }
    rotors.push(rotor);
    group.add(rotor);
    // front louver flap (oscillates in RUN)
    const flap = mesh(new THREE.BoxGeometry(0.98, 0.02, 0.1), whiteMat, 0, -0.13, 0.075);
    flap.rotation.x = 0.7;
    flaps.push(flap);
    pathZones.push({ at: 0.85, color: COLOR_OUT });
    return { group, rotors, flaps, pathZones };
  }

  if (deviceType === "AC_DAK") {
    // 0.95 square cassette, y = height (ceiling at +0.22).
    mesh(new THREE.BoxGeometry(0.9, 0.1, 0.9), whiteMat, 0, 0.16, 0); // frame
    mesh(new THREE.BoxGeometry(0.62, 0.025, 0.62), filterMat, 0, 0.0, 0); // bottom intake filter
    pathZones.push({ at: 0, color: COLOR_INTAKE });
    // circular coil ring: 12 fin segments around the center
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      const seg = mesh(new THREE.BoxGeometry(0.16, 0.18, 0.03), coolMat, Math.cos(a) * 0.24, 0.1, Math.sin(a) * 0.24);
      seg.rotation.y = -a;
    }
    pathZones.push({ at: 0.42, color: COLOR_COOLED });
    // scroll fan: horizontal rotor spinning around Y
    const rotor = new THREE.Group();
    rotor.position.set(0, 0.2, 0);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 16), fanMat);
    rotor.add(hub);
    for (let b = 0; b < 7; b += 1) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.09), fanMat);
      const a = (b / 7) * Math.PI * 2;
      blade.position.set(Math.cos(a) * 0.17, 0, Math.sin(a) * 0.17);
      blade.rotation.y = -a + 0.6;
      rotor.add(blade);
    }
    rotors.push(rotor);
    group.add(rotor);
    // four-way discharge louvers (oscillate)
    for (const s of [-1, 1]) {
      const fx = mesh(new THREE.BoxGeometry(0.5, 0.03, 0.06), whiteMat, 0, -0.02, s * 0.31);
      flaps.push(fx);
      const fz = mesh(new THREE.BoxGeometry(0.06, 0.03, 0.5), whiteMat, s * 0.31, -0.02, 0);
      flaps.push(fz);
    }
    pathZones.push({ at: 0.85, color: COLOR_OUT });
    return { group, rotors, flaps, pathZones };
  }

  if (deviceType === "AC_STANDING") {
    // 0.55 × 1.8 tower; y up, z+ = front.
    mesh(new THREE.BoxGeometry(0.5, 1.7, 0.45), whiteMat, 0, 0.9, 0); // body core
    for (let g = 0; g < 9; g += 1) {
      mesh(new THREE.BoxGeometry(0.42, 0.035, 0.02), darkMat, 0, 0.3 + g * 0.15, 0.235); // front slats
    }
    pathZones.push({ at: 0, color: COLOR_INTAKE });
    mesh(new THREE.BoxGeometry(0.4, 1.0, 0.03), filterMat, 0, 0.75, 0.2); // intake filter pad
    pathZones.push({ at: 0.2, color: COLOR_FILTERED });
    // vertical coil stack
    for (let i = 0; i < 7; i += 1) {
      mesh(new THREE.BoxGeometry(0.36, 0.1, 0.05), coolMat, 0, 0.45 + i * 0.14, 0.05);
    }
    pathZones.push({ at: 0.5, color: COLOR_COOLED });
    // top discharge fan (spins around Y)
    const rotor = new THREE.Group();
    rotor.position.set(0, 1.62, 0);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.07, 14), fanMat);
    rotor.add(hub);
    for (let b = 0; b < 6; b += 1) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.015, 0.08), fanMat);
      const a = (b / 6) * Math.PI * 2;
      blade.position.set(Math.cos(a) * 0.14, 0, Math.sin(a) * 0.14);
      blade.rotation.y = -a + 0.55;
      rotor.add(blade);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.015, 10, 30), frameMat);
    ring.rotation.x = Math.PI / 2;
    rotor.add(ring);
    rotors.push(rotor);
    group.add(rotor);
    pathZones.push({ at: 0.85, color: COLOR_OUT });
    return { group, rotors, flaps, pathZones };
  }

  // ── AHU: full processing chain along X (mirrors the 2D side elevation) ──
  const CASING_LEN = 6.0;
  const at = (x: number) => x - CASING_LEN / 2 + 0.45;

  // intake grille
  for (let i = 0; i < 6; i += 1) {
    const slat = mesh(new THREE.BoxGeometry(0.05, 1.15, 1.5), darkMat, at(-0.15 + i * 0.05), 0.1, 0);
    slat.rotation.z = 0.35;
  }
  pathZones.push({ at: 0, color: COLOR_INTAKE });
  // panel filter (frame + pleats)
  mesh(new THREE.BoxGeometry(0.08, 1.35, 1.7), frameMat, at(0.55), 0.1, 0);
  for (let i = 0; i < 8; i += 1) {
    mesh(new THREE.BoxGeometry(0.05, 1.25, 0.09), filterMat, at(0.55), 0.1, -0.7 + i * 0.2);
  }
  pathZones.push({ at: 0.16, color: COLOR_FILTERED });
  // bag filter pockets
  for (let i = 0; i < 4; i += 1) {
    const pocket = mesh(new THREE.BoxGeometry(0.3, 0.5, 0.34), filterMat, at(1.05), 0.42, -0.62 + i * 0.42);
    pocket.scale.set(1, 1, 1);
  }
  pathZones.push({ at: 0.3, color: COLOR_FILTERED });
  // cooling coil (blue fins)
  for (let i = 0; i < 10; i += 1) {
    mesh(new THREE.BoxGeometry(0.045, 1.45, 1.62), coolMat, at(1.75 + i * 0.045), 0.1, 0);
  }
  mesh(new THREE.BoxGeometry(0.75, 0.12, 0.12), coolMat, at(1.8), -0.62, -0.6); // condensate drain pipe
  pathZones.push({ at: 0.44, color: COLOR_COOLED });
  if (hasHeater) {
    for (let i = 0; i < 8; i += 1) {
      mesh(new THREE.BoxGeometry(0.05, 1.45, 1.62), heatMat, at(2.45 + i * 0.05), 0.1, 0);
    }
    pathZones.push({ at: 0.58, color: COLOR_HEATED });
  }
  // fan section: axial rotor on a shaft
  const rotor = new THREE.Group();
  rotor.position.set(at(3.55), 0.1, 0);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.18, 18), fanMat);
  hub.rotation.z = Math.PI / 2;
  rotor.add(hub);
  for (let b = 0; b < 8; b += 1) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.62, 0.18), fanMat);
    const a = (b / 8) * Math.PI * 2;
    blade.position.set(0, Math.cos(a) * 0.36, Math.sin(a) * 0.36);
    blade.rotation.x = -a + 0.5;
    rotor.add(blade);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.03, 10, 36), frameMat);
  ring.rotation.y = Math.PI / 2;
  rotor.add(ring);
  rotors.push(rotor);
  group.add(rotor);
  pathZones.push({ at: 0.78, color: COLOR_OUT });
  // supply duct
  const duct = mesh(new THREE.BoxGeometry(0.55, 0.9, 1.1), frameMat, at(4.55), 0.1, 0);
  duct.material = whiteMat;
  mesh(new THREE.BoxGeometry(0.06, 0.98, 1.18), darkMat, at(4.85), 0.1, 0);
  pathZones.push({ at: 1, color: COLOR_OUT });
  // floor rails
  mesh(new THREE.BoxGeometry(CASING_LEN, 0.08, 2.0), darkMat, 0, -0.78, 0);

  return { group, rotors, flaps, pathZones };
}

function zoneColorAt(t: number, zones: Array<{ at: number; color: THREE.Color }>): THREE.Color {
  let best = zones[0]?.color ?? COLOR_INTAKE;
  for (const z of zones) {
    if (t >= z.at) best = z.color;
  }
  return best;
}

/** Per-device-type airflow path: t∈[0,1] → world position (in the model group). */
function pathPoint(deviceType: string, t: number, lane: number, lift: number, out: THREE.Vector3): THREE.Vector3 {
  if (deviceType === "AC_SPLIT_WALL") {
    // top intake (z-≈0.1,y+) → down through coil/fan → out the front (z+)
    const s = Math.sin(t * Math.PI);
    out.set(
      lane * 0.42,
      0.16 - 0.34 * Math.min(1, t / 0.55) + lift * 0.05 * s,
      -0.06 + 0.28 * Math.max(0, (t - 0.45) / 0.55) + Math.sin(t * 9 + lane * 5) * 0.02,
    );
    return out;
  }
  if (deviceType === "AC_DAK") {
    // bottom center (y-) → up into the fan → radially out under the louvers
    if (t < 0.4) {
      const k = t / 0.4;
      out.set(lane * 0.08 * k, -0.14 + 0.3 * k + lift * 0.02, lift * 0.08 * k);
    } else {
      const k = (t - 0.4) / 0.6;
      const angle = lane * 1.7 + k * 2.4;
      const radius = 0.05 + k * 0.42;
      out.set(Math.cos(angle) * radius, 0.02 - k * 0.1 + lift * 0.02, Math.sin(angle) * radius);
    }
    return out;
  }
  if (deviceType === "AC_STANDING") {
    // front slats (z+) → inward/up through the coil → top discharge (y+)
    if (t < 0.55) {
      const k = t / 0.55;
      out.set(lane * 0.16, 0.35 + k * 0.75, 0.26 - 0.22 * k + lift * 0.03);
    } else {
      const k = (t - 0.55) / 0.45;
      out.set(lane * 0.12 * (1 - k), 1.15 + k * 0.55, Math.sin(k * Math.PI) * 0.05 + lift * 0.03);
    }
    return out;
  }
  // AHU: -x → +x through the component chain
  const x = -2.85 + t * 5.7;
  const bend = t > 0.35 && t < 0.6 ? Math.sin((t - 0.35) / 0.25 * Math.PI) * 0.08 : 0;
  out.set(x, 0.02 + lift * 0.28 + bend, lane * 0.62 + Math.sin(t * 7 + lane * 4) * 0.03);
  return out;
}

export default function AhuDetailed3DView({ ahuId, deviceType, status, hasHeater, fanSpeed, className }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const type = deviceType === "AC_DAK" || deviceType === "AC_SPLIT_WALL" || deviceType === "AC_STANDING" ? deviceType : "AHU";
    let disposed = false;

    const width = Math.max(320, mount.clientWidth);
    const height = Math.max(240, mount.clientHeight);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = false;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    const isAhu = type === "AHU";
    camera.position.set(isAhu ? 5.2 : 2.6, isAhu ? 2.6 : 1.9, isAhu ? 4.4 : 2.6);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = isAhu ? 2.6 : 1.1;
    controls.maxDistance = isAhu ? 12 : 5;
    controls.target.set(0, isAhu ? 0.1 : type === "AC_STANDING" ? 0.85 : 0.05, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(4, 6, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x93c5fd, 0.7);
    rim.position.set(-4, 3, -3);
    scene.add(rim);

    // casing + internals
    const casingSize: [number, number, number] =
      type === "AHU" ? [6.0, 1.9, 2.0] : type === "AC_SPLIT_WALL" ? [1.12, 0.36, 0.26] : type === "AC_DAK" ? [0.95, 0.26, 0.95] : [0.56, 1.86, 0.52];
    const casing = new THREE.Mesh(
      new THREE.BoxGeometry(...casingSize),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.13, roughness: 0.3, metalness: 0.1, depthWrite: false }),
    );
    casing.position.set(0, type === "AC_DAK" ? 0.13 : type === "AC_STANDING" ? 0.95 : isAhu ? 0.1 : 0.02, 0);
    scene.add(casing);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(...casingSize)),
      new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.5 }),
    );
    edges.position.copy(casing.position);
    scene.add(edges);

    const { group: internals, rotors, flaps, pathZones } = buildComponentMeshes(type, hasHeater);
    scene.add(internals);

    // status beacon
    const beaconMat = new THREE.MeshStandardMaterial({
      color: STATUS_COLOR[status],
      emissive: STATUS_COLOR[status],
      emissiveIntensity: status === "RUN" || status === "FAULT" ? 0.9 : 0.3,
    });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(type === "AHU" ? 0.1 : 0.04, 16, 12), beaconMat);
    beacon.position.set(isAhu ? 2.6 : 0.5, casing.position.y + casingSize[1] / 2 + 0.12, 0);
    scene.add(beacon);

    // airflow particles
    const COUNT = 130;
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const particles: Particle[] = [];
    for (let i = 0; i < COUNT; i += 1) {
      particles.push({ t: i / COUNT, lane: Math.random() * 2 - 1, lift: Math.random(), speed: 0.85 + Math.random() * 0.3 });
    }
    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    pointsGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const pointsMat = new THREE.PointsMaterial({ size: type === "AHU" ? 0.075 : 0.035, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
    const points = new THREE.Points(pointsGeo, pointsMat);
    scene.add(points);
    const tmp = new THREE.Vector3();

    // floor disc for spatial grounding
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(isAhu ? 4.6 : 1.4, 48),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.95, transparent: true, opacity: 0.55 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = isAhu ? -0.86 : type === "AC_STANDING" ? -0.02 : -0.35;
    scene.add(floor);

    const controls_listener = () => {};
    controls.addEventListener("change", controls_listener);

    let raf = 0;
    let fanAngle = 0;
    let fanSpeedNow = 0;
    let flapPhase = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      if (disposed) return;
      raf = requestAnimationFrame(animate);
      const dt = Math.min(0.05, clock.getDelta());
      const running = status === "RUN";
      const targetFan = running ? 6 + Math.min(1.2, Math.max(0.4, (fanSpeed ?? 3) / 4)) * 4 : 0;
      fanSpeedNow += (targetFan - fanSpeedNow) * Math.min(1, dt * 1.6);
      fanAngle += fanSpeedNow * dt;
      for (const rotor of rotors) {
        if (type === "AC_SPLIT_WALL") rotor.rotation.x = fanAngle;
        else rotor.rotation.y = fanAngle;
      }
      if (running) flapPhase += dt * 1.8;
      flaps.forEach((flap, i) => {
        const base = i % 2 === 0 ? 0.7 : 0;
        flap.rotation.x = base + (running ? Math.sin(flapPhase + i * 1.3) * 0.28 : base * 0.4);
      });
      beaconMat.emissiveIntensity = (status === "FAULT" ? 0.7 + Math.sin(clock.elapsedTime * 6) * 0.45 : running ? 0.9 : 0.3);

      const flow = running ? fanSpeedNow * 0.028 : 0.0;
      for (let i = 0; i < COUNT; i += 1) {
        const p = particles[i];
        p.t += flow * p.speed * dt * 3.2;
        if (p.t > 1) p.t -= 1;
        pathPoint(type, p.t, p.lane, p.lift, tmp);
        positions[i * 3] = tmp.x;
        positions[i * 3 + 1] = tmp.y + casing.position.y - (type === "AHU" ? 0 : type === "AC_STANDING" ? 0.9 : 0.1);
        positions[i * 3 + 2] = tmp.z;
        const c = zoneColorAt(p.t, pathZones);
        const dim = running ? 1 : 0.25;
        colors[i * 3] = c.r * dim;
        colors[i * 3 + 1] = c.g * dim;
        colors[i * 3 + 2] = c.b * dim;
      }
      pointsGeo.attributes.position.needsUpdate = true;
      pointsGeo.attributes.color.needsUpdate = true;

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (disposed || !mount) return;
      const w = Math.max(320, mount.clientWidth);
      const h = Math.max(240, mount.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    resizeObserver?.observe(mount);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      controls.dispose();
      disposeGroupDeep(internals);
      const pointsWrap = new THREE.Group();
      pointsWrap.add(points);
      disposeGroupDeep(pointsWrap);
      casing.geometry.dispose();
      (casing.material as THREE.Material).dispose();
      edges.geometry.dispose();
      (edges.material as THREE.Material).dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      beacon.geometry.dispose();
      beaconMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
    };
    // Rebuild only when the machine's identity/look changes — status/fanSpeed
    // are read through the closure each frame is regenerated by the effect deps.
  }, [ahuId, deviceType, status, hasHeater, fanSpeed]);

  return (
    <div className={className} data-ahu-detail-3d={ahuId}>
      <div ref={mountRef} className="h-[320px] w-full overflow-hidden rounded-xl bg-gradient-to-b from-slate-900 to-slate-800 sm:h-[380px]" />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-slate-400" /> intake</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-slate-300" /> filter</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-sky-400" /> cooling</span>
        {hasHeater && (
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-orange-400" /> heating</span>
        )}
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-cyan-300" /> supply</span>
        <span className="ml-auto italic">drag to rotate · scroll to zoom</span>
      </div>
    </div>
  );
}
