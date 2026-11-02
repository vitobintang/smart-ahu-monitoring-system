import { test } from "node:test";
import { match, doesNotMatch } from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ProtectedUnitList from "../src/components/ProtectedUnitList";

test("initial preview contains no data and explains its protection", () => {
  const html = renderToStaticMarkup(createElement(ProtectedUnitList));

  match(html, /No request has been made/);
  match(html, /dashboard itself is not protected/i);
  doesNotMatch(html, /Unit 1/);
});