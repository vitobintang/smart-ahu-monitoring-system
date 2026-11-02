import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

import {
  readMonitoringUnits,
  type MonitoringUnit,
} from "../src/db/monitoring";
import { buildMonitoringResponse } from "../src/lib/monitoring-response";

const user = { id: "user-1", role: "Viewer" as const };

const units: MonitoringUnit[] = [
  { id: "AHU-01", name: "Unit 1", location: "Example" },
];

test("unauthorized requests do not load units", async () => {
  let loads = 0;

  const response = await buildMonitoringResponse({
    authorize: async () => null,
    loadUnits: async () => {
      loads++;
      return units;
    },
  });

  equal(response.status, 401);
  equal(response.headers.get("cache-control"), "no-store");
  equal(loads, 0);
  deepStrictEqual(await response.json(), { error: "Not authenticated" });
});

test("authorized requests return units without caching", async () => {
  const response = await buildMonitoringResponse({
    authorize: async () => user,
    loadUnits: async () => units,
  });

  equal(response.status, 200);
  equal(response.headers.get("cache-control"), "no-store");
  deepStrictEqual(await response.json(), { units });
});

test("an empty database returns an empty list", async () => {
  const response = await buildMonitoringResponse({
    authorize: async () => user,
    loadUnits: async () => [],
  });

  deepStrictEqual(await response.json(), { units: [] });
});

test("authorization errors never load data", async () => {
  let loads = 0;

  const response = await buildMonitoringResponse({
    authorize: async () => {
      throw new Error("private auth detail");
    },
    loadUnits: async () => {
      loads++;
      return units;
    },
  });

  equal(response.status, 503);
  equal(response.headers.get("cache-control"), "no-store");
  equal(loads, 0);
  deepStrictEqual(await response.json(), {
    error: "Monitoring unavailable",
  });
});

test("database errors are generic and not cached", async () => {
  const response = await buildMonitoringResponse({
    authorize: async () => user,
    loadUnits: async () => {
      throw new Error("database details");
    },
  });

  equal(response.status, 503);
  equal(response.headers.get("cache-control"), "no-store");
  deepStrictEqual(await response.json(), {
    error: "Monitoring unavailable",
  });
});

test("query selects only known units and metadata in a local database", async () => {
  const db = new PGlite();

  try {
    await db.exec(`
      CREATE SCHEMA ahu_private;
      CREATE TABLE ahu_private.ahus (
        id text PRIMARY KEY,
        name text NOT NULL,
        location text NOT NULL
      );
    `);

    await db.query(
      `INSERT INTO ahu_private.ahus (id, name, location)
       VALUES ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)`,
      [
        "AHU-07", "Unit 7", "West",
        "BOILER-99", "Boiler", "Other",
        "AHU-01", "Unit 1", "East",
      ],
    );

    const result = await readMonitoringUnits((text, values) =>
      db.query<MonitoringUnit>(text, values),
    );

    deepStrictEqual(result, [
      { id: "AHU-01", name: "Unit 1", location: "East" },
      { id: "AHU-07", name: "Unit 7", location: "West" },
    ]);
  } finally {
    await db.close();
  }
});

test("query errors are not converted into an empty result", async () => {
  let failed = false;

  try {
    await readMonitoringUnits(async () => {
      throw new Error("query failed");
    });
  } catch {
    failed = true;
  }

  equal(failed, true);
});