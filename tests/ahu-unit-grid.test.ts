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

test("initial grid shows the adopted unit with an unavailable status", () => {
  const html = renderToStaticMarkup(createElement(AhuUnitGrid));

  match(html, /1 of 1 planned units/);
  match(html, /href="\/devices\/GTM-DAIKIN-001"/);

  equal((html.match(/Status unavailable/g) ?? []).length, 1);
  doesNotMatch(html, /Status running/i);
});

test("search is case-insensitive and ignores surrounding whitespace", () => {
  deepStrictEqual(filterPlannedUnits("  gtm-daikin-001  "), ["GTM-DAIKIN-001"]);
});

test("empty search restores the whole fleet", () => {
  equal(filterPlannedUnits("  ").length, 1);
});

test("an unknown search returns no matches", () => {
  deepStrictEqual(filterPlannedUnits("AHU-99"), []);
});

test("search uses a labelled clear button instead of a native search input", () => {
  const html = renderToStaticMarkup(createElement(AhuUnitGrid));

  match(html, /type="text"/);
  match(html, /role="searchbox"/);
  match(html, /Clear search/);
  doesNotMatch(html, /type="search"/);
});