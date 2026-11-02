import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  readLatestObservations,
  type LatestObservation,
} from "../src/db/latest-observations";

test("latest observation query uses configured sources in a local database", async (t) => {
  const db = new PGlite();

  try {
    await db.exec(`
      CREATE SCHEMA ahu_private;
      CREATE TYPE ahu_private.data_source AS ENUM ('PHYSICAL', 'SIMULATION');

      CREATE TABLE ahu_private.ahus (
        id text PRIMARY KEY,
        installed_sensors text[] NOT NULL
      );

      CREATE TABLE ahu_private.devices (
        ahu_id text NOT NULL,
        source_type ahu_private.data_source NOT NULL,
        enabled boolean NOT NULL
      );

      CREATE TABLE ahu_private.telemetry (
        id bigint PRIMARY KEY,
        ahu_id text NOT NULL,
        timestamp timestamptz NOT NULL,
        source ahu_private.data_source NOT NULL,
        room_temp real,
        humidity real
      );

      INSERT INTO ahu_private.ahus VALUES
        ('AHU-01', ARRAY['roomTemp','humidity']),
        ('AHU-02', ARRAY['roomTemp','humidity']),
        ('AHU-03', ARRAY['roomTemp','humidity']),
        ('AHU-04', ARRAY['roomTemp', NULL]),
        ('AHU-05', ARRAY['roomTemp','humidity']),
        ('AHU-06', ARRAY['roomTemp','humidity']),
        ('OTHER-01', ARRAY['roomTemp','humidity']);

      INSERT INTO ahu_private.devices VALUES
        ('AHU-01', 'PHYSICAL', true),
        ('AHU-01', 'SIMULATION', true),
        ('AHU-02', 'SIMULATION', true),
        ('AHU-03', 'SIMULATION', false),
        ('AHU-04', 'SIMULATION', true),
        ('AHU-05', 'PHYSICAL', true),
        ('AHU-05', 'SIMULATION', true),
        ('AHU-06', 'PHYSICAL', true),
        ('OTHER-01', 'PHYSICAL', true);

      INSERT INTO ahu_private.telemetry VALUES
        (1, 'AHU-01', '2026-01-01T10:00:00Z', 'PHYSICAL', 20, 40),
        (2, 'AHU-01', '2026-01-01T11:00:00Z', 'SIMULATION', 99, 99),
        (3, 'AHU-02', '2026-01-01T10:00:00Z', 'SIMULATION', 22, 50),
        (4, 'AHU-03', '2026-01-01T10:00:00Z', 'SIMULATION', 23, 51),
        (5, 'AHU-04', '2026-01-01T10:00:00Z', 'SIMULATION', 24, 52),
        (6, 'AHU-05', '2026-01-01T10:00:00Z', 'SIMULATION', 25, 53),
        (7, 'AHU-06', '2026-01-01T10:00:00Z', 'PHYSICAL', 26, 54),
        (8, 'AHU-06', '2026-01-01T10:00:00Z', 'PHYSICAL', 27, 55),
        (9, 'OTHER-01', '2026-01-01T10:00:00Z', 'PHYSICAL', 28, 56);
    `);

    const rows = await readLatestObservations((text, values) =>
      db.query<LatestObservation>(text, values),
    );

    const byId = new Map(rows.map((row) => [row.ahu_id, row]));

    await t.test("physical is selected over newer simulation", () => {
      const row = byId.get("AHU-01");
      equal(row?.configured_source, "PHYSICAL");
      equal(row?.observed_source, "PHYSICAL");
      equal(row?.room_temp, 20);
      equal(row?.measured_at?.toISOString(), "2026-01-01T10:00:00.000Z");
    });

    await t.test("enabled simulation is selected when no physical source is enabled", () => {
      const row = byId.get("AHU-02");
      equal(row?.configured_source, "SIMULATION");
      equal(row?.observed_source, "SIMULATION");
      equal(row?.room_temp, 22);
    });

    await t.test("no enabled source does not return old simulation", () => {
      const row = byId.get("AHU-03");
      equal(row?.configured_source, null);
      equal(row?.observed_source, null);
      equal(row?.room_temp, null);
    });

    await t.test("unconfigured sensor values are not returned", () => {
      const row = byId.get("AHU-04");
      equal(row?.room_temp_installed, true);
      equal(row?.room_temp, 24);
      equal(row?.humidity_installed, false);
      equal(row?.humidity, null);
    });

    await t.test("missing physical data never falls back to simulation", () => {
      const row = byId.get("AHU-05");
      equal(row?.configured_source, "PHYSICAL");
      equal(row?.observed_source, null);
      equal(row?.room_temp, null);
    });

    await t.test("equal timestamps use the larger telemetry ID", () => {
      const row = byId.get("AHU-06");
      equal(row?.room_temp, 27);
      equal(row?.humidity, 55);
    });

    await t.test("unknown units are not returned", () => {
      deepStrictEqual(
        rows.map((row) => row.ahu_id),
        ["AHU-01", "AHU-02", "AHU-03", "AHU-04", "AHU-05", "AHU-06"],
      );
    });

    await t.test("query errors propagate", async () => {
      let failed = false;

      try {
        await readLatestObservations(async () => {
          throw new Error("query failed");
        });
      } catch {
        failed = true;
      }

      equal(failed, true);
    });
  } finally {
    await db.close();
  }
});