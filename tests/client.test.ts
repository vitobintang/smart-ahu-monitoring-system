import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { timeAgo } from "../src/lib/client";
import { QualityTag, StatusBadge } from "../src/components/ui";

test("timeAgo formats relative elapsed intervals deterministically", () => {
  const base = Date.parse("2026-01-01T12:00:00Z");
  assert.equal(timeAgo(null, base), "never");
  assert.equal(timeAgo("2026-01-01T11:59:45Z", base), "15 s ago");
  assert.equal(timeAgo("2026-01-01T11:45:00Z", base), "15 min ago");
  assert.equal(timeAgo("2026-01-01T09:00:00Z", base), "3 h ago");
});

test("StatusBadge and QualityTag render operational labels", () => {
  const statusHtml = renderToStaticMarkup(createElement(StatusBadge, { status: "RUN" }));
  const qualityHtml = renderToStaticMarkup(createElement(QualityTag, { quality: "ESTIMATED_FALLBACK" }));
  assert.match(statusHtml, /RUN/);
  assert.match(qualityHtml, /ESTIMATED/);
});