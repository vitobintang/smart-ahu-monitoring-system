import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";

import AhuSchematicPreview from "../src/components/AhuSchematicPreview";

test("fan illustration uses the corrected blade path", () => {
  const html = renderToStaticMarkup(createElement(AhuSchematicPreview));
  const dom = new JSDOM(html);

  try {
    const heading = Array.from(
      dom.window.document.querySelectorAll("h3"),
    ).find((element) => element.textContent === "Fan");

    assert.ok(heading);

    const svg =
      heading.parentElement?.parentElement?.querySelector("svg");

    assert.ok(svg);
    assert.equal(svg.getAttribute("aria-hidden"), "true");

    assert.equal(
      svg.querySelector("path")?.getAttribute("d"),
      "M24 21c-3-6-1-9 2-10 3-1 5 2 4 5l-3 5M27 25c6-2 9 0 9 3s-3 5-6 3l-4-4M22 27c-2 6-5 7-8 5-2-2-1-5 2-6l5-1",
    );
  } finally {
    dom.window.close();
  }
});