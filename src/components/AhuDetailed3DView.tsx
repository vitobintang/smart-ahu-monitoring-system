"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AhuStatus } from "@/lib/ahu";
import { disposeGroupDeep } from "@/components/ahu-model-builders";
import { cx } from "@/components/ui";

/**
 * AhuDetailed3DView — the detailed 3D "inside of the machine" viewer
 * (2026-11-11 refresh). Replaces the flat side-elevation schematic with a
 * rotatable, auto-framed 3D cut-away per device type:
 *
 *   AHU            intake grille → panel filter → bag filters → cooling coil
 *                  (+ condensate tray) → heating coil (if fitted) → axial fan
 *                  → supply duct
 *   AC_SPLIT_WALL  top intake + filter → V evaporator → cross-flow fan →
 *                  oscillating discharge louver
 *   AC_DAK         ceiling cassette: center intake → scroll fan → coil ring →
 *                  4-way oscillating louvers
 *   AC_STANDING    front louvered intake → filter → vertical coil stack →
 *                  top discharge fan
 *
 * Every component carries a floating label, RUN spins the fans along their
 * true airflow axis and drives dense colored airflow particles through the
 * machine (gray intake → blue after cooling → warm after heating), and the
 * camera auto-frames the model so even the slim wall unit fills the view.
 * Drag to rotate, scroll to zoom. There is deliberately NO status lamp: the
 * animation IS the run indicator.
 */

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

const tmpVec = new THREE.Vector3();

interface Particle {
  t: number;
  lane: number;
  lift: number;
  speed: number;
}

interface RotorSpec {
  obj: THREE.Group;
  axis: "x" | "y";
}

/** Canvas-texture billboard label so every internal component is identifiable without clipping. */
function makeLabel(text: string, scale = 1): THREE.Sprite {
  // Render at 2x resolution for retina-crisp typography on high-DPI and mobile screens
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = "600 48px ui-sans-serif, system-ui, -apple-system, sans-serif";
  if (ctx) ctx.font = font;
  const textW = ctx ? ctx.measureText(text).width : text.length * 28;
  const padX = 56;
  const padY = 32;
  const w = Math.ceil(textW + padX * 2);
  const h = 104;
  canvas.width = w;
  canvas.height = h;

  if (ctx) {
    ctx.font = font;
    const r = 24;
    // Pill background
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.quadraticCurveTo(w, 0, w, r);
    ctx.lineTo(w, h - r);
    ctx.quadraticCurveTo(w, h, w - r, h);
    ctx.lineTo(r, h);
    ctx.quadraticCurveTo(0, h, 0, h - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();

    ctx.fillStyle = "rgba(10, 18, 35, 0.94)";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
    ctx.stroke();

    // Subtle inner glowing border
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.stroke();

    // Text with subtle shadow
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2 + 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;

  // CRITICAL FIX: depthTest = false, depthWrite = false, renderOrder = 999
  // This guarantees labels are never clipped, cut off, or intersected by the 3D meshes!
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      opacity: 0.98,
    }),
  );
  sprite.scale.set(((w / h) * 0.12) * scale, 0.12 * scale, 1);
  sprite.renderOrder = 999;
  return sprite;
}

/** Exported for the geometry regression test (coplanar-face / NaN audit). */
export function buildComponentMeshes(
  deviceType: string,
  hasHeater: boolean,
): {
  group: THREE.Group;
  rotors: RotorSpec[];
  flaps: THREE.Object3D[];
  pathZones: Array<{ at: number; color: THREE.Color }>;
  labels: Array<{ text: string; pos: [number, number, number]; scale?: number }>;
} {
  const group = new THREE.Group();
  const rotors: RotorSpec[] = [];
  const flaps: THREE.Object3D[] = [];
  const pathZones: Array<{ at: number; color: THREE.Color }> = [];
  const labels: Array<{ text: string; pos: [number, number, number]; scale?: number }> = [];

  const std = (color: number, extra?: Partial<THREE.MeshStandardMaterialParameters>) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.2, ...extra });
  const frameMat = std(0x334155, { roughness: 0.6 });
  const steelMat = std(0x94a3b8, { roughness: 0.35, metalness: 0.6 });
  const whiteMat = std(0xe2e8f0, { roughness: 0.45 });
  const filterMat = std(0xf8fafc, { roughness: 0.9, transparent: true, opacity: 0.85 });
  const coolMat = std(0x0ea5e9, { roughness: 0.35, metalness: 0.45 });
  const heatMat = std(0xf97316, { roughness: 0.4, metalness: 0.5 });
  const fanMat = std(0x64748b, { roughness: 0.3, metalness: 0.6 });
  const darkMat = std(0x1e293b, { roughness: 0.7 });
  const copperMat = std(0xb87333, { roughness: 0.35, metalness: 0.7 });

  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };

  if (deviceType === "AC_SPLIT_WALL") {
    // ── Wall split, x = along, z+ = room side. Real internals, real proportions. ──
    mesh(new THREE.BoxGeometry(1.06, 0.3, 0.022), darkMat, 0, 0, -0.143); // wall back plate
    pathZones.push({ at: 0, color: COLOR_INTAKE });
    const shell = mesh(new THREE.BoxGeometry(1.02, 0.29, 0.2), whiteMat, 0, 0, -0.03); // main shell
    shell.material = std(0xe2e8f0, { roughness: 0.45, transparent: true, opacity: 0.35 });
    const curve = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1.02, 20, 1, false, 0, Math.PI), whiteMat);
    curve.rotation.z = Math.PI / 2;
    curve.rotation.y = Math.PI / 2;
    curve.position.set(0, 0.145, -0.03);
    group.add(curve);
    // top intake grille — proud slats floating clear of the shell top
    for (let i = 0; i < 4; i += 1) {
      mesh(new THREE.BoxGeometry(0.98, 0.012, 0.014), darkMat, 0, 0.1575, -0.025 + i * 0.02);
    }
    labels.push({ text: "AIR INTAKE", pos: [0, 0.23, -0.03], scale: 0.72 });
    mesh(new THREE.BoxGeometry(0.98, 0.012, 0.16), filterMat, 0, 0.115, -0.03); // filter
    pathZones.push({ at: 0.18, color: COLOR_FILTERED });
    labels.push({ text: "AIR FILTER", pos: [-0.62, 0.17, -0.03], scale: 0.72 });
    // V evaporator: two fin stacks meeting at the bottom (real split layout)
    const finA = mesh(new THREE.BoxGeometry(0.96, 0.15, 0.02), coolMat, 0, 0.07, -0.065);
    finA.rotation.x = 0.5;
    const finB = mesh(new THREE.BoxGeometry(0.96, 0.15, 0.02), coolMat, 0, 0.07, -0.005);
    finB.rotation.x = -0.5;
    mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.92, 10), copperMat, 0, -0.005, -0.095).rotation.z = Math.PI / 2;
    mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.92, 10), copperMat, 0, -0.02, -0.075).rotation.z = Math.PI / 2;
    const accum = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 14), copperMat, 0.42, -0.03, -0.095);
    accum.rotation.x = 0.12;
    pathZones.push({ at: 0.42, color: COLOR_COOLED });
    labels.push({ text: "EVAPORATOR COIL", pos: [-0.66, 0.1, -0.04], scale: 0.78 });
    // cross-flow fan: long rotor with pitched blades along x
    const rotor = new THREE.Group();
    rotor.position.set(0, -0.065, -0.02);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.98, 10), steelMat);
    shaft.rotation.z = Math.PI / 2;
    rotor.add(shaft);
    for (let b = 0; b < 16; b += 1) {
      const a = (b / 16) * Math.PI * 2;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.006, 0.06), fanMat);
      blade.position.set(0, Math.sin(a) * 0.045, Math.cos(a) * 0.045);
      blade.rotation.set(-a, 0.55, 0);
      rotor.add(blade);
    }
    rotors.push({ obj: rotor, axis: "x" });
    group.add(rotor);
    labels.push({ text: "CROSS-FLOW FAN", pos: [0.66, -0.08, -0.02], scale: 0.78 });
    // discharge: dark outlet strip + oscillating louver flap
    mesh(new THREE.BoxGeometry(0.98, 0.025, 0.018), darkMat, 0, -0.135, 0.064);
    const flapGeo = new THREE.BoxGeometry(0.96, 0.008, 0.07);
    flapGeo.translate(0, 0, 0.035); // hinge = rear edge
    const flap = new THREE.Mesh(flapGeo, whiteMat);
    flap.position.set(0, -0.138, 0.058);
    flap.rotation.x = 0.6;
    group.add(flap);
    flaps.push(flap);
    pathZones.push({ at: 0.8, color: COLOR_OUT });
    labels.push({ text: "AIR LOUVER", pos: [0, -0.24, 0.08], scale: 0.72 });
    return { group, rotors, flaps, pathZones, labels };
  }

  if (deviceType === "AC_DAK") {
    // ── 4-way ceiling cassette, y=0 at the fan/coil mid-plane, "ceiling" at +0.19. ──
    mesh(new THREE.BoxGeometry(0.55, 0.02, 0.55), steelMat, 0, 0.185, 0); // ceiling mount plate
    for (const [rx, rz] of [
      [-0.21, -0.21],
      [0.21, -0.21],
      [-0.21, 0.21],
      [0.21, 0.21],
    ] as const) {
      mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8), steelMat, rx, 0.155, rz); // drop rods
    }
    labels.push({ text: "CEILING MOUNT", pos: [0, 0.27, 0], scale: 0.7 });
    // hollow chassis border (intake path stays open in the middle)
    const chassis = (outer: number, thick: number, h: number, y: number, m: THREE.Material) => {
      const half = outer / 2;
      const ns = (outer - thick * 2) / 2;
      for (const [w, d, ox, oz] of [
        [outer, thick, 0, -half + thick / 2],
        [outer, thick, 0, half - thick / 2],
        [thick, ns, -half + thick / 2, 0],
        [thick, ns, half - thick / 2, 0],
      ] as const) {
        mesh(new THREE.BoxGeometry(w, h, d), m, ox, y, oz);
      }
    };
    chassis(0.84, 0.17, 0.08, 0.125, steelMat);
    mesh(new THREE.BoxGeometry(0.42, 0.01, 0.42), filterMat, 0, 0.045, 0); // intake filter
    pathZones.push({ at: 0, color: COLOR_INTAKE });
    labels.push({ text: "INTAKE FILTER", pos: [-0.63, 0.06, 0.1], scale: 0.72 });
    // radial intake guard over the fan
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      const slat = mesh(new THREE.BoxGeometry(0.16, 0.008, 0.03), darkMat, Math.cos(a) * 0.155, 0.01, Math.sin(a) * 0.155);
      slat.rotation.y = -a + Math.PI / 2;
    }
    // scroll fan with backward-curved blades
    const rotor = new THREE.Group();
    rotor.position.set(0, -0.02, 0);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.06, 16), fanMat);
    rotor.add(hub);
    for (let b = 0; b < 9; b += 1) {
      const a = (b / 9) * Math.PI * 2;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.15), fanMat);
      blade.position.set(Math.cos(a) * 0.13, 0, Math.sin(a) * 0.13);
      blade.rotation.y = -a + 0.85;
      rotor.add(blade);
    }
    rotors.push({ obj: rotor, axis: "y" });
    group.add(rotor);
    const volute = new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.012, 8, 32), frameMat);
    volute.rotation.x = Math.PI / 2;
    volute.position.set(0, -0.02, 0);
    group.add(volute);
    pathZones.push({ at: 0.38, color: COLOR_COOLED });
    labels.push({ text: "SCROLL FAN", pos: [-0.62, -0.05, 0], scale: 0.72 });
    // coil ring (10 segments, clear of the fan circle)
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      const seg = mesh(new THREE.BoxGeometry(0.15, 0.085, 0.05), coolMat, Math.cos(a) * 0.305, -0.02, Math.sin(a) * 0.305);
      seg.rotation.y = -a;
    }
    labels.push({ text: "COOLING COIL RING", pos: [0, -0.06, 0.68], scale: 0.78 });
    // fascia + mid band + trim (hollow, non-coplanar stack)
    chassis(0.92, 0.1, 0.1, -0.115, whiteMat);
    chassis(0.95, 0.03, 0.12, 0, whiteMat);
    chassis(0.98, 0.02, 0.03, 0.08, std(0xf1f5f9, { roughness: 0.3 }));
    chassis(0.84, 0.05, 0.025, -0.21, std(0xf1f5f9, { roughness: 0.3 }));
    // 4 discharge insets + oscillating vanes
    for (const s of [-1, 1]) {
      mesh(new THREE.BoxGeometry(0.07, 0.012, 0.72), darkMat, s * 0.4, -0.185, 0);
      mesh(new THREE.BoxGeometry(0.72, 0.012, 0.07), darkMat, 0, -0.185, s * 0.4);

    }

    // one 4-way vane set (created ONCE — duplicates would z-fight)
    const vaneGeoZ = new THREE.BoxGeometry(0.62, 0.008, 0.05);
    vaneGeoZ.translate(0, 0, -0.025);
    const vaneGeoX = new THREE.BoxGeometry(0.05, 0.008, 0.62);
    vaneGeoX.translate(-0.025, 0, 0);
    const vaneDefs: Array<{ mesh: THREE.Mesh; axis: "x" | "z"; base: number }> = [
      { mesh: new THREE.Mesh(vaneGeoZ, whiteMat), axis: "x", base: -0.6 },
      { mesh: new THREE.Mesh(vaneGeoZ, whiteMat), axis: "x", base: 0.6 },
      { mesh: new THREE.Mesh(vaneGeoX, whiteMat), axis: "z", base: 0.6 },
      { mesh: new THREE.Mesh(vaneGeoX, whiteMat), axis: "z", base: -0.6 },
    ];
    const vanePos: Array<[number, number, number]> = [
      [0, -0.195, -0.365],
      [0, -0.195, 0.365],
      [-0.365, -0.195, 0],
      [0.365, -0.195, 0],
    ];
    vaneDefs.forEach((v, i) => {
      v.mesh.position.set(...vanePos[i]);
      v.mesh.rotation[v.axis] = v.base;
      group.add(v.mesh);
      flaps.push(v.mesh);
    });
    pathZones.push({ at: 0.8, color: COLOR_OUT });
    labels.push({ text: "4-WAY DISCHARGE LOUVERS", pos: [0, -0.31, 0.1], scale: 0.8 });
    return { group, rotors, flaps, pathZones, labels };
  }

  if (deviceType === "AC_STANDING") {
    // ── Floor tower, y=0 at the floor, z+ = front. Translucent shell shows the guts. ──
    for (const [fx, fz] of [
      [-0.17, -0.17],
      [0.17, -0.17],
      [-0.17, 0.17],
      [0.17, 0.17],
    ] as const) {
      mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.05, 12), darkMat, fx, 0.029, fz); // casters
    }
    mesh(new THREE.BoxGeometry(0.5, 0.05, 0.5), darkMat, 0, 0.085, 0); // plinth
    const shell = mesh(new THREE.BoxGeometry(0.48, 1.56, 0.44), std(0xe2e8f0, { roughness: 0.45, transparent: true, opacity: 0.16 }), 0, 0.885, 0);
    group.add(shell);
    const cap = mesh(new THREE.BoxGeometry(0.54, 0.05, 0.5), whiteMat, 0, 1.7, 0); // top cap
    cap.material = whiteMat;
    pathZones.push({ at: 0, color: COLOR_INTAKE });
    // front louvered intake (angled slats) + filter pad behind them
    for (let g = 0; g < 8; g += 1) {
      const slat = mesh(new THREE.BoxGeometry(0.4, 0.03, 0.014), steelMat, 0, 0.38 + g * 0.15, 0.226);
      slat.rotation.x = 0.28;
    }
    labels.push({ text: "AIR INTAKE", pos: [0.6, 0.5, 0.2], scale: 0.72 });
    mesh(new THREE.BoxGeometry(0.42, 1.1, 0.012), filterMat, 0, 0.9, 0.19); // filter
    pathZones.push({ at: 0.22, color: COLOR_FILTERED });
    labels.push({ text: "AIR FILTER", pos: [-0.62, 0.95, 0.16], scale: 0.7 });
    // vertical evaporator coil stack + copper refrigerant lines
    mesh(new THREE.BoxGeometry(0.38, 1.05, 0.04), coolMat, 0, 0.88, 0.02);
    for (const px of [-0.14, 0.14]) {
      mesh(new THREE.CylinderGeometry(0.013, 0.013, 1.05, 10), copperMat, px, 0.88, -0.03);
    }
    mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 10), copperMat, 0, 1.48, -0.03);
    pathZones.push({ at: 0.5, color: COLOR_COOLED });
    labels.push({ text: "EVAPORATOR COIL", pos: [0.64, 1.0, 0], scale: 0.78 });
    // top discharge fan + collar + guard
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.2, 0.09, 26, 1, true), whiteMat);
    collar.position.set(0, 1.765, 0);
    group.add(collar);
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
    rotors.push({ obj: rotor, axis: "y" });
    group.add(rotor);
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.008, 8, 30), darkMat);
    guard.rotation.x = Math.PI / 2;
    guard.position.set(0, 1.85, 0);
    group.add(guard);
    for (let s = 0; s < 4; s += 1) {
      const a = (s / 4) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.006, 0.01), darkMat);
      spoke.position.set(Math.cos(a) * 0.093, 1.85, Math.sin(a) * 0.093);
      spoke.rotation.y = -a;
      group.add(spoke);
    }
    pathZones.push({ at: 0.85, color: COLOR_OUT });
    labels.push({ text: "DISCHARGE FAN", pos: [0, 2.05, 0], scale: 0.75 });
    // control display
    mesh(new THREE.BoxGeometry(0.16, 0.05, 0.012), std(0x38bdf8, { emissive: 0x0ea5e9, emissiveIntensity: 0.4 }), 0.1, 1.64, 0.226);
    return { group, rotors, flaps, pathZones, labels };
  }

  // ── AHU: full processing chain along X (mirrors the 2D side elevation) ──
  const at = (x: number) => x - 2.55;

  // intake grille
  for (let i = 0; i < 6; i += 1) {
    const slat = mesh(new THREE.BoxGeometry(0.05, 1.15, 1.5), darkMat, at(-0.15 + i * 0.05), 0.1, 0);
    slat.rotation.z = 0.35;
  }
  pathZones.push({ at: 0, color: COLOR_INTAKE });
  labels.push({ text: "INTAKE GRILLE", pos: [at(-0.05), 1.32, 0], scale: 1.0 });
  // panel filter (frame + pleats)
  mesh(new THREE.BoxGeometry(0.08, 1.35, 1.7), frameMat, at(0.55), 0.1, 0);
  for (let i = 0; i < 8; i += 1) {
    mesh(new THREE.BoxGeometry(0.05, 1.25, 0.09), filterMat, at(0.55), 0.1, -0.7 + i * 0.2);
  }
  pathZones.push({ at: 0.16, color: COLOR_FILTERED });
  labels.push({ text: "PANEL FILTER", pos: [at(0.55), 1.32, 0], scale: 1.0 });
  // bag filter pockets (two rows)
  for (let i = 0; i < 4; i += 1) {
    mesh(new THREE.BoxGeometry(0.3, 0.5, 0.34), filterMat, at(1.05), 0.42, -0.62 + i * 0.42);
    mesh(new THREE.BoxGeometry(0.3, 0.4, 0.34), filterMat, at(1.05), -0.28, -0.62 + i * 0.42);
  }
  pathZones.push({ at: 0.3, color: COLOR_FILTERED });
  labels.push({ text: "BAG FILTERS", pos: [at(1.05), 1.32, 0], scale: 1.0 });
  // cooling coil (blue fins + headers + condensate tray/drain)
  for (let i = 0; i < 10; i += 1) {
    mesh(new THREE.BoxGeometry(0.045, 1.45, 1.62), coolMat, at(1.75 + i * 0.045), 0.1, 0);
  }
  mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 12), coolMat, at(1.8), 0.92, 0).rotation.z = Math.PI / 2;
  mesh(new THREE.BoxGeometry(1.0, 0.06, 1.7), steelMat, at(1.8), -0.74, 0); // drip tray
  mesh(new THREE.BoxGeometry(0.75, 0.12, 0.12), steelMat, at(1.8), -0.84, -0.6); // condensate drain
  pathZones.push({ at: 0.44, color: COLOR_COOLED });
  labels.push({ text: "COOLING COIL", pos: [at(1.8), 1.32, 0], scale: 1.0 });
  if (hasHeater) {
    for (let i = 0; i < 8; i += 1) {
      mesh(new THREE.BoxGeometry(0.05, 1.45, 1.62), heatMat, at(2.45 + i * 0.05), 0.1, 0);
    }
    mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 12), heatMat, at(2.5), 0.92, 0).rotation.z = Math.PI / 2;
    pathZones.push({ at: 0.58, color: COLOR_HEATED });
    labels.push({ text: "HEATING COIL", pos: [at(2.5), 1.32, 0], scale: 1.0 });
  }
  // fan section: pitched-blade axial rotor on a shaft, spinning around X
  const rotor = new THREE.Group();
  rotor.position.set(at(3.55), 0.1, 0);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.18, 18), fanMat);
  hub.rotation.z = Math.PI / 2;
  rotor.add(hub);
  for (let b = 0; b < 8; b += 1) {
    const a = (b / 8) * Math.PI * 2;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.62, 0.2), fanMat);
    blade.position.set(0, Math.cos(a) * 0.36, Math.sin(a) * 0.36);
    blade.rotation.set(-a, 0.5, 0); // pitch around the radial axis → real airfoil twist
    rotor.add(blade);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.035, 10, 36), frameMat);
  ring.rotation.y = Math.PI / 2;
  rotor.add(ring);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 12), steelMat);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.set(0.3, 0, 0);
  rotor.add(shaft);
  rotors.push({ obj: rotor, axis: "x" });
  group.add(rotor);
  pathZones.push({ at: 0.78, color: COLOR_OUT });
  labels.push({ text: "SUPPLY FAN", pos: [at(3.55), 1.32, 0], scale: 1.0 });
  // supply duct + flange
  const duct = mesh(new THREE.BoxGeometry(0.55, 0.9, 1.1), whiteMat, at(4.55), 0.1, 0);
  duct.material = whiteMat;
  mesh(new THREE.BoxGeometry(0.06, 0.98, 1.18), darkMat, at(4.85), 0.1, 0);
  pathZones.push({ at: 1, color: COLOR_OUT });
  labels.push({ text: "SUPPLY DUCT", pos: [at(4.55), 1.05, 0], scale: 1.0 });
  // floor rails
  mesh(new THREE.BoxGeometry(6.0, 0.08, 2.0), darkMat, 0, -0.78, 0);

  return { group, rotors, flaps, pathZones, labels };
}

function zoneColorAt(t: number, zones: Array<{ at: number; color: THREE.Color }>): THREE.Color {
  let best = zones[0]?.color ?? COLOR_INTAKE;
  for (const z of zones) {
    if (t >= z.at) best = z.color;
  }
  return best;
}

function getGlbLabels(type: string, hasHeater: boolean): Array<{ text: string; pos: [number, number, number]; scale?: number }> {
  if (type === "AC_SPLIT_WALL") {
    return [
      { text: "AIR INTAKE", pos: [0, 0.28, 0], scale: 0.72 },
      { text: "AIR FILTER", pos: [-0.36, 0.20, 0.10], scale: 0.72 },
      { text: "EVAPORATOR COIL", pos: [-0.38, 0.08, 0.15], scale: 0.75 },
      { text: "CROSS-FLOW FAN", pos: [0.38, -0.04, 0.15], scale: 0.75 },
      { text: "AIR LOUVER", pos: [0, -0.22, 0.08], scale: 0.72 },
    ];
  }
  if (type === "AC_DAK") {
    return [
      { text: "INTAKE GRILLE", pos: [0, -0.12, 0], scale: 0.72 },
      { text: "TURBO FAN", pos: [-0.34, 0.10, 0], scale: 0.72 },
      { text: "COOLING COIL RING", pos: [0.38, 0.10, 0.38], scale: 0.75 },
      { text: "4-WAY LOUVERS", pos: [0, -0.12, 0.44], scale: 0.75 },
    ];
  }
  if (type === "AC_STANDING") {
    return [
      { text: "AIR INTAKE", pos: [0.38, 0.35, 0.18], scale: 0.72 },
      { text: "EVAPORATOR COIL", pos: [-0.38, 0.85, 0.14], scale: 0.75 },
      { text: "CONTROL PANEL", pos: [0.38, 1.48, 0.18], scale: 0.72 },
      { text: "TOP BLOWER", pos: [0, 1.98, 0], scale: 0.75 },
    ];
  }
  return [
    { text: "AIR INTAKE DAMPER", pos: [-1.28, 0.72, 0], scale: 0.85 },
    { text: "PRE-FILTER", pos: [-0.92, 0.72, 0], scale: 0.85 },
    { text: "BAG FILTERS", pos: [-0.68, 0.72, 0], scale: 0.85 },
    { text: "COOLING COIL", pos: [-0.18, 0.72, 0], scale: 0.85 },
    ...(hasHeater ? [{ text: "HEATING COIL", pos: [0.20, 0.72, 0] as [number, number, number], scale: 0.85 }] : []),
    { text: "SUPPLY FAN", pos: [0.68, 0.72, 0], scale: 0.85 },
    { text: "SUPPLY DUCT", pos: [1.32, 0.72, 0], scale: 0.85 },
  ];
}

const GLB_MODEL_URLS: Record<string, string> = {
  AC_SPLIT_WALL: "/models/ac-split-wall.glb",
  AHU: "/models/ahu.glb",
  AC_DAK: "/models/ac-dak.glb",
  AC_STANDING: "/models/ac-standing.glb",
};

/** Per-device-type airflow path: t∈[0,1] → position in the MODEL-GROUP frame. */
function pathPoint(deviceType: string, t: number, lane: number, lift: number, out: THREE.Vector3, isGlb = false): THREE.Vector3 {
  if (deviceType === "AC_SPLIT_WALL") {
    if (isGlb) {
      if (t < 0.65) {
        const k = t / 0.65;
        out.set(
          lane * 0.42,
          0.16 - 0.20 * k + lift * 0.02,
          0.01 + 0.02 * Math.sin(k * Math.PI) + Math.sin(t * 10 + lane * 4) * 0.008,
        );
      } else {
        const k = (t - 0.65) / 0.35;
        out.set(lane * 0.42 + Math.sin(k * 4 + lane * 6) * 0.015, -0.04 - 0.09 * k, 0.01 - 0.07 * k);
      }
      return out;
    }
    // top intake → down through filter/coil → cross-flow fan → out the front-bottom louver
    if (t < 0.72) {
      const k = t / 0.72;
      out.set(
        lane * 0.4,
        0.2 - 0.27 * k + lift * 0.04,
        -0.02 + 0.015 * Math.sin(k * Math.PI) + Math.sin(t * 9 + lane * 5) * 0.012,
      );
    } else {
      const k = (t - 0.72) / 0.28;
      out.set(lane * 0.4 + Math.sin(k * 6 + lane * 8) * 0.02, -0.07 - 0.17 * k, -0.005 + 0.34 * k);
    }
    return out;
  }
  if (deviceType === "AC_DAK") {
    // bottom center → up through guard/fan → radially out through the coil → down out the slots
    if (t < 0.3) {
      const k = t / 0.3;
      out.set(lane * 0.05 * k, -0.3 + 0.28 * k + lift * 0.02, lane * 0.05 * k);
    } else if (t < 0.55) {
      const k = (t - 0.3) / 0.25;
      const angle = lane * 1.7 + 0.6;
      out.set(Math.cos(angle) * 0.05, 0.01 + lift * 0.03, Math.sin(angle) * 0.05);
      out.multiplyScalar(1 + k * 5); // spiral out through the coil ring
    } else {
      const k = (t - 0.55) / 0.45;
      const angle = lane * 1.7 + 0.6;
      const radius = 0.3 + k * 0.28;
      out.set(Math.cos(angle) * radius, -0.02 - k * 0.3 + lift * 0.03, Math.sin(angle) * radius);
    }
    return out;
  }
  if (deviceType === "AC_STANDING") {
    // front louvers → inward through filter → coil → up → top discharge
    if (t < 0.5) {
      const k = t / 0.5;
      out.set(lane * 0.16, 0.42 + k * 0.75, 0.3 - 0.28 * k + lift * 0.03);
    } else if (t < 0.75) {
      const k = (t - 0.5) / 0.25;
      out.set(lane * 0.1, 1.17 + k * 0.42, 0.02 - 0.0 + lift * 0.04);
    } else {
      const k = (t - 0.75) / 0.25;
      const angle = lane * 2.3;
      out.set(Math.cos(angle) * 0.06 * (1 + k * 2.2), 1.66 + k * 0.5, Math.sin(angle) * 0.06 * (1 + k * 2.2) + lift * 0.04);
    }
    return out;
  }
  // AHU
  if (isGlb) {
    const x = -1.35 + t * 2.70;
    const bend = t > 0.4 && t < 0.7 ? Math.sin(((t - 0.4) / 0.3) * Math.PI) * 0.05 : 0;
    out.set(x, -0.05 + lift * 0.25 + bend, lane * 0.32 + Math.sin(t * 8 + lane * 4) * 0.02);
    return out;
  }
  const x = -2.85 + t * 5.7;
  const bend = t > 0.35 && t < 0.6 ? Math.sin(((t - 0.35) / 0.25) * Math.PI) * 0.08 : 0;
  out.set(x, 0.02 + lift * 0.28 + bend, lane * 0.62 + Math.sin(t * 7 + lane * 4) * 0.03);
  return out;
}

/** Particle budget + sprite-label scale per device (standing needs a dense plume). */
const FLOW_CONFIG: Record<string, { count: number; size: number }> = {
  AHU: { count: 260, size: 0.075 },
  AC_SPLIT_WALL: { count: 210, size: 0.032 },
  AC_DAK: { count: 240, size: 0.035 },
  AC_STANDING: { count: 320, size: 0.042 },
};

export default function AhuDetailed3DView({ ahuId, deviceType, status, hasHeater, fanSpeed, className }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const labelSpritesRef = useRef<THREE.Sprite[]>([]);
  const resetCameraRef = useRef<() => void>(() => {});

  useEffect(() => {
    labelSpritesRef.current.forEach((s) => {
      s.visible = showLabels;
    });
  }, [showLabels]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const type =
      deviceType === "AC_DAK" || deviceType === "AC_SPLIT_WALL" || deviceType === "AC_STANDING" ? deviceType : "AHU";
    let disposed = false;
    let isGlbActive = false;

    const width = Math.max(320, mount.clientWidth);
    const height = Math.max(240, mount.clientHeight);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = false;
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.touchAction = "none";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.05, 120);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.25));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(4, 6, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x93c5fd, 0.85);
    rim.position.set(-4, 3, -3);
    scene.add(rim);

    // Initial procedural setup (acts as instant preview while GLB loads, and graceful fallback)
    const casingSize: [number, number, number] =
      type === "AHU"
        ? [6.1, 2.0, 2.1]
        : type === "AC_SPLIT_WALL"
          ? [1.16, 0.38, 0.3]
          : type === "AC_DAK"
            ? [0.96, 0.46, 0.96]
            : [0.56, 1.92, 0.52];
    const casingPos: [number, number, number] =
      type === "AHU" ? [0, 0.1, 0] : type === "AC_SPLIT_WALL" ? [0, 0, -0.035] : type === "AC_DAK" ? [0, -0.015, 0] : [0, 0.96, 0];
    const casing = new THREE.Mesh(
      new THREE.BoxGeometry(...casingSize),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.1, roughness: 0.3, metalness: 0.1, depthWrite: false }),
    );
    casing.position.set(...casingPos);
    scene.add(casing);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(...casingSize)),
      new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.5 }),
    );
    edges.position.copy(casing.position);
    scene.add(edges);

    const procedural = buildComponentMeshes(type, hasHeater);
    const internals = new THREE.Group();
    internals.add(procedural.group);
    scene.add(internals);

    const activeRotors: RotorSpec[] = [...procedural.rotors];
    const activeFlaps: THREE.Object3D[] = [...procedural.flaps];
    let activePathZones = [...procedural.pathZones];

    labelSpritesRef.current = [];
    for (const l of procedural.labels) {
      const sprite = makeLabel(l.text, l.scale ?? 1);
      sprite.position.set(...l.pos);
      sprite.visible = showLabels;
      internals.add(sprite);
      labelSpritesRef.current.push(sprite);
    }

    // Auto-frame helper
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.zoomSpeed = 1.2;
    controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };

    // Grounding disc under the machine
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3.0, 48),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.95, transparent: true, opacity: 0.5 }),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const frameCameraToModel = () => {
      const bbox = new THREE.Box3().setFromObject(internals);
      if (bbox.isEmpty()) return;
      const sphere = bbox.getBoundingSphere(new THREE.Sphere());
      const fitDist = (sphere.radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.14;
      const viewDir =
        type === "AC_SPLIT_WALL"
          ? new THREE.Vector3(0.55, 0.32, 1.35)
          : type === "AC_DAK"
            ? new THREE.Vector3(0.8, 0.75, 0.9)
            : type === "AC_STANDING"
              ? new THREE.Vector3(0.85, 0.35, 1.15)
              : new THREE.Vector3(1, 0.5, 1);
      camera.position.copy(sphere.center).addScaledVector(viewDir.normalize(), fitDist);
      controls.minDistance = sphere.radius * 0.65;
      controls.maxDistance = fitDist * 3.5;
      controls.target.copy(sphere.center);
      controls.update();
      floor.position.y = bbox.min.y - Math.max(0.12, sphere.radius * 0.12);
      floor.scale.setScalar(sphere.radius * 1.35);
    };
    resetCameraRef.current = frameCameraToModel;
    frameCameraToModel();

    // Airflow particles
    const COUNT = FLOW_CONFIG[type]?.count ?? 130;
    const P_SIZE = FLOW_CONFIG[type]?.size ?? 0.05;
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const particles: Particle[] = [];
    for (let i = 0; i < COUNT; i += 1) {
      particles.push({ t: i / COUNT, lane: Math.random() * 2 - 1, lift: Math.random(), speed: 0.85 + Math.random() * 0.3 });
    }
    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    pointsGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const pointsMat = new THREE.PointsMaterial({
      size: P_SIZE,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    const points = new THREE.Points(pointsGeo, pointsMat);
    points.frustumCulled = false;
    internals.add(points);

    // ── Load Blender-generated GLTF 3D Model ──
    const glbUrl = GLB_MODEL_URLS[type];
    if (glbUrl) {
      const loader = new GLTFLoader();
      loader.load(
        glbUrl,
        (gltf) => {
          if (disposed) {
            disposeGroupDeep(gltf.scene);
            return;
          }
          isGlbActive = true;

          // Hide procedural wireframe & outer box as Blender model has its own sleek cutaway
          casing.visible = false;
          edges.visible = false;

          // Remove procedural mesh group and existing label sprites
          internals.remove(procedural.group);
          disposeGroupDeep(procedural.group);

          const toRemove: THREE.Object3D[] = [];
          internals.children.forEach((c) => {
            if ((c as THREE.Sprite).isSprite) toRemove.push(c);
          });
          toRemove.forEach((s) => {
            const spr = s as THREE.Sprite;
            (spr.material as THREE.SpriteMaterial)?.map?.dispose();
            (spr.material as THREE.Material)?.dispose();
            internals.remove(s);
          });
          labelSpritesRef.current = [];

          // Mount Blender model
          const modelScene = gltf.scene;
          internals.add(modelScene);

          // Clear previous animation handles
          activeRotors.length = 0;
          activeFlaps.length = 0;

          modelScene.traverse((child) => {
            if (child.name === "Rotor") {
              // AHU direct-drive plug fan and Split Wall cross-flow fan both rotate around X!
              const axis: "x" | "y" = type === "AC_SPLIT_WALL" || type === "AHU" ? "x" : "y";
              activeRotors.push({ obj: child as THREE.Group, axis });
            }
            if (child.name === "AirLouver" || child.name === "LouverVane") {
              activeFlaps.push(child);
            }
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              if (child.name === "HeatingCoil") {
                child.visible = hasHeater;
              }
              const matName = (mesh.material as THREE.Material)?.name ?? "";
              if (
                child.name.includes("Window") ||
                child.name.includes("Cutaway") ||
                child.name.includes("Glass") ||
                matName.includes("Glass") ||
                matName.includes("Cutaway")
              ) {
                // High-transparency crystal clear viewing glass
                mesh.material = new THREE.MeshPhysicalMaterial({
                  color: 0xe0f2fe,
                  transparent: true,
                  opacity: 0.16,
                  roughness: 0.04,
                  metalness: 0.05,
                  transmission: 0.94,
                  depthWrite: false,
                });
              } else if (matName.includes("Coil") || child.name.includes("Coil")) {
                // Vibrant metallic cooling blue fins
                mesh.material = new THREE.MeshStandardMaterial({
                  color: matName.includes("Heat") ? 0xf97316 : 0x0284c7,
                  roughness: 0.28,
                  metalness: 0.55,
                });
              } else if (matName.includes("Copper") || child.name.includes("Copper") || child.name.includes("Header")) {
                // Polished copper headers
                mesh.material = new THREE.MeshStandardMaterial({
                  color: 0xb45309,
                  roughness: 0.22,
                  metalness: 0.9,
                });
              } else if (matName.includes("Display")) {
                // Glowing cyan LED display
                mesh.material = new THREE.MeshStandardMaterial({
                  color: 0x38bdf8,
                  emissive: new THREE.Color(0x0ea5e9),
                  emissiveIntensity: 2.5,
                  roughness: 0.1,
                });
              }
            }
          });

          // Add clean billboard labels for Blender model
          const glbLabels = getGlbLabels(type, hasHeater);
          for (const l of glbLabels) {
            const sprite = makeLabel(l.text, l.scale ?? 1);
            sprite.position.set(...l.pos);
            sprite.visible = showLabels;
            internals.add(sprite);
            labelSpritesRef.current.push(sprite);
          }

          // Path zones for colors
          if (type === "AHU") {
            activePathZones = [
              { at: 0, color: COLOR_INTAKE },
              { at: 0.16, color: COLOR_FILTERED },
              { at: 0.44, color: COLOR_COOLED },
              ...(hasHeater ? [{ at: 0.58, color: COLOR_HEATED }] : []),
              { at: 0.78, color: COLOR_OUT },
            ];
          }

          // Ensure airflow particles are at the top of the group
          internals.remove(points);
          internals.add(points);

          // Re-frame camera to the Blender model
          frameCameraToModel();
        },
        undefined,
        (err) => {
          console.warn("GLTF load error, falling back to procedural model:", err);
        },
      );
    }

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
      const targetFan = running ? 5 + Math.min(1.2, Math.max(0.4, (fanSpeed ?? 3) / 4)) * 3.6 : 0;
      fanSpeedNow += (targetFan - fanSpeedNow) * Math.min(1, dt * 1.6);
      fanAngle += fanSpeedNow * dt;

      for (const r of activeRotors) {
        // Spin along true aerodynamic airflow axis
        r.obj.rotation[r.axis] = -fanAngle;
      }

      if (running) flapPhase += dt * 1.8;
      activeFlaps.forEach((flap, i) => {
        const base = isGlbActive ? 0.35 : 0.6;
        const target = running ? base + Math.sin(flapPhase + i * 1.3) * 0.22 : base * 0.5;
        flap.rotation.x += (target - flap.rotation.x) * Math.min(1, dt * 6);
      });

      const flow = running ? fanSpeedNow * 0.028 : 0.0;
      for (let i = 0; i < COUNT; i += 1) {
        const p = particles[i];
        p.t += flow * p.speed * dt * 3.2;
        if (p.t > 1) p.t -= 1;
        pathPoint(type, p.t, p.lane, p.lift, tmpVec, isGlbActive);
        positions[i * 3] = tmpVec.x;
        positions[i * 3 + 1] = tmpVec.y;
        positions[i * 3 + 2] = tmpVec.z;
        const c = zoneColorAt(p.t, activePathZones);
        const dim = running ? 1 : 0.22;
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
      internals.traverse((obj) => {
        const sprite = obj as THREE.Sprite;
        if (sprite.isSprite) {
          const mat = sprite.material as THREE.SpriteMaterial;
          mat.map?.dispose();
          mat.dispose();
        }
      });
      disposeGroupDeep(internals);
      casing.geometry.dispose();
      (casing.material as THREE.Material).dispose();
      edges.geometry.dispose();
      (edges.material as THREE.Material).dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      pointsGeo.dispose();
      pointsMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
    };
  }, [ahuId, deviceType, status, hasHeater, fanSpeed]);

  const typeName =
    deviceType === "AC_SPLIT_WALL"
      ? "Wall-Mounted Split AC"
      : deviceType === "AC_DAK"
        ? "4-Way Ceiling Cassette"
        : deviceType === "AC_STANDING"
          ? "Floor Standing AC Tower"
          : "Air Handling Unit (AHU)";

  const isRunning = status === "RUN";

  return (
    <div className={cx("relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 shadow-2xl", className)} data-ahu-detail-3d={ahuId}>
      {/* Top Floating Glassmorphic Toolbar (shadcn/ui & Magic UI inspired) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between p-3 sm:p-4">
        {/* Left: Device Name & Pulsing Status */}
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-slate-700/70 bg-slate-900/80 px-3 py-1.5 backdrop-blur-md shadow-sm">
          <span className="text-[12px] font-semibold text-slate-200">{typeName}</span>
          <span className="h-3 w-px bg-slate-700" />
          <span className="flex items-center gap-1.5 text-[11px] font-mono font-bold tracking-wider">
            <span className="relative flex h-2 w-2">
              {isRunning && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
              <span className={cx("relative inline-flex h-2 w-2 rounded-full", isRunning ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : status === "FAULT" ? "bg-rose-500 shadow-[0_0_8px_#f43f5e]" : "bg-slate-400")} />
            </span>
            <span className={isRunning ? "text-emerald-400" : status === "FAULT" ? "text-rose-400" : "text-slate-400"}>
              {status}
            </span>
          </span>
        </div>

        {/* Right: Interactive Toolbar Buttons */}
        <div className="pointer-events-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowLabels(!showLabels)}
            className={cx(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all active:scale-95 shadow-sm backdrop-blur-md",
              showLabels
                ? "border-sky-500/40 bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/30"
                : "border-slate-700/70 bg-slate-900/80 text-slate-400 hover:text-slate-200 hover:border-slate-600",
            )}
            title="Toggle component tags"
          >
            <span>🏷️</span>
            <span className="hidden sm:inline">Labels</span>
          </button>
          <button
            type="button"
            onClick={() => resetCameraRef.current()}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700/70 bg-slate-900/80 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition-all hover:border-slate-600 hover:text-white active:scale-95 shadow-sm backdrop-blur-md"
            title="Reset Camera Framing"
          >
            <span>🔄</span>
            <span className="hidden sm:inline">Reset</span>
          </button>
        </div>
      </div>

      {/* 3D Canvas Mount */}
      <div ref={mountRef} className="h-[340px] w-full sm:h-[400px] touch-none select-none" style={{ touchAction: "none" }} />

      {/* Bottom Floating Legend Bar (Clean pill design) */}
      <div className="border-t border-slate-800/80 bg-slate-950/70 px-4 py-2 backdrop-blur-md flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-slate-300">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-slate-400 shadow-[0_0_6px_#94a3b8]" /> intake</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-slate-300 shadow-[0_0_6px_#cbd5e1]" /> filter</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_6px_#38bdf8]" /> cooling</span>
          {hasHeater && (
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-orange-400 shadow-[0_0_6px_#fb923c]" /> heating</span>
          )}
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_6px_#67e8f9]" /> supply</span>
        </div>
        <span className="ml-auto text-[11px] text-slate-400 font-medium">
          🖱️ Drag to orbit · Scroll / Pinch to zoom
        </span>
      </div>
    </div>
  );
}
