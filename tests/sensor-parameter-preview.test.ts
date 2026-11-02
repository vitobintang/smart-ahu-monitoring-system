import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";

import { SENSOR_PARAMETERS } from "../src/lib/ahu";
import SensorParameterPreview from "../src/components/SensorParameterPreview";

test("planned sensor types are grouped once with their preliminary units", () => {
  const html = renderToStaticMarkup(createElement(SensorParameterPreview));
  const dom = new JSDOM(html);

  try {
    const doc = dom.window.document;

    const labels = Array.from(doc.querySelectorAll("dt"), (node) =>
      node.textContent?.replace(/\s+/g, " ").trim(),
    );

    assert.equal(labels.length, SENSOR_PARAMETERS.length);
    assert.equal(new Set(labels).size, SENSOR_PARAMETERS.length);

    for (const sensor of SENSOR_PARAMETERS) {
      assert.equal(
        labels.filter(
          (label) => label === `${sensor.label} (${sensor.unit})`,
        ).length,
        1,
      );
    }

    assert.deepEqual(
      Array.from(doc.querySelectorAll("h3"), (node) => node.textContent),
      ["Temperature", "Air and equipment", "Electrical and operation"],
    );
  } finally {
    dom.window.close();
  }
});

test("all readings and installations remain unknown; no controls are shown", () => {
  const html = renderToStaticMarkup(createElement(SensorParameterPreview));
  const dom = new JSDOM(html);

  try {
    const doc = dom.window.document;

    assert.match(doc.body.textContent ?? "", /Units are preliminary/);
    assert.match(
      doc.body.textContent ?? "",
      /does not display the historical observations/,
    );

    const readings = doc.querySelectorAll("dd");

    assert.equal(readings.length, SENSOR_PARAMETERS.length);

    for (const reading of readings) {
      assert.match(reading.textContent ?? "", /Unavailable/);
      assert.match(reading.textContent ?? "", /Installation unknown/);
    }

    assert.equal(
      doc.querySelectorAll("button, input, select, textarea, a").length,
      0,
    );
  } finally {
    dom.window.close();
  }
});