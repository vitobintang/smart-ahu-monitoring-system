import { test } from "node:test";
import {
  deepStrictEqual,
  equal,
  match,
  doesNotMatch,
} from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import AhuUnitGrid, {
  filterPlannedUnits,
} from "../src/components/AhuUnitGrid";

test("initial grid shows all seven planned identifiers and unavailable values", () => {
  const html = renderToStaticMarkup(createElement(AhuUnitGrid));

  match(html, /7 of 7 planned units/);

  for (const id of [
    "AHU-01",
    "AHU-02",
    "AHU-03",
    "AHU-04",
    "AHU-05",
    "AHU-06",
    "AHU-07",
  ]) {
    match(html, new RegExp(`href="/ahu/${id}"`));
  }

  equal((html.match(/Status unavailable/g) ?? []).length, 7);
  doesNotMatch(html, /Status running/i);
});

test("search is case-insensitive and ignores surrounding whitespace", () => {
  deepStrictEqual(filterPlannedUnits("  ahu-07  "), ["AHU-07"]);
});

test("empty search restores all seven units", () => {
  equal(filterPlannedUnits("  ").length, 7);
});

test("an unknown search returns no matches", () => {
  deepStrictEqual(filterPlannedUnits("AHU-99"), []);
});