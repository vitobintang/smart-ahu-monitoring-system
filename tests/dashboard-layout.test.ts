import { test } from "node:test";
import { equal, match, ok } from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import HomePage from "../src/app/page";
import {
  PreviewNavigationLinks,
} from "../src/components/PreviewNavigation";

test("dashboard presents planned counts and unavailable operational data", () => {
  const html = renderToStaticMarkup(React.createElement(HomePage));

  match(html, /Not operational/);
  match(html, /not protected by login/);
  match(html, /Planned units/);
  match(html, />7<\/p>/);
  match(html, /Units running/);
  match(html, /Active alarms/);
  match(html, /Last update/);

  const overview =
    html.match(
      /<section aria-labelledby="overview-heading"[\s\S]*?<\/section>/,
    )?.[0] ?? "";

  equal((overview.match(/>Unavailable<\/p>/g) ?? []).length, 3);

  match(html, /Search by AHU identifier/);
});

test("dashboard shortcuts point to the existing preview routes", () => {
  const html = renderToStaticMarkup(React.createElement(HomePage));

  for (const path of [
    "/alarms",
    "/reports",
    "/trends",
    "/config",
  ]) {
    ok(html.includes(`href="${path}"`));
  }

  match(html, /Examples are not live equipment data/);
});

test("navigation groups preserve all preview links and current-page indication", () => {
  const paths = [
    "/",
    "/alarms",
    "/reports",
    "/trends",
    "/energy",
    "/maintenance",
    "/simulator",
    "/config",
    "/admin",
    "/audit",
    "/login",
  ];

  for (const path of paths) {
    const html = renderToStaticMarkup(
      React.createElement(PreviewNavigationLinks, {
        pathname: path,
      }),
    );

    match(html, /Overview/);
    match(html, /Monitoring/);
    match(html, /Management/);

    for (const href of paths) {
      ok(html.includes(`href="${href}"`));
    }

    equal((html.match(/aria-current="page"/g) ?? []).length, 1);

    const active =
      html.match(/<a\b[^>]*aria-current="page"[^>]*>/)?.[0] ?? "";

    ok(active.includes(`href="${path}"`));
  }
});