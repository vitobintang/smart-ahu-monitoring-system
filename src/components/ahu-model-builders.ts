import type { DeviceType } from "@/lib/facility-rooms";
import * as THREE from "three";
import type { AhuStatus } from "@/lib/types";
import type { OutdoorTreeCandidate } from "@/lib/facility-placement";

/**
 * Procedurally generates a crisp 3D architectural tree (deciduous shade canopy or layered pine) with planter ring. */
export function buildOutdoorTree3D(spec: OutdoorTreeCandidate): { group: THREE.Group; crown: THREE.Group } {
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

/** Deeply disposes a group's geometries + per-model materials before clearing (stops GC churn from frequent rebuilds). */
export function disposeGroupDeep(group: THREE.Group) {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  });
  group.clear();
}

/* ────────────────────────────────────────────────────────────────────────────
   RUN-state animation = the status indicator (2026-11-11): spinning rotors,
   oscillating louvers and a light-blue airflow plume. No status lamps/balls.
   ──────────────────────────────────────────────────────────────────────────── */

export interface AirflowSpec {
  /** "cone" pushes particles along `dir`; "radial" spreads them outward+down (ceiling 4-way discharge). */
  kind: "cone" | "radial";
  origin: [number, number, number];
  dir?: [number, number, number];
  /** Cone radius at the end of `distance`. */
  spread?: number;
  distance: number;
  count: number;
  color: number;
  size: number;
}

/**
 * Lightweight per-device exhaust plume (THREE.Points in MODEL-LOCAL space, so
 * it rides along with the device group with zero per-frame world math).
 */
export class DeviceAirflow {
  readonly points: THREE.Points;

  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.PointsMaterial;
  private readonly t: Float32Array;
  private readonly jitter: Float32Array;
  private readonly angle: Float32Array;
  private readonly spec: AirflowSpec & { dir: [number, number, number]; spread: number };
  private opacity = 0;

  constructor(spec: AirflowSpec) {
    this.spec = { dir: [0, 1, 0], spread: 0.25, ...spec };
    const n = this.spec.count;
    this.t = new Float32Array(n);
    this.jitter = new Float32Array(n);
    this.angle = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      this.t[i] = Math.random();
      this.jitter[i] = Math.random() * 2 - 1;
      this.angle[i] = Math.random() * Math.PI * 2;
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.mat = new THREE.PointsMaterial({
      color: this.spec.color,
      size: this.spec.size,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
  }

  update(dt: number, running: boolean) {
    this.opacity += ((running ? 0.55 : 0) - this.opacity) * Math.min(1, dt * 3);
    this.mat.opacity = this.opacity;
    this.points.visible = this.opacity > 0.02;
    if (!this.points.visible) return;

    const attr = this.geo.getAttribute("position") as THREE.BufferAttribute;
    const [ox, oy, oz] = this.spec.origin;
    const dir = this.spec.dir;
    const dist = this.spec.distance;
    for (let i = 0; i < this.t.length; i += 1) {
      if (running) {
        this.t[i] += dt * (0.75 + (this.jitter[i] + 1) * 0.18);
        if (this.t[i] > 1) this.t[i] -= 1;
      }
      const t = this.t[i];
      const spread = this.spec.spread * t;
      const wob = Math.sin(t * 9 + this.angle[i] * 3) * 0.03;
      if (this.spec.kind === "radial") {
        const rad = (0.38 + spread) * t;
        attr.setXYZ(i, ox + Math.cos(this.angle[i]) * rad, oy - t * dist * 0.55, oz + Math.sin(this.angle[i]) * rad);
      } else {
        attr.setXYZ(
          i,
          ox + dir[0] * t * dist + this.jitter[i] * spread + wob,
          oy + dir[1] * t * dist + ((this.jitter[i] + 1) / 2) * spread * 0.5,
          oz + dir[2] * t * dist + this.jitter[i] * spread * 0.55,
        );
      }
    }
    attr.needsUpdate = true;
  }
}

/** Everything the facility map needs to animate one placed (or ghost) device. */
export interface BuiltDeviceModel {
  group: THREE.Group;
  /** Spinning parts — each entry spins around the named LOCAL axis while RUN. */
  rotors: Array<{ obj: THREE.Group; axis: "x" | "y" | "z" }>;
  /** Louver flaps — oscillate around their stored base angle while RUN. */
  flaps: THREE.Object3D[];
  /** Ground selection ring (kept slightly ABOVE room floors → no z-fighting). */
  halo: THREE.Mesh;
  /** Exhaust plume, or null for ghosts/dimmed models. */
  airflow: DeviceAirflow | null;
}

/**
 * Compact exterior models for the stored AC kinds. Distinct, detailed silhouettes:
 *   AC_SPLIT_WALL  — slim wall-mounted split at head height (oscillating discharge flap)
 *   AC_DAK         — 4-way ceiling cassette: fascia, 4 discharge slots with vanes,
 *                    radial intake guard over a visible scroll fan, coil ring inside
 *   AC_STANDING    — floor tower: plinth + casters, louvered front, top discharge
 *                    fan under a guard ring
 * RUN is shown ONLY by animation (fan spin, vane oscillation, airflow plume).
 */
function buildAcModel3D(opts: {
  id: string;
  status: AhuStatus;
  deviceType: DeviceType;
  dimmed: boolean;
  isGhost: boolean;
  isValidGhost: boolean;
}): BuiltDeviceModel {
  const { id, status, deviceType, dimmed, isGhost, isValidGhost } = opts;
  const group = new THREE.Group();
  group.userData = { ahuId: id, isAhuRoot: !isGhost };

  const transparent = isGhost || dimmed;
  const baseOpacity = isGhost ? 0.68 : dimmed ? 0.3 : 1;
  const ghostTint = !isGhost ? null : isValidGhost ? 0x10b981 : 0xef4444;
  const running = status === "RUN" && !isGhost && !dimmed;
  const bodyColor = ghostTint ?? (status === "RUN" ? 0xeef2f7 : 0xd7dee8);

  const mat = (extra?: Partial<THREE.MeshStandardMaterialParameters>) =>
    new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.5,
      metalness: 0.12,
      transparent,
      opacity: baseOpacity,
      ...extra,
    });
  const whiteMat = mat();
  const glossMat = mat({ roughness: 0.22, metalness: 0.06 });
  const accentMat = new THREE.MeshStandardMaterial({
    color: ghostTint ?? 0x1d6ef2,
    roughness: 0.4,
    transparent,
    opacity: baseOpacity,
  });
  const darkMat = mat({ color: ghostTint ?? 0x243244, roughness: 0.7, metalness: 0.25 });
  const midMat = mat({ color: ghostTint ?? 0x94a3b8, roughness: 0.6 });
  const fanMat = new THREE.MeshStandardMaterial({
    color: ghostTint ?? (status === "RUN" ? 0x7cc8f2 : 0x9fb2c6),
    emissive: status === "RUN" && !isGhost ? 0x0ea5e9 : 0x000000,
    emissiveIntensity: status === "RUN" && !isGhost ? 0.25 : 0,
    metalness: 0.5,
    roughness: 0.3,
    transparent,
    opacity: baseOpacity,
  });

  const tag = (mesh: THREE.Mesh) => {
    mesh.castShadow = !transparent;
    mesh.receiveShadow = true;
    mesh.userData = { ahuId: id };
    group.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, d: number, m: THREE.MeshStandardMaterial) =>
    new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

  const rotors: Array<{ obj: THREE.Group; axis: "x" | "y" | "z" }> = [];
  const flaps: THREE.Object3D[] = [];
  let airflow: DeviceAirflow | null = null;

  /** Hollow rectangular border made of 4 non-overlapping boxes (no z-fighting). */
  const borderFrame = (
    outer: number,
    thickness: number,
    height: number,
    y: number,
    m: THREE.MeshStandardMaterial,
  ) => {
    const half = outer / 2;
    const ns = (outer - thickness * 2) / 2;
    const north = box(outer, height, thickness, m);
    north.position.set(0, y, -half + thickness / 2);
    tag(north);
    const south = box(outer, height, thickness, m);
    south.position.set(0, y, half - thickness / 2);
    tag(south);
    const west = box(thickness, height, ns, m);
    west.position.set(-half + thickness / 2, y, 0);
    tag(west);
    const east = box(thickness, height, ns, m);
    east.position.set(half - thickness / 2, y, 0);
    tag(east);
  };

  if (deviceType === "AC_SPLIT_WALL") {
    // Wall-mounted split indoor unit — back plate flush toward the wall (local
    // -Z faces the wall), head height. Local +Z points into the room.
    const plate = box(1.06, 0.3, 0.022, darkMat);
    plate.position.set(0, 2.08, -0.128);
    tag(plate);
    const body = box(1.02, 0.29, 0.16, whiteMat);
    body.position.set(0, 2.08, -0.033);
    tag(body);
    const curve = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1.02, 20, 1, false, 0, Math.PI), whiteMat);
    curve.rotation.z = Math.PI / 2;
    curve.rotation.y = Math.PI / 2;
    curve.position.set(0, 2.225, -0.033);
    tag(curve);
    // top intake grille — proud slats floating clear of the body top (no coplanar faces)
    for (let i = 0; i < 4; i += 1) {
      const slat = box(0.98, 0.012, 0.014, darkMat);
      slat.position.set(0, 2.2345, -0.02 + i * 0.02);
      tag(slat);
    }
    const gloss = box(0.99, 0.145, 0.014, glossMat);
    gloss.position.set(0, 2.12, 0.058);
    tag(gloss);
    const stripe = box(0.9, 0.01, 0.012, accentMat);
    stripe.position.set(0, 2.185, 0.062);
    tag(stripe);
    const display = box(0.05, 0.02, 0.012, accentMat);
    display.position.set(0.34, 2.13, 0.064);
    tag(display);
    // bottom discharge: dark outlet strip + oscillating flap (hinged at its rear edge)
    const outlet = box(0.98, 0.03, 0.016, darkMat);
    outlet.position.set(0, 1.99, 0.045);
    tag(outlet);
    const flapGeo = new THREE.BoxGeometry(0.96, 0.008, 0.06);
    flapGeo.translate(0, 0, 0.03); // hinge = back edge
    const flap = new THREE.Mesh(flapGeo, whiteMat);
    flap.position.set(0, 1.978, 0.045);
    flap.rotation.x = 0.55;
    flap.userData = { ahuId: id, oscAxis: "x", oscBase: 0.55, oscPhase: 0 };
    flap.castShadow = !transparent;
    group.add(flap);
    flaps.push(flap);

    // run plume: cooled air angled down into the room
    if (running) {
      airflow = new DeviceAirflow({
        kind: "cone",
        origin: [0, 1.975, 0.08],
        dir: [0, -0.55, 1],
        spread: 0.32,
        distance: 1.2,
        count: 40,
        color: 0x9bd8ff,
        size: 0.075,
      });
      group.add(airflow.points);
    }
  } else if (deviceType === "AC_DAK") {
    // Ceiling cassette — 4-way discharge, flush against the 2.85 m slab.
    for (const [rx, rz] of [
      [-0.36, -0.36],
      [0.36, -0.36],
      [-0.36, 0.36],
      [0.36, 0.36],
    ] as const) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8), midMat);
      rod.position.set(rx, 2.815, rz);
      tag(rod);
    }
    const ceilingPlate = box(0.52, 0.02, 0.52, glossMat);
    ceilingPlate.position.set(0, 2.858, 0);
    tag(ceilingPlate);
    // recessed chassis (hollow border — the intake path stays open in the middle)
    borderFrame(0.84, 0.17, 0.075, 2.815, midMat);
    // translucent intake filter just below the chassis
    const filter = box(0.4, 0.01, 0.4, mat({ color: ghostTint ?? 0xf8fafc, roughness: 0.85, opacity: baseOpacity * 0.55 }));
    filter.position.set(0, 2.755, 0);
    tag(filter);
    // radial intake guard over the fan (slats span r 0.075–0.23, clear of the hub)
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      const slat = box(0.155, 0.008, 0.028, darkMat);
      slat.position.set(Math.cos(a) * 0.1525, 2.735, Math.sin(a) * 0.1525);
      slat.rotation.y = -a + Math.PI / 2;
      tag(slat);
    }
    // cooling coil ring (10 segments at r≈0.305 — clear of fascia and fan)
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      const seg = box(0.15, 0.075, 0.05, mat({ color: ghostTint ?? 0x38bdf8, roughness: 0.35, metalness: 0.45 }));
      seg.position.set(Math.cos(a) * 0.305, 2.73, Math.sin(a) * 0.305);
      seg.rotation.y = -a;
      tag(seg);
    }
    // scroll fan — visible through the guard, spinning about Y in RUN
    const rotor = new THREE.Group();
    rotor.position.set(0, 2.715, 0);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.07, 16), fanMat);
    rotor.add(hub);
    for (let b = 0; b < 9; b += 1) {
      const a = (b / 9) * Math.PI * 2;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.15), fanMat);
      blade.position.set(Math.cos(a) * 0.13, 0, Math.sin(a) * 0.13);
      blade.rotation.y = -a + 0.85;
      rotor.add(blade);
    }
    rotor.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) {
        m.castShadow = !transparent;
        m.userData = { ahuId: id };
      }
    });
    group.add(rotor);
    rotors.push({ obj: rotor, axis: "y" });
    const volute = new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.012, 8, 32), darkMat);
    volute.rotation.x = Math.PI / 2;
    volute.position.set(0, 2.715, 0);
    tag(volute);
    // fascia + stepped trim band + skirt (hollow borders, never coplanar)
    borderFrame(0.92, 0.1, 0.1, 2.7, whiteMat);
    borderFrame(0.98, 0.02, 0.025, 2.766, glossMat);
    borderFrame(0.84, 0.05, 0.025, 2.608, glossMat);
    // 4 discharge slots (dark insets) + oscillating vanes
    for (const s of [-1, 1]) {
      const insetX = box(0.07, 0.012, 0.72, darkMat);
      insetX.position.set(s * 0.4, 2.635, 0);
      tag(insetX);
      const insetZ = box(0.72, 0.012, 0.07, darkMat);
      insetZ.position.set(0, 2.635, s * 0.4);
      tag(insetZ);

    }

    // one 4-way vane set (created ONCE — duplicates would z-fight)
    const vaneGeoZ = new THREE.BoxGeometry(0.62, 0.008, 0.05);
    vaneGeoZ.translate(0, 0, -0.025); // hinge at outer edge
    const vaneGeoX = new THREE.BoxGeometry(0.05, 0.008, 0.62);
    vaneGeoX.translate(-0.025, 0, 0); // hinge at outer edge
    const vaneDefs: Array<{ mesh: THREE.Mesh; axis: "x" | "z"; base: number; phase: number }> = [
      { mesh: new THREE.Mesh(vaneGeoZ, whiteMat), axis: "x", base: -0.6, phase: 0 },
      { mesh: new THREE.Mesh(vaneGeoZ, whiteMat), axis: "x", base: 0.6, phase: Math.PI },
      { mesh: new THREE.Mesh(vaneGeoX, whiteMat), axis: "z", base: 0.6, phase: Math.PI / 2 },
      { mesh: new THREE.Mesh(vaneGeoX, whiteMat), axis: "z", base: -0.6, phase: (3 * Math.PI) / 2 },
    ];
    const vanePos: Array<[number, number, number]> = [
      [0, 2.628, -0.4 + 0.035],
      [0, 2.628, 0.4 - 0.035],
      [-0.4 + 0.035, 2.628, 0],
      [0.4 - 0.035, 2.628, 0],
    ];
    vaneDefs.forEach((v, i) => {
      v.mesh.position.set(...vanePos[i]);
      v.mesh.rotation[v.axis] = v.base;
      v.mesh.userData = { ahuId: id, oscAxis: v.axis, oscBase: v.base, oscPhase: v.phase };
      v.mesh.castShadow = !transparent;
      group.add(v.mesh);
      flaps.push(v.mesh);
    });

    if (running) {
      airflow = new DeviceAirflow({
        kind: "radial",
        origin: [0, 2.62, 0],
        distance: 0.9,
        spread: 0.35,
        count: 48,
        color: 0x9bd8ff,
        size: 0.07,
      });
      group.add(airflow.points);
    }
  } else {
    // AC_STANDING — floor tower on casters, louvered intake, top discharge fan.
    for (const [fx, fz] of [
      [-0.17, -0.17],
      [0.17, -0.17],
      [-0.17, 0.17],
      [0.17, 0.17],
    ] as const) {
      const caster = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.05, 12), darkMat);
      caster.position.set(fx, 0.029, fz);
      tag(caster);
    }
    const plinth = box(0.5, 0.05, 0.5, darkMat);
    plinth.position.set(0, 0.085, 0);
    tag(plinth);
    const body = box(0.48, 1.56, 0.44, whiteMat);
    body.position.set(0, 0.885, 0);
    tag(body);
    const cap = box(0.54, 0.05, 0.5, glossMat);
    cap.position.set(0, 1.7, 0);
    tag(cap);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.2, 0.09, 26, 1, true), glossMat);
    collar.material = glossMat;
    collar.position.set(0, 1.765, 0);
    tag(collar);
    // top discharge fan (7 blades) + guard ring + spokes above it
    const rotor = new THREE.Group();
    rotor.position.set(0, 1.79, 0);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 14), fanMat);
    rotor.add(hub);
    for (let b = 0; b < 7; b += 1) {
      const a = (b / 7) * Math.PI * 2;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.15), fanMat);
      blade.position.set(Math.cos(a) * 0.13, 0, Math.sin(a) * 0.13);
      blade.rotation.y = -a + 0.7;
      rotor.add(blade);
    }
    rotor.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) {
        m.castShadow = !transparent;
        m.userData = { ahuId: id };
      }
    });
    group.add(rotor);
    rotors.push({ obj: rotor, axis: "y" });
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.008, 8, 30), darkMat);
    guard.rotation.x = Math.PI / 2;
    guard.position.set(0, 1.85, 0);
    tag(guard);
    for (let s = 0; s < 4; s += 1) {
      const a = (s / 4) * Math.PI * 2;
      const spoke = box(0.17, 0.006, 0.01, darkMat);
      spoke.position.set(Math.cos(a) * 0.093, 1.85, Math.sin(a) * 0.093);
      spoke.rotation.y = -a;
      tag(spoke);
    }
    // front intake louvers (angled, proud of the body face) + display
    for (let g = 0; g < 8; g += 1) {
      const slat = box(0.4, 0.03, 0.014, midMat);
      slat.position.set(0, 0.38 + g * 0.15, 0.226);
      slat.rotation.x = 0.28;
      tag(slat);
    }
    const display = box(0.16, 0.05, 0.012, accentMat);
    display.position.set(0.1, 1.64, 0.226);
    tag(display);
    // side carry-handle rails + brand strip
    for (const s of [-1, 1]) {
      const rail = box(0.015, 0.9, 0.06, darkMat);
      rail.position.set(s * 0.246, 0.95, 0.1);
      tag(rail);
    }
    const brand = box(0.3, 0.012, 0.01, accentMat);
    brand.position.set(0, 1.5, 0.22);
    tag(brand);

    if (running) {
      airflow = new DeviceAirflow({
        kind: "cone",
        origin: [0, 1.86, 0],
        dir: [0, 1, 0],
        spread: 0.3,
        distance: 1.55,
        count: 60,
        color: 0x9bd8ff,
        size: 0.09,
      });
      group.add(airflow.points);
    }
  }

  const haloGeo = new THREE.RingGeometry(0.7, 0.92, 36);
  haloGeo.rotateX(-Math.PI / 2);
  const halo = new THREE.Mesh(
    haloGeo,
    new THREE.MeshBasicMaterial({
      color: 0x1d6ef2,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
  halo.position.set(0, 0.045, 0);
  halo.renderOrder = 1;
  group.add(halo);

  return { group, rotors, flaps, halo, airflow };
}

/** Builds a detailed daylight-lit industrial 3D Air Handling Unit on a raised mounting plinth. */
export function buildAhuModel3D(opts: {
  id: string;
  status: AhuStatus;
  hasHeater: boolean;
  outdoor: boolean;
  deviceType?: string | null;
  dimmed?: boolean;
  isGhost?: boolean;
  isValidGhost?: boolean;
}): BuiltDeviceModel {
  const {
    id,
    status,
    hasHeater,
    outdoor,
    deviceType,
    dimmed = false,
    isGhost = false,
    isValidGhost = true,
  } = opts;
  const group = new THREE.Group();
  group.userData = { ahuId: id, isAhuRoot: !isGhost };

  // ── non-AHU device kinds: compact AC models ──
  if (deviceType === "AC_DAK" || deviceType === "AC_SPLIT_WALL" || deviceType === "AC_STANDING") {
    return buildAcModel3D({ id, status, deviceType, dimmed, isGhost, isValidGhost });
  }

  const transparent = isGhost || dimmed;
  const baseOpacity = isGhost ? 0.68 : dimmed ? 0.3 : 1;
  const ghostTint = !isGhost ? null : isValidGhost ? 0x10b981 : 0xef4444;
  const running = status === "RUN" && !isGhost && !dimmed;

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
    depthWrite: false,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.set(0, 0.045, 0);
  halo.renderOrder = 1;
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

  // axial supply fan — blades spin around the LOCAL Z axis (the airflow direction)
  const rotor = new THREE.Group();
  rotor.position.set(1.0, 0.92, 0.73);
  const bladeMat = new THREE.MeshStandardMaterial({
    color: status === "RUN" ? 0x38bdf8 : 0x94a3b8,
    emissive: running ? 0x0ea5e9 : 0x000000,
    emissiveIntensity: running ? 0.3 : 0,
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

  let airflow: DeviceAirflow | null = null;
  if (running) {
    airflow = new DeviceAirflow({
      kind: "cone",
      origin: [1.12, 2.14, 0],
      dir: [0, 1, 0],
      spread: 0.5,
      distance: 1.5,
      count: 48,
      color: 0x9bd8ff,
      size: 0.1,
    });
    group.add(airflow.points);
  }

  return { group, rotors: [{ obj: rotor, axis: "z" }], flaps: [], halo, airflow };
}
