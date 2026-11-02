import { test } from "node:test";
import { strict as assert } from "node:assert";

import { parseSimulatedValue } from "../src/lib/simulated-input";
import { createSimulationSample } from "../src/lib/simulation";

test("parses decimal examples and treats blanks as missing", () => {
  assert.deepEqual(parseSimulatedValue(" 22.5 "), {
    ok: true,
    value: 22.5,
  });
  assert.deepEqual(parseSimulatedValue("-3"), { ok: true, value: -3 });
  assert.deepEqual(parseSimulatedValue(".5"), { ok: true, value: 0.5 });
  assert.deepEqual(parseSimulatedValue("0"), { ok: true, value: 0 });
  assert.deepEqual(parseSimulatedValue(" "), { ok: true, value: null });
});

test("rejects invalid syntax rather than guessing a value", () => {
  for (const value of [
    "1,5",
    "1e2",
    "Infinity",
    "NaN",
    "-",
    "0x12",
    "9".repeat(33),
    null,
    2,
  ]) {
    assert.deepEqual(parseSimulatedValue(value), { ok: false });
  }
});

test("sample generation preserves defaults and accepts custom fictional readings", () => {
  const input = {
    ahuId: "AHU-01",
    messageId: "simulation-example",
    measuredAt: "2026-01-01T10:00:00.000Z",
  };

  const defaults = createSimulationSample(input);

  if (defaults.ok === false) assert.fail(defaults.error);

  assert.equal(defaults.sample.message.readings.roomTemp, 22);
  assert.equal(defaults.sample.message.readings.humidity, 50);

  const custom = createSimulationSample({
    ...input,
    readings: { roomTemp: 19.5, humidity: null },
  });

  if (custom.ok === false) assert.fail(custom.error);

  assert.equal(custom.sample.source, "SIMULATION");
  assert.equal(custom.sample.message.readings.roomTemp, 19.5);
  assert.equal(custom.sample.message.readings.humidity, null);

  assert.equal(
    createSimulationSample({
      ...input,
      readings: { roomTemp: NaN, humidity: 50 },
    }).ok,
    false,
  );
});