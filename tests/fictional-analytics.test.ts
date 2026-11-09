import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  examplePoints,
  summarizeExample,
} from "../src/lib/fictional-analytics";
import { AHU_IDS } from "../src/lib/ahu";

import FictionalAnalytics from "../src/components/FictionalAnalytics";

test("fixtures are deterministic, keyed to the fleet, and reject unknown units", () => {
  const first = examplePoints(AHU_IDS[0]);

  assert.equal(first.length, 6);
  assert.deepEqual(first, examplePoints(AHU_IDS[0]));
  assert.throws(() => examplePoints("AHU-99"));
});

test("missing examples remain unavailable and are excluded from summaries", () => {
  assert.equal(
    examplePoints(AHU_IDS[0])[3].roomTemp,
    null,
  );

  assert.equal(
    examplePoints(AHU_IDS[0])[3].voltage,
    null,
  );

  assert.equal(
    examplePoints(AHU_IDS[0])[3].filterPressure,
    null,
  );

  assert.deepEqual(summarizeExample([0, 2, null]), {
    included: 2,
    missing: 1,
    min: 0,
    max: 2,
    average: 1,
  });

  assert.deepEqual(summarizeExample([null]), {
    included: 0,
    missing: 1,
    min: null,
    max: null,
    average: null,
  });
});

test("all three views label fiction and show a gap without connecting points across it", () => {
  for (const section of [
    "trends",
    "energy",
    "maintenance",
  ] as const) {
    const html = renderToStaticMarkup(
      createElement(FictionalAnalytics, { section }),
    );

    assert.match(html, /Fixed invented values/);
    assert.match(html, /Missing points create gaps/);
    assert.match(html, /5 included, 1 missing/);
    assert.match(html, /Real information unavailable/);

    assert.equal(
      (html.match(/<circle\b/g) ?? []).length,
      5,
    );

    assert.equal(
      (html.match(/<line\b/g) ?? []).length,
      3,
    );

    assert.equal(
      (html.match(/<tbody[^>]*>/g) ?? []).length,
      1,
    );
  }
});