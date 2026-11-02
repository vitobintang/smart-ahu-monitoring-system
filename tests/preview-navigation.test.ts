import { test } from "node:test";
import { match, doesNotMatch, equal } from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PreviewNavigationLinks } from "../src/components/PreviewNavigation";

test("navigation links only to the current preview pages", () => {
  const html = renderToStaticMarkup(
    createElement(PreviewNavigationLinks, { pathname: "/" }),
  );

  match(html, /aria-label="Main navigation"/);

  for (const path of ["/", "/alarms", "/reports", "/simulator", "/login"]) {
    match(html, new RegExp(`href="${path}"`));
  }

  equal((html.match(/aria-current="page"/g) ?? []).length, 1);
});

test("reports link alone is current on the reports page", () => {
  const html = renderToStaticMarkup(
    createElement(PreviewNavigationLinks, { pathname: "/reports" }),
  );

  match(
    html,
    /href="\/reports"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/reports"/,
  );

  equal((html.match(/aria-current="page"/g) ?? []).length, 1);
});

test("an AHU detail page is not falsely labelled as a navigation page", () => {
  const html = renderToStaticMarkup(
    createElement(PreviewNavigationLinks, {
      pathname: "/ahu/AHU-01",
    }),
  );

  doesNotMatch(html, /aria-current="page"/);
});

test("unknown pathname does not mark a link current", () => {
  const html = renderToStaticMarkup(
    createElement(PreviewNavigationLinks, { pathname: null }),
  );

  doesNotMatch(html, /aria-current="page"/);
});

test("alarms link alone is current on the alarms page", () => {
  const html = renderToStaticMarkup(
    createElement(PreviewNavigationLinks, { pathname: "/alarms" }),
  );

  match(
    html,
    /href="\/alarms"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/alarms"/,
  );

  equal((html.match(/aria-current="page"/g) ?? []).length, 1);
});