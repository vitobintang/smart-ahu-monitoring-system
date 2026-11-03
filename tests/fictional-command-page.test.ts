import { test } from "node:test";
import { equal, match } from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import CommandPracticePage from "../src/app/simulator/commands/page";
import {
  PreviewNavigationLinks,
} from "../src/components/PreviewNavigation";

test("command practice page includes clear non-operational notice", () => {
  const html = renderToStaticMarkup(
    React.createElement(CommandPracticePage),
  );

  match(html, /not protected by login/);
  match(html, /cannot control an AHU/);
  match(html, /Fictional command lifecycle/);
  match(html, /href="\/simulator"/);
});

test("navigation marks command practice as the current page", () => {
  const html = renderToStaticMarkup(
    React.createElement(PreviewNavigationLinks, {
      pathname: "/simulator/commands",
    }),
  );

  const link =
    html.match(/<a\b[^>]*aria-current="page"[^>]*>/)?.[0] ?? "";

  match(link, /href="\/simulator\/commands"/);
  equal((html.match(/aria-current="page"/g) ?? []).length, 1);
});