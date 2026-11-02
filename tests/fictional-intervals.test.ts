import { test } from "node:test";
import { strict as assert } from "node:assert";

import { summarizeFictionalIntervals } from "../src/lib/fictional-intervals";
import type { ReportTimelinePoint } from "../src/lib/report-selection";

const start = "2026-01-01T09:00:00.000Z";
const end = "2026-01-01T12:30:00.000Z";

const points: ReportTimelinePoint[] = [
  { measuredAt: start, value: 20, exclusion: null },
  {
    measuredAt: "2026-01-01T09:15:00.000Z",
    value: 22,
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

test("hourly intervals preserve included, excluded and empty examples", () => {
  const result = summarizeFictionalIntervals(points, start, end);
  assert.ok(result);

  assert.equal(result.length, 4);
  assert.deepEqual(result[0], {
    start,
    end: "2026-01-01T10:00:00.000Z",
    summary: { count: 2, min: 20, max: 22, average: 21 },
    excluded: 0,
  });
  assert.equal(result[1].summary, null);
  assert.equal(result[1].excluded, 1);
  assert.equal(result[2].summary, null);
  assert.equal(result[2].excluded, 1);
  assert.equal(result[3].summary, null);
  assert.equal(result[3].excluded, 0);
  assert.equal(result[3].end, end);
});

test("the start is included and a timestamp at the end is rejected", () => {
  const valid = summarizeFictionalIntervals([points[0]], start, end);
  assert.ok(valid);
  assert.equal(valid[0].summary?.min, 20);

  assert.equal(
    summarizeFictionalIntervals(
      [{ measuredAt: end, value: 1, exclusion: null }],
      start,
      end,
    ),
    null,
  );
});

test("accepts 31 days but rejects longer or malformed windows", () => {
  assert.equal(
    summarizeFictionalIntervals([], start, "2026-02-01T09:00:00.000Z")
      ?.length,
    744,
  );
  assert.equal(
    summarizeFictionalIntervals([], start, "2026-02-01T09:00:00.001Z"),
    null,
  );
  assert.equal(summarizeFictionalIntervals([], start, start), null);
  assert.equal(summarizeFictionalIntervals([], "invalid", end), null);
});

test("invalid values and inconsistent exclusions fail closed", () => {
  assert.equal(
    summarizeFictionalIntervals(
      [{ measuredAt: start, value: NaN, exclusion: null }],
      start,
      end,
    ),
    null,
  );
  assert.equal(
    summarizeFictionalIntervals(
      [{ measuredAt: start, value: 26, exclusion: "ESTIMATED" }],
      start,
      end,
    ),
    null,
  );
  assert.equal(
    summarizeFictionalIntervals(
      [{ measuredAt: "bad", value: 1, exclusion: null }],
      start,
      end,
    ),
    null,
  );
  assert.equal(
    summarizeFictionalIntervals(Array(101).fill(points[0]), start, end),
    null,
  );
});

test("summaries support zero and large opposite example values", () => {
  const result = summarizeFictionalIntervals(
    [
      { measuredAt: start, value: 1e308, exclusion: null },
      { measuredAt: start, value: -1e308, exclusion: null },
      { measuredAt: start, value: 0, exclusion: null },
    ],
    start,
    end,
  );

  assert.ok(result);
  assert.equal(result[0].summary?.count, 3);
  assert.equal(result[0].summary?.average, 0);
});