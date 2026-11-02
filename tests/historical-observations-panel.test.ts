import { test } from "node:test";
import { match, doesNotMatch } from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import HistoricalObservationsPanel from "../src/components/HistoricalObservationsPanel";

test("initial panel is historical, unprotected and makes no displayed data claim", () => {
  const html = renderToStaticMarkup(
    createElement(HistoricalObservationsPanel, { ahuId: "AHU-01" }),
  );

  match(html, /No observations displayed/);
  match(html, /not protected by login/i);
  match(html, /not live status/i);
  match(html, /Clear \/ cancel/);
  doesNotMatch(html, /Reported measurement time/);
});