import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  exampleAlarmReducer as reduce,
  initialExampleAlarmState as initial,
} from "../src/lib/fictional-alarm";

test("high must persist for the full fictional delay", () => {
  let s = reduce(initial(), {
    type: "condition",
    value: "HIGH",
  });

  s = reduce(s, { type: "advance" });
  assert.equal(s.alarms.length, 0);

  s = reduce(s, { type: "advance" });
  assert.equal(s.alarms.length, 1);
  assert.equal(s.alarms[0].activatedAt, 20);

  s = reduce(s, { type: "advance" });
  assert.equal(s.alarms.length, 1);
});

test("unknown cancels a pending delay and the next high starts again", () => {
  let s = reduce(initial(), {
    type: "condition",
    value: "HIGH",
  });

  s = reduce(s, { type: "advance" });
  s = reduce(s, { type: "condition", value: "UNKNOWN" });
  s = reduce(s, { type: "advance" });
  s = reduce(s, { type: "condition", value: "HIGH" });
  s = reduce(s, { type: "advance" });

  assert.equal(s.alarms.length, 0);

  s = reduce(s, { type: "advance" });
  assert.equal(s.alarms[0].activatedAt, 40);
});

test("acknowledgment and recovery are independent; unknown does not resolve", () => {
  let s = reduce(initial(), {
    type: "condition",
    value: "HIGH",
  });

  s = reduce(reduce(s, { type: "advance" }), {
    type: "advance",
  });

  s = reduce(s, { type: "acknowledge", id: 1 });
  assert.equal(s.alarms[0].acknowledgedAt, 20);
  assert.equal(s.alarms[0].resolvedAt, null);

  s = reduce(s, { type: "condition", value: "UNKNOWN" });
  assert.equal(s.alarms[0].resolvedAt, null);

  s = reduce(s, { type: "condition", value: "NORMAL" });
  assert.equal(s.alarms[0].resolvedAt, 20);

  s = reduce(s, { type: "advance" });
  s = reduce(s, { type: "acknowledge", id: 1 });
  assert.equal(s.alarms[0].acknowledgedAt, 20);
});

test("a later recurrence creates a new example and history is bounded", () => {
  let s = initial();

  for (let i = 0; i < 12; i++) {
    s = reduce(s, { type: "condition", value: "HIGH" });
    s = reduce(reduce(s, { type: "advance" }), {
      type: "advance",
    });
    s = reduce(s, { type: "condition", value: "NORMAL" });
  }

  assert.equal(s.alarms.length, 10);
  assert.equal(s.alarms[0].id, 12);
  assert.equal(s.alarms[9].id, 3);

  assert.deepEqual(
    reduce(s, { type: "reset" }),
    initial(),
  );
});