import { test } from "node:test";
import {
  deepStrictEqual,
  equal,
  match,
  doesNotMatch,
} from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import SimulatedSampleThresholds, {
  assessSimulatedSample,
} from "../src/components/SimulatedSampleThresholds";
import { createSimulationSample } from "../src/lib/simulation";

function sampleReadings() {
  const result = createSimulationSample({
    ahuId: "GTM-DAIKIN-001",
    messageId: "simulation-test",
    measuredAt: "2026-01-01T10:00:00.000Z",
  });

  if (result.ok === false) {
    throw new Error(result.error);
  }

  return {
    roomTemp: result.sample.message.readings.roomTemp ?? null,
    humidity: result.sample.message.readings.humidity ?? null,
  };
}

test("generated sample is within example range A", () => {
  deepStrictEqual(assessSimulatedSample(sampleReadings(), "A"), {
    temperature: "NORMAL",
    humidity: "NORMAL",
  });
});

test("generated sample is below example range B", () => {
  deepStrictEqual(assessSimulatedSample(sampleReadings(), "B"), {
    temperature: "LOW",
    humidity: "LOW",
  });
});

test("generated sample is above example range C", () => {
  deepStrictEqual(assessSimulatedSample(sampleReadings(), "C"), {
    temperature: "HIGH",
    humidity: "HIGH",
  });
});

test("missing or non-finite simulated readings are unknown", () => {
  deepStrictEqual(
    assessSimulatedSample({ roomTemp: null, humidity: NaN }, "A"),
    { temperature: "UNKNOWN", humidity: "UNKNOWN" },
  );
});

test("the comparison does not change its sample", () => {
  const readings = sampleReadings();
  const before = { ...readings };

  assessSimulatedSample(readings, "A");

  deepStrictEqual(readings, before);
});

test("initial render asks for a sample and warns this is not an alarm", () => {
  const html = renderToStaticMarkup(
    createElement(SimulatedSampleThresholds, {
      hasSample: false,
      roomTemp: null,
      humidity: null,
    }),
  );

  match(html, /Generate a simulated sample/);
  match(html, /not equipment settings/i);
  match(html, /No alarm is created/i);
  doesNotMatch(html, />NORMAL</);
});

test("rendered result comes from the supplied simulated sample", () => {
  const readings = sampleReadings();

  const html = renderToStaticMarkup(
    createElement(SimulatedSampleThresholds, {
      hasSample: true,
      ...readings,
    }),
  );

  equal((html.match(/>NORMAL</g) ?? []).length, 2);
});