import { test } from "node:test";
import { deepStrictEqual, equal, match } from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ReportFilterExample from "../src/components/ReportFilterExample";
import {
  selectReportReadings,
  type ReportFilter,
} from "../src/lib/report-selection";
import { summarizeReadings } from "../src/lib/report-summary";

const filter: ReportFilter = {
  ahuId: "AHU-01",
  source: "SIMULATION", parameter: "roomTemp",
  start: "2026-01-01T09:00:00.000Z",
  end: "2026-01-01T12:00:00.000Z",
};

const rows = [
  {
    ahuId: "AHU-01",
    source: "SIMULATION", parameter: "roomTemp",
    measuredAt: "2026-01-01T09:00:00.000Z",
    value: 20,
    quality: "VALID",
  },
  {
    ahuId: "AHU-01",
    source: "SIMULATION", parameter: "roomTemp",
    measuredAt: "2026-01-01T10:00:00.000Z",
    value: 22,
    quality: "VALID",
  },
  {
    ahuId: "AHU-01",
    source: "SIMULATION", parameter: "roomTemp",
    measuredAt: "2026-01-01T11:00:00.000Z",
    value: null,
    quality: "MISSING",
  },
  {
    ahuId: "AHU-01",
    source: "SIMULATION", parameter: "roomTemp",
    measuredAt: "2026-01-01T11:30:00.000Z",
    value: 25,
    quality: "ESTIMATED",
  },
  {
    ahuId: "AHU-01",
    source: "SIMULATION", parameter: "roomTemp",
    measuredAt: "2026-01-01T11:45:00.000Z",
    value: NaN,
    quality: "VALID",
  },
  {
    ahuId: "AHU-01",
    source: "SIMULATION", parameter: "roomTemp",
    measuredAt: "2026-01-01T12:00:00.000Z",
    value: 24,
    quality: "VALID",
  },
  {
    ahuId: "AHU-02",
    source: "SIMULATION", parameter: "roomTemp",
    measuredAt: "2026-01-01T10:00:00.000Z",
    value: 99,
    quality: "VALID",
  },
  {
    ahuId: "AHU-01",
    source: "PHYSICAL", parameter: "roomTemp",
    measuredAt: "2026-01-01T10:00:00.000Z",
    value: 98,
    quality: "VALID",
  },
];

test("filters AHU, source and time before summary", () => {
  const result = selectReportReadings(rows, filter);

  if (result.ok === false) {
    throw new Error(result.error);
  }

  deepStrictEqual(result, {
    ok: true,
    values: [20, 22],
    matched: 5,
    excluded: 3,
  });

  deepStrictEqual(summarizeReadings(result.values), {
    count: 2,
    min: 20,
    max: 22,
    average: 21,
  });
});

test("can select physical source without simulated rows", () => {
  const result = selectReportReadings(rows, {
    ...filter,
    source: "PHYSICAL", parameter: "roomTemp",
  });

  deepStrictEqual(result, {
    ok: true,
    values: [98],
    matched: 1,
    excluded: 0,
  });
});

test("empty selections stay empty", () => {
  deepStrictEqual(selectReportReadings([], filter), {
    ok: true,
    values: [],
    matched: 0,
    excluded: 0,
  });
});

test("invalid filters fail rather than producing a report", () => {
  equal(selectReportReadings(rows, { ...filter, ahuId: "OTHER" }).ok, false);
  equal(selectReportReadings(rows, { ...filter, start: filter.end }).ok, false);
  equal(selectReportReadings(rows, { ...filter, start: "2026-01-01" }).ok, false);
});

test("malformed rows and unknown quality fail closed", () => {
  equal(selectReportReadings([null], filter).ok, false);

  equal(
    selectReportReadings([{ ...rows[0], quality: "OTHER" }], filter).ok,
    false,
  );

  equal(
    selectReportReadings([{ ...rows[0], source: "OTHER" }], filter).ok,
    false,
  );

  equal(
    selectReportReadings([{ ...rows[0], measuredAt: "invalid" }], filter).ok,
    false,
  );
});

test("selection does not mutate the input", () => {
  const row = { ...rows[0] };
  const before = { ...row };

  selectReportReadings([row], filter);

  deepStrictEqual(row, before);
});

test("initial filter example is labelled simulated and shows totals", () => {
  const html = renderToStaticMarkup(createElement(ReportFilterExample));

  match(html, /SIMULATED/);
  match(html, /not stored AHU history/i);
  match(html, /start is included; end is excluded/i);
  match(html, />3</);
  match(html, />2</);
  match(html, />20 \/ 24</);
  match(html, />22\.0</);
});

test("a report window of exactly 31 days is allowed", () => {
  const result = selectReportReadings([], {
    ahuId: "AHU-01",
    source: "SIMULATION", parameter: "roomTemp",
    start: "2026-01-01T00:00:00.000Z",
    end: "2026-02-01T00:00:00.000Z",
  });

  deepStrictEqual(result, {
    ok: true,
    values: [],
    matched: 0,
    excluded: 0,
  });
});

test("a report window exceeding 31 days is rejected", () => {
  const result = selectReportReadings([], {
    ahuId: "AHU-01",
    source: "SIMULATION", parameter: "roomTemp",
    start: "2026-01-01T00:00:00.000Z",
    end: "2026-02-01T00:00:00.001Z",
  });

  equal(result.ok, false);
});

test("the end of a 31-day window is excluded", () => {
  const result = selectReportReadings(
    [
      {
        ahuId: "AHU-01",
        source: "SIMULATION", parameter: "roomTemp",
        measuredAt: "2026-01-01T00:00:00.000Z",
        value: 1,
        quality: "VALID",
      },
      {
        ahuId: "AHU-01",
        source: "SIMULATION", parameter: "roomTemp",
        measuredAt: "2026-01-31T23:59:59.999Z",
        value: 2,
        quality: "VALID",
      },
      {
        ahuId: "AHU-01",
        source: "SIMULATION", parameter: "roomTemp",
        measuredAt: "2026-02-01T00:00:00.000Z",
        value: 3,
        quality: "VALID",
      },
    ],
    {
      ahuId: "AHU-01",
      source: "SIMULATION", parameter: "roomTemp",
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-02-01T00:00:00.000Z",
    },
  );

  deepStrictEqual(result, {
    ok: true,
    values: [1, 2],
    matched: 2,
    excluded: 0,
  });
});

test("different sensor parameters are not combined", () => {
  const readings = [
    { ...rows[0], parameter: "roomTemp", value: 20 },
    { ...rows[0], parameter: "humidity", value: 50 },
    { ...rows[0], parameter: "supplyTemp", value: 19 },
  ];

  deepStrictEqual(selectReportReadings(readings, filter), {
    ok: true,
    values: [20],
    matched: 1,
    excluded: 0,
  });

  deepStrictEqual(
    selectReportReadings(readings, {
      ...filter,
      parameter: "humidity",
    }),
    {
      ok: true,
      values: [50],
      matched: 1,
      excluded: 0,
    },
  );
});

test("missing or unknown requested parameters are rejected", () => {
  const { parameter, ...withoutParameter } = filter;

  equal(
    selectReportReadings(
      rows,
      withoutParameter as unknown as ReportFilter,
    ).ok,
    false,
  );

  equal(
    selectReportReadings(rows, {
      ...filter,
      parameter: "unknown",
    } as unknown as ReportFilter).ok,
    false,
  );
});

test("missing or unknown reading parameters are rejected", () => {
  equal(
    selectReportReadings(
      [{ ...rows[0], parameter: undefined }],
      filter,
    ).ok,
    false,
  );

  equal(
    selectReportReadings(
      [{ ...rows[0], parameter: "unknown" }],
      filter,
    ).ok,
    false,
  );
});