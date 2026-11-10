import type { DeviceType } from "@/lib/facility-rooms";
import * as THREE from "three";
import type { AhuStatus } from "@/lib/types";
import type { OutdoorTreeCandidate } from "@/lib/facility-placement";
const STATUS_HEX: Record<AhuStatus, number> = {
  RUN: 0x10b981,
  STOP: 0x64748b,
  FAULT: 0xef4444,
  OFFLINE: 0xf43f5e,
};


/** Procedurally generates a crisp 3D architectural tree (deciduous shade canopy or layered pine) with planter ring. */
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


/** Builds a detailed daylight-lit industrial 3D Air Handling Unit on a raised mounting plinth. */

/**
 * Compact models for the stored AC kinds. Distinct silhouettes:
 *   AC_DAK         — ceiling cassette (flat square plate near the ceiling + fan disc)
 *   AC_SPLIT_WALL  — slim wall-mounted split unit at head height
 *   AC_STANDING    — floor-standing vertical tower
 * All expose the same { group, rotor, halo, beaconMat } contract as the AHU
 * model so selection halos, RUN rotation and fault beacons keep working.
 */
function buildAcModel3D(opts: {
  id: string;
  status: AhuStatus;
  deviceType: DeviceType;
  dimmed: boolean;
  isGhost: boolean;
  isValidGhost: boolean;
}): {
  group: THREE.Group;
  rotor: THREE.Group;
  halo: THREE.Mesh;
  beaconMat: THREE.MeshStandardMaterial;
} {
  const { id, status, deviceType, dimmed, isGhost, isValidGhost } = opts;
  const group = new THREE.Group();
  group.userData = { ahuId: id, isAhuRoot: !isGhost };

  const transparent = isGhost || dimmed;
  const baseOpacity = isGhost ? 0.68 : dimmed ? 0.3 : 1;
  const ghostTint = !isGhost ? null : isValidGhost ? 0x10b981 : 0xef4444;
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
  const glossMat = mat({ roughness: 0.25, metalness: 0.05 });
  const accentMat = new THREE.MeshStandardMaterial({
    color: ghostTint ?? 0x1d6ef2,
    roughness: 0.4,
    transparent,
    opacity: baseOpacity,
  });
  const darkMat = mat({ color: ghostTint ?? 0x1e293b, roughness: 0.7, metalness: 0.25 });
  const midMat = mat({ color: ghostTint ?? 0x94a3b8, roughness: 0.6 });

  const tag = (mesh: THREE.Mesh) => {
    mesh.castShadow = !transparent;
    mesh.receiveShadow = true;
    mesh.userData = { ahuId: id };
    group.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, d: number, m: THREE.MeshStandardMaterial) =>
    new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

  const rotor = new THREE.Group();
  const fanMat = new THREE.MeshStandardMaterial({
    color: status === "RUN" ? 0x38bdf8 : 0x8ea3ba,
    emissive: status === "RUN" ? 0x0ea5e9 : 0x000000,
    emissiveIntensity: status === "RUN" ? 0.35 : 0,
    metalness: 0.45,
    roughness: 0.3,
    transparent,
    opacity: baseOpacity,
  });
  const bladeRadius = deviceType === "AC_STANDING" ? 0.13 : 0.1;
  for (let b = 0; b < 5; b += 1) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(bladeRadius * 1.7, 0.045, 0.02), fanMat);
    const angle = (b * Math.PI * 2) / 5;
    blade.position.set(Math.cos(angle) * bladeRadius * 0.62, Math.sin(angle) * bladeRadius * 0.62, 0);
    blade.rotation.z = angle + 0.4;
    rotor.add(blade);
  }

  if (deviceType === "AC_SPLIT_WALL") {
    // Wall-mounted split indoor unit — back plate sits flush against the wall
    // (the placement solver puts local -Z against the wall face), head height.
    const plate = box(1.08, 0.32, 0.025, darkMat);
    plate.position.set(0, 2.08, -0.125);
    tag(plate);
    const body = box(1.04, 0.3, 0.185, whiteMat);
    body.position.set(0, 2.08, -0.012);
    tag(body);
    // rounded top-front curve
    const curve = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 1.04, 20, 1, false, 0, Math.PI), whiteMat);
    curve.rotation.z = Math.PI / 2;
    curve.rotation.y = Math.PI / 2;
    curve.position.set(0, 2.23, -0.012);
    tag(curve);
    const gloss = box(1.02, 0.14, 0.012, glossMat);
    gloss.position.set(0, 2.14, 0.084);
    tag(gloss);
    const louver = box(0.96, 0.04, 0.014, darkMat);
    louver.position.set(0, 2.035, 0.088);
    tag(louver);
    const flap = box(0.96, 0.012, 0.07, whiteMat);
    flap.position.set(0, 2.012, 0.112);
    flap.rotation.x = 0.55;
    tag(flap);
    const stripe = box(0.9, 0.012, 0.012, accentMat);
    stripe.position.set(0, 2.185, 0.093);
    tag(stripe);
    const display = box(0.05, 0.022, 0.01, accentMat);
    display.position.set(0.36, 2.15, 0.093);
    tag(display);
    rotor.position.set(0, 2.265, -0.05);
    rotor.rotation.x = Math.PI / 2;
  } else if (deviceType === "AC_DAK") {
    // Ceiling cassette — flush against the 2.85 m ceiling slab on four drop rods.
    for (const [rx, rz] of [[-0.34, -0.34], [0.34, -0.34], [-0.34, 0.34], [0.34, 0.34]] as const) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8), midMat);
      rod.position.set(rx, 2.81, rz);
      tag(rod);
    }
    const ceilingPlate = box(0.46, 0.025, 0.46, whiteMat);
    ceilingPlate.position.set(0, 2.855, 0);
    tag(ceilingPlate);
    const frame = box(0.9, 0.11, 0.9, whiteMat);
    frame.position.set(0, 2.695, 0);
    tag(frame);
    const skirt = box(0.8, 0.05, 0.8, glossMat);
    skirt.position.set(0, 2.625, 0);
    tag(skirt);
    const under = box(0.64, 0.025, 0.64, darkMat);
    under.position.set(0, 2.594, 0);
    tag(under);
    // four-way discharge louvers around the underside
    for (const s of [-1, 1]) {
      const louverX = box(0.56, 0.03, 0.05, whiteMat);
      louverX.position.set(0, 2.588, s * 0.295);
      tag(louverX);
      const louverZ = box(0.05, 0.03, 0.56, whiteMat);
      louverZ.position.set(s * 0.295, 2.588, 0);
      tag(louverZ);
    }
    const intake = box(0.3, 0.02, 0.3, midMat);
    intake.position.set(0, 2.587, 0);
    tag(intake);
    rotor.position.set(0, 2.6, 0);
    rotor.rotation.x = Math.PI / 2;
  } else {
    // AC_STANDING — floor tower on a base plinth, top discharge, front grille.
    for (const [fx, fz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]] as const) {
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.04, 10), darkMat);
      foot.position.set(fx, 0.02, fz);
      tag(foot);
    }
    const plinth = box(0.56, 0.07, 0.56, darkMat);
    plinth.position.set(0, 0.075, 0);
    tag(plinth);
    const body = box(0.5, 1.66, 0.5, whiteMat);
    body.position.set(0, 0.94, 0);
    tag(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.1, 24), glossMat);
    cap.position.set(0, 1.82, 0);
    tag(cap);
    const discharge = box(0.36, 0.022, 0.36, darkMat);
    discharge.position.set(0, 1.875, 0);
    tag(discharge);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.018, 10, 28), darkMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 1.885, 0);
    tag(ring);
    for (let g = 0; g < 9; g += 1) {
      const slat = box(0.42, 0.03, 0.018, midMat);
      slat.position.set(0, 0.32 + g * 0.145, 0.262);
      tag(slat);
    }
    const panel = box(0.3, 0.1, 0.02, darkMat);
    panel.position.set(0, 1.62, 0.258);
    tag(panel);
    const display = box(0.12, 0.032, 0.012, accentMat);
    display.position.set(0, 1.62, 0.271);
    tag(display);
    rotor.position.set(0, 1.85, 0);
    rotor.rotation.x = Math.PI / 2;
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
  const beacon =
    deviceType === "AC_SPLIT_WALL"
      ? new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.07, 14), beaconMat)
      : new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 14), beaconMat);
  if (deviceType === "AC_SPLIT_WALL") beacon.position.set(0.47, 2.32, 0.02);
  else if (deviceType === "AC_DAK") beacon.position.set(0.38, 2.73, 0.38);
  else beacon.position.set(0, 1.94, 0);
  beacon.userData = { ahuId: id };
  group.add(beacon);

  const haloGeo = new THREE.RingGeometry(0.7, 0.92, 36);
  haloGeo.rotateX(-Math.PI / 2);
  const halo = new THREE.Mesh(
    haloGeo,
    new THREE.MeshBasicMaterial({
      color: 0x1d6ef2,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
    }),
  );
  halo.position.set(0, 0.03, 0);
  group.add(halo);

  return { group, rotor, halo, beaconMat };
}

export function buildAhuModel3D(opts: {
  id: string;
  status: AhuStatus;
  hasHeater: boolean;
  outdoor: boolean;
  deviceType?: string | null;
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
    deviceType,
    dimmed = false,
    isGhost = false,
    isValidGhost = true,
  } = opts;
  const group = new THREE.Group();
  group.userData = { ahuId: id, isAhuRoot: !isGhost };

  const transparent = isGhost || dimmed;
  const baseOpacity = isGhost ? 0.68 : dimmed ? 0.3 : 1;
  const ghostTint = !isGhost ? null : isValidGhost ? 0x10b981 : 0xef4444;

  // ── non-AHU device kinds: compact AC models (stored until such tokens exist) ──
  if (deviceType === "AC_DAK" || deviceType === "AC_SPLIT_WALL" || deviceType === "AC_STANDING") {
    return buildAcModel3D({ id, status, deviceType, dimmed, isGhost, isValidGhost });
  }

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

