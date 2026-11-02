import { test } from "node:test";
import {
  deepStrictEqual,
  equal,
  match,
  doesNotMatch,
} from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  selectReportReadings,
  selectReportTimeline,
  type ReportFilter,
} from "../src/lib/report-selection";
import ReportTrendExample from "../src/components/ReportTrendExample";

const filter: ReportFilter = {
  ahuId: "AHU-01",
  source: "SIMULATION",
  parameter: "roomTemp",
  start: "2026-01-01T09:00:00.000Z",
  end: "2026-01-01T15:00:00.000Z",
};

const base = {
  ahuId: "AHU-01",
  source: "SIMULATION",
  parameter: "roomTemp",
};

const rows = [
  {
    ...base,
    measuredAt: "2026-01-01T12:00:00.000Z",
    quality: "VALID",
    value: 24,
  },
  {
    ...base,
    measuredAt: "2026-01-01T11:00:00.000Z",
    quality: "MISSING",
    value: null,
  },
  {
    ...base,
    measuredAt: "2026-01-01T10:00:00.000Z",
    quality: "ESTIMATED",
    value: 26,
  },
  {
    ...base,
    measuredAt: "2026-01-01T09:00:00.000Z",
    quality: "VALID",
    value: 20,
  },
  {
    ...base,
    measuredAt: "2026-01-01T15:00:00.000Z",
    quality: "VALID",
    value: 99,
  },
  {
    ...base,
    parameter: "humidity",
    measuredAt: "2026-01-01T09:30:00.000Z",
    quality: "VALID",
    value: 50,
  },
];

test("timeline sorts matching readings and keeps excluded values out of the chart", () => {
  const result = selectReportTimeline(rows, filter);

  if (result.ok === false) throw new Error(result.error);

  deepStrictEqual(result, {
    ok: true,
    values: [24, 20],
    matched: 4,
    excluded: 2,
    points: [
      {
        measuredAt: "2026-01-01T09:00:00.000Z",
        value: 20,
        exclusion: null,
      },
      {
        measuredAt: "2026-01-01T10:00:00.000Z",
        value: null,
        exclusion: "ESTIMATED",
      },
      {
        measuredAt: "2026-01-01T11:00:00.000Z",
        value: null,
        exclusion: "MISSING",
      },
      {
        measuredAt: "2026-01-01T12:00:00.000Z",
        value: 24,
        exclusion: null,
      },
    ],
  });

  deepStrictEqual(selectReportReadings(rows, filter), {
    ok: true,
    values: [24, 20],
    matched: 4,
    excluded: 2,
  });
});

test("unavailable values produce gaps and invalid parameters fail closed", () => {
  const result = selectReportTimeline(
    [
      {
        ...base,
        measuredAt: "2026-01-01T09:00:00.000Z",
        quality: "VALID",
        value: NaN,
      },
    ],
    filter,
  );

  if (result.ok === false) throw new Error(result.error);

  deepStrictEqual(result.points, [
    {
      measuredAt: "2026-01-01T09:00:00.000Z",
      value: null,
      exclusion: "UNAVAILABLE",
    },
  ]);

  equal(
    selectReportTimeline([{ ...rows[0], parameter: "bad" }], filter).ok,
    false,
  );
});

test("chart labels fictional readings and plots only included dots", () => {
  const result = selectReportTimeline(rows, filter);

  if (result.ok === false) throw new Error(result.error);

  const html = renderToStaticMarkup(
    createElement(ReportTrendExample, {
      points: result.points,
      start: filter.start,
      end: filter.end,
    }),
  );

  match(html, /SIMULATED/);
  match(html, /Fictional data only/);
  match(html, /ESTIMATED · excluded/);
  match(html, /MISSING · excluded/);
  equal((html.match(/<circle\b/g) ?? []).length, 2);
  doesNotMatch(html, /<polyline\b|<path\b/);
  doesNotMatch(html, />26<|>99</);
});

test("chart displays an empty state without pretending data exists", () => {
  const html = renderToStaticMarkup(
    createElement(ReportTrendExample, {
      points: [],
      start: filter.start,
      end: filter.end,
    }),
  );

  match(html, /No included example readings to plot/);
  match(html, /No fictional readings match/);
  doesNotMatch(html, /<circle\b/);
});