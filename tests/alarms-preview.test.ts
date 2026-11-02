import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import AlarmsPage from "../src/app/alarms/page";

test("alarm page makes its non-operational status clear", () => {
  const html = renderToStaticMarkup(createElement(AlarmsPage));

  assert.match(html, /Alarm center/);
  assert.match(html, /Not operational/);
  assert.match(html, /not protected by login/);
  assert.match(html, /does not monitor or show real alarms/);
  assert.match(html, /Current alarm status is unknown/);
  assert.match(html, /cannot acknowledge, clear or save alarms/);
});

test("alarm examples are fictional and only filter controls are available", () => {
  const html = renderToStaticMarkup(createElement(AlarmsPage));

  assert.match(html, /FICTIONAL EXAMPLES/);
  assert.match(html, /3 fictional scenarios shown/);
  assert.match(html, /Example ACTIVE/);
  assert.match(html, /Example RESOLVED/);
  assert.equal(
    (html.match(/<tbody[^>]*>[\s\S]*?<\/tbody>/g) ?? []).length,
    1,
  );
  assert.equal((html.match(/<tr\b/g) ?? []).length, 4);
  assert.equal((html.match(/<button\b/g) ?? []).length, 1);
  assert.match(html, /Reset example filters/);
});