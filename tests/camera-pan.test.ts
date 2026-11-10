import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";

function approxVec(v: { dx: number; dz: number }, ex: number, ez: number, eps = 1e-9) {
  ok(Math.abs(v.dx - ex) < eps, `dx ${v.dx} ≈ ${ex}`);
  ok(Math.abs(v.dz - ez) < eps, `dz ${v.dz} ≈ ${ez}`);
}

import { CAM_PAN_RANGE_X, CAM_PAN_RANGE_Z, CAM_RADIUS_MAX, CAM_RADIUS_MIN, panDeltaFromKeys } from "../src/components/AhuFacilityMap3D";

test("panDeltaFromKeys: W glides into the screen at every orbit angle", () => {
  // theta 0: camera on +Z looking toward -Z → forward step must be -Z.
  approxVec(panDeltaFromKeys(new Set(["w"]), 0, 1), 0, -1);
  // theta π/2: camera on +X looking toward -X → forward step must be -X.
  approxVec(panDeltaFromKeys(new Set(["w"]), Math.PI / 2, 1), -1, 0);
  // S is the exact reverse of W.
  const w = panDeltaFromKeys(new Set(["w"]), 0.7, 2);
  const s = panDeltaFromKeys(new Set(["s"]), 0.7, 2);
  approxVec(s, -w.dx, -w.dz);
});

test("panDeltaFromKeys: D strafes screen-right, A mirrors", () => {
  // theta 0 (camera on +Z): screen-right is world +X.
  approxVec(panDeltaFromKeys(new Set(["d"]), 0, 1), 1, 0);
  // theta π/2 (camera on +X): screen-right is world -Z.
  approxVec(panDeltaFromKeys(new Set(["d"]), Math.PI / 2, 1), 0, -1);
  const d = panDeltaFromKeys(new Set(["d"]), 1.1, 1.5);
  const a = panDeltaFromKeys(new Set(["a"]), 1.1, 1.5);
  approxVec(a, -d.dx, -d.dz);
});

test("panDeltaFromKeys: arrows alias WASD, combos compose, no keys = no move", () => {
  deepStrictEqual(panDeltaFromKeys(new Set(["arrowup"]), 0.4, 1), panDeltaFromKeys(new Set(["w"]), 0.4, 1));
  deepStrictEqual(panDeltaFromKeys(new Set(["arrowleft"]), 0.4, 1), panDeltaFromKeys(new Set(["a"]), 0.4, 1));
  deepStrictEqual(panDeltaFromKeys(new Set(["arrowdown"]), 0.4, 1), panDeltaFromKeys(new Set(["s"]), 0.4, 1));
  deepStrictEqual(panDeltaFromKeys(new Set(["arrowright"]), 0.4, 1), panDeltaFromKeys(new Set(["d"]), 0.4, 1));

  // W+D composes into a diagonal (forward + strafe), not a lock-up.
  const diag = panDeltaFromKeys(new Set(["w", "d"]), 0, 1);
  approxVec(diag, 1, -1);

  deepStrictEqual(panDeltaFromKeys(new Set(), 0.9, 3), { dx: 0, dz: 0 });
  deepStrictEqual(panDeltaFromKeys(new Set(["shift"]), 0.9, 3), { dx: 0, dz: 0 }, "non-pan keys are ignored");
});

test("camera limits: pan covers the far grounds, radius spans close-up to overview", () => {
  // Ground plane is 190×190 — pan range must reach rooms placed far out.
  equal(CAM_PAN_RANGE_X, 80);
  equal(CAM_PAN_RANGE_Z, 78);
  equal(CAM_RADIUS_MIN, 9);
  equal(CAM_RADIUS_MAX, 130);
});
