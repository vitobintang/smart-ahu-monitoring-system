import { test } from "node:test";
import { strict as assert } from "node:assert";

import { buildFictionalReportCsv } from "../src/lib/fictional-report-csv";
import type { ReportTimelinePoint } from "../src/lib/report-selection";

const base = {
  ahuId: "AHU-01" as const,
  start: "2026-01-01T09:00:00.000Z",
  end: "2026-01-01T12:00:00.000Z",
};

const points: ReportTimelinePoint[] = [
  {
    measuredAt: "2026-01-01T09:00:00.000Z",
    value: 20,
    exclusion: null,
  },
  {
    measuredAt: "2026-01-01T10:00:00.000Z",
    value: null,
    exclusion: "MISSING",
  },
  {
    measuredAt: "2026-01-01T11:00:00.000Z",
    value: null,
    exclusion: "ESTIMATED",
  },
];

test("fictional CSV includes context and leaves excluded values blank", () => {
  const csv = buildFictionalReportCsv({ ...base, points });
  assert.ok(csv);

  assert.match(csv, /"Notice","FICTIONAL EXAMPLE - NOT REAL AHU DATA"/);
  assert.match(csv, /"Example AHU","AHU-01"/);
  assert.match(csv, /"Source","SIMULATION"/);
  assert.match(
    csv,
    /"Start UTC \(inclusive\)","2026-01-01T09:00:00\.000Z"/,
  );
  assert.match(
    csv,
    /"End UTC \(exclusive\)","2026-01-01T12:00:00\.000Z"/,
  );
  assert.match(
    csv,
    /"2026-01-01T09:00:00\.000Z","20","INCLUDED"/,
  );
  assert.match(
    csv,
    /"2026-01-01T10:00:00\.000Z","","MISSING - EXCLUDED"/,
  );
  assert.match(
    csv,
    /"2026-01-01T11:00:00\.000Z","","ESTIMATED - EXCLUDED"/,
  );
  assert.ok(csv.endsWith("\r\n"));
});

test("an empty selection retains the fictional context and headers", () => {
  const csv = buildFictionalReportCsv({ ...base, points: [] });
  assert.ok(csv);

  assert.match(csv, /FICTIONAL EXAMPLE/);
  assert.match(csv, /"Measured at UTC","Example value","Selection"/);
});

test("invalid windows, out-of-window points and invalid input fail closed", () => {
  assert.equal(
    buildFictionalReportCsv({
      ...base,
      ahuId: "=BAD" as "AHU-01",
      points,
    }),
    null,
  );

  assert.equal(
    buildFictionalReportCsv({ ...base, start: "=BAD", points }),
    null,
  );

  assert.equal(
    buildFictionalReportCsv({ ...base, end: base.start, points }),
    null,
  );

  assert.ok(
    buildFictionalReportCsv({
      ...base,
      end: "2026-02-01T09:00:00.000Z",
      points,
    }),
  );

  assert.equal(
    buildFictionalReportCsv({
      ...base,
      end: "2026-02-02T09:00:00.000Z",
      points,
    }),
    null,
  );

  assert.equal(
    buildFictionalReportCsv({
      ...base,
      points: [{ measuredAt: base.end, value: 1, exclusion: null }],
    }),
    null,
  );

  assert.equal(
    buildFictionalReportCsv({
      ...base,
      points: [{ measuredAt: base.start, value: Infinity, exclusion: null }],
    }),
    null,
  );

  assert.equal(
    buildFictionalReportCsv({
      ...base,
      points: [
        { measuredAt: base.start, value: 26, exclusion: "ESTIMATED" },
      ],
    }),
    null,
  );

  assert.equal(
    buildFictionalReportCsv({
      ...base,
      points: Array(101).fill(points[0]),
    }),
    null,
  );
});