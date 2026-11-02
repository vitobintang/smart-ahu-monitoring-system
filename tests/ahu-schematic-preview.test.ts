import { test } from "node:test";
import { equal, match, doesNotMatch } from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import AhuSchematicPreview from "../src/components/AhuSchematicPreview";

test("identifies the visualization as a non-operational illustration", () => {
  const html = renderToStaticMarkup(createElement(AhuSchematicPreview));

  match(html, /not the actual equipment layout/i);
  match(html, /no live data or controls are connected/i);
});

test("shows conceptual components with installation unknown", () => {
  const html = renderToStaticMarkup(createElement(AhuSchematicPreview));

  for (const name of ["Filter", "Cooling coil", "Fan", "Heater (optional)"]) {
    equal(html.includes(name), true);
  }

  equal((html.match(/Installation unknown/g) ?? []).length, 4);
});

test("contains no interactive control inputs", () => {
  const html = renderToStaticMarkup(createElement(AhuSchematicPreview));

  doesNotMatch(html, /<(button|input|select|form)\b/i);
});