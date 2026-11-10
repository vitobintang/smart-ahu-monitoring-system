import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { buildAhuModel3D } from "../src/components/ahu-model-builders";
import { buildComponentMeshes } from "../src/components/AhuDetailed3DView";

/**
 * Device-model geometry audit (2026-11-11 "no flickering" pass).
 *
 * Z-fighting/shimmer on the 3D models comes from two things: parts whose faces
 * land within ~2 mm of each other (near-coplanar boxes), and NaN geometry.
 * These tests build every device model — both the facility-map exteriors and
 * the detailed viewer internals — and assert neither can happen, so future
 * model edits cannot silently reintroduce the flicker.
 */

const EPS = 2e-3;

interface Entry {
  box: THREE.Box3;
  axisAligned: boolean;
}

function collect(root: THREE.Object3D): Entry[] {
  root.updateMatrixWorld(true);
  const out: Entry[] = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return; // edge overlays intentionally hug their box
    const q = new THREE.Quaternion().setFromEuler(mesh.rotation);
    const axisAligned =
      Math.abs(q.x) < 1e-6 &&
      Math.abs(q.z) < 1e-6 &&
      [0, Math.PI / 2, Math.PI].some((a) => Math.abs(Math.abs(q.y) - a) < 1e-6);
    out.push({ box: new THREE.Box3().setFromObject(mesh), axisAligned });
  });
  return out;
}

function geometryProblems(root: THREE.Object3D): string[] {
  const problems: string[] = [];
  const entries = collect(root);
  for (const e of entries) {
    for (const v of [e.box.min.x, e.box.max.x, e.box.min.y, e.box.max.y, e.box.min.z, e.box.max.z]) {
      if (Number.isNaN(v)) problems.push("NaN bounding box");
    }
  }
  const boxes = entries.filter((e) => e.axisAligned).map((e) => e.box);
  const near = (a: number, b: number) => Math.abs(a - b) < EPS;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const overlaps =
        a.min.x < b.max.x - EPS && b.min.x < a.max.x - EPS &&
        a.min.y < b.max.y - EPS && b.min.y < a.max.y - EPS &&
        a.min.z < b.max.z - EPS && b.min.z < a.max.z - EPS;
      if (!overlaps) continue;
      const coplanar =
        [a.min.x, a.max.x].some((v) => [b.min.x, b.max.x].some((w) => near(v, w))) ||
        [a.min.y, a.max.y].some((v) => [b.min.y, b.max.y].some((w) => near(v, w))) ||
        [a.min.z, a.max.z].some((v) => [b.min.z, b.max.z].some((w) => near(v, w)));
      if (coplanar) problems.push(`coplanar face pair #${i}/#${j} (z-fight risk)`);
    }
  }
  return problems;
}

test("facility-map device models have no coplanar faces, NaN boxes, or status lamps", () => {
  for (const deviceType of [null, "AC_SPLIT_WALL", "AC_DAK", "AC_STANDING"] as const) {
    const built = buildAhuModel3D({ id: "T", status: "RUN", hasHeater: true, outdoor: false, deviceType });
    assert.deepEqual(geometryProblems(built.group), [], `map model ${deviceType ?? "AHU"}`);
    // RUN indicator = animation: a spinning rotor (split: oscillating flap) + a plume
    if (deviceType === "AC_SPLIT_WALL") {
      assert.ok(built.flaps.length >= 1, "split must have an oscillating flap");
    } else {
      assert.ok(built.rotors.length >= 1, `${deviceType ?? "AHU"} must have a rotor`);
    }
    assert.ok(built.airflow, `${deviceType ?? "AHU"} RUN must emit an airflow plume`);
    // halo sits above the 0.03 m room floors → the selection ring never z-fights the floor
    assert.ok(built.halo.position.y >= 0.04, `${deviceType ?? "AHU"} halo must float above room floors`);
  }
});

test("detailed-viewer internals have no coplanar faces and expose animatable parts", () => {
  for (const deviceType of ["AHU", "AC_SPLIT_WALL", "AC_DAK", "AC_STANDING"]) {
    const built = buildComponentMeshes(deviceType, true);
    assert.deepEqual(geometryProblems(built.group), [], `detail model ${deviceType}`);
    assert.ok(built.rotors.length >= 1, `${deviceType} must have a fan rotor`);
    assert.ok(built.labels.length >= 3, `${deviceType} internals must be labeled`);
    for (const l of built.labels) {
      for (const v of l.pos) assert.ok(Number.isFinite(v), "label positions must be finite");
    }
  }
  // flap counts: split = 1 discharge flap, cassette = 4-way vanes, standing = guard only
  assert.equal(buildComponentMeshes("AC_SPLIT_WALL", false).flaps.length, 1);
  assert.equal(buildComponentMeshes("AC_DAK", false).flaps.length, 4);
});

test("airflow plume only exists while actually running (ghost/STOP models stay clean)", () => {
  for (const status of ["STOP", "FAULT", "OFFLINE"] as const) {
    const built = buildAhuModel3D({ id: "T", status, hasHeater: false, outdoor: false, deviceType: "AC_SPLIT_WALL" });
    assert.equal(built.airflow, null, `${status} must not emit a plume`);
  }
  const ghost = buildAhuModel3D({ id: "G", status: "RUN", hasHeater: false, outdoor: false, deviceType: "AC_DAK", isGhost: true });
  assert.equal(ghost.airflow, null, "ghosts must not emit a plume");
  const running = buildAhuModel3D({ id: "T", status: "RUN", hasHeater: false, outdoor: false, deviceType: "AC_STANDING" });
  assert.ok(running.airflow, "RUN must emit a plume");
});
