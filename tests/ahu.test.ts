import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";

import {
  AHU_IDS,
  AHU_STATUSES,
  DATA_SOURCES,
  SENSOR_PARAMETERS,
  USER_ROLES,
} from "../src/lib/ahu";

test("there are seven unique AHU identifiers", () => {
  equal(AHU_IDS.length, 7);
  equal(new Set(AHU_IDS).size, 7);
});

test("there are twelve unique sensor types", () => {
  equal(SENSOR_PARAMETERS.length, 12);

  const keys = SENSOR_PARAMETERS.map((sensor) => sensor.key);
  equal(new Set(keys).size, 12);
});

test("the required AHU statuses and data sources are defined", () => {
  deepStrictEqual(AHU_STATUSES, ["RUN", "STOP", "FAULT", "OFFLINE"]);
  deepStrictEqual(DATA_SOURCES, ["PHYSICAL", "SIMULATION"]);
});

test("the four user roles are defined", () => {
  deepStrictEqual(USER_ROLES, ["Admin", "Engineering", "Operator", "Viewer"]);
});