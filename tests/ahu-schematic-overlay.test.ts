import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AhuSchematic from "../src/components/AhuSchematic";

const ALL_INSTALLED = [
  "roomTemp",
  "supplyTemp",
  "returnTemp",
  "humidity",
  "filterDiffPressure",
  "fanSpeed",
  "coilTemp",
  "damperPosition",
  "current",
  "voltage",
  "runHours",
  "heaterOutput",
];

test("AhuSchematic realistic overlay aligns horizontal coil serpentine and stage badges", () => {
  const htmlWithHeater = renderToStaticMarkup(
    createElement(AhuSchematic, {
      ahuId: "AHU-01",
      hasHeater: true,
      installed: ALL_INSTALLED,
      status: "RUN",
      values: {
        damperPosition: 72,
        filterDiffPressure: 140,
        coilTemp: 8.2,
        heaterOutput: 40,
        fanSpeed: 78,
        supplyTemp: 15.4,
      },
      fallback: { current: false, voltage: false },
      limits: { filterHigh: 250, coilHigh: 16 },
    }),
  );

  // Horizontal copper-tube serpentine starts above the drain pan (y <= 646, never dipping to y = 650 vertical loops)
  assert.match(htmlWithHeater, /M 884 646 L 884 616/);
  assert.doesNotMatch(htmlWithHeater, /Q 740 650 758 650/);
  // Heater-enabled airflow weaves through the 3 heater bundles
  assert.match(htmlWithHeater, /C 976 450 970 272 998 272/);
  // All 5 interactive numbered hotspot buttons render in Realistic mode
  for (const label of [
    "1 · Intake Damper",
    "2 · Filter Stage",
    "3 · Cooling Coil",
    "4 · Heating Coil",
    "5 · Supply Fan",
  ]) {
    assert.equal(htmlWithHeater.includes(label), true, `Missing stage button: ${label}`);
  }

  const htmlWithoutHeater = renderToStaticMarkup(
    createElement(AhuSchematic, {
      ahuId: "AHU-02",
      hasHeater: false,
      installed: ALL_INSTALLED.filter((k) => k !== "heaterOutput"),
      status: "RUN",
      values: {
        damperPosition: 70,
        filterDiffPressure: 120,
        coilTemp: 8.5,
        fanSpeed: 75,
        supplyTemp: 15.0,
      },
      fallback: { current: false, voltage: false },
      limits: { filterHigh: 250, coilHigh: 16 },
    }),
  );

  // Without a heater, airflow stays straight at y=450 instead of snaking through heater coils
  assert.match(htmlWithoutHeater, /d="M 16 450 L 1425 450"/);
});
