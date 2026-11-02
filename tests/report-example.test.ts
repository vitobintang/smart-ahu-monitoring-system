import { test } from "node:test";
import { equal, match, doesNotMatch } from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ReportExample from "../src/components/ReportExample";

test("labels the summary as simulated rather than real history", () => {
  const html = renderToStaticMarkup(createElement(ReportExample));

  match(html, /SIMULATED/);
  match(html, /not real history/i);
  match(html, /no AHU is assigned/i);
});

test("shows summary values for three valid example readings", () => {
  const html = renderToStaticMarkup(createElement(ReportExample));

  for (const text of [
    "Valid samples",
    "Minimum",
    "Maximum",
    "Average",
    "22.0",
    "unavailable",
  ]) {
    equal(html.includes(text), true);
  }

  match(html, />3<\/dd>/);
  match(html, />20<\/dd>/);
  match(html, />24<\/dd>/);
});

test("the example has no control inputs", () => {
  const html = renderToStaticMarkup(createElement(ReportExample));

  doesNotMatch(html, /<(button|input|select|form)\b/i);
});