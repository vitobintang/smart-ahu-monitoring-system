import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

import { authorizeRequest } from "../src/lib/authorized-request";
import type { ClaimQuery } from "../src/lib/device-claims";
import { isBrowserAuthorized } from "../src/lib/device-verification";
import {
  readMonitoringUnits,
  type MonitoringUnit,
} from "../src/db/monitoring";
import { buildMonitoringResponse } from "../src/lib/monitoring-response";

test("monitoring checks work together in a local database", async (t) => {
  const db = new PGlite();

  // This is a fictional test key, not a real browser token.
  const browserToken = "b".repeat(64);
  const browserHash = createHash("sha256")
    .update(browserToken, "utf8")
    .digest("hex");

  try {
    // Simplified temporary tables: no live data or migrations are used.
    await db.exec(`
      CREATE SCHEMA ahu_private;

      CREATE TABLE ahu_private.users (
        id text PRIMARY KEY,
        role text NOT NULL
      );

      CREATE TABLE ahu_private.access_devices (
        id text PRIMARY KEY,
        user_id text NOT NULL,
        device_hash text,
        claimed_at timestamptz,
        revoked_at timestamptz,
        expires_at timestamptz
      );

      CREATE TABLE ahu_private.ahus (
        id text PRIMARY KEY,
        name text NOT NULL,
        location text NOT NULL
      );

      INSERT INTO ahu_private.users (id, role)
        VALUES ('u1', 'Viewer'), ('u2', 'Viewer');

      INSERT INTO ahu_private.ahus (id, name, location)
        VALUES
          ('AHU-07', 'Unit 7', 'West'),
          ('AHU-01', 'Unit 1', 'East'),
          ('BOILER-99', 'Boiler', 'Other');
    `);

    await db.query(
      `INSERT INTO ahu_private.access_devices
        (id, user_id, device_hash, claimed_at, revoked_at, expires_at)
       VALUES ('d1', 'u1', $1, now(), NULL, now() + interval '1 day')`,
      [browserHash],
    );

    const deviceQuery: ClaimQuery = (text, values) =>
      db.query<{ id: string }>(text, values);

    async function request(
      identity: string | null,
      token: string,
      permission: unknown = "monitoring:read",
      options: { failDevice?: boolean; failUnits?: boolean } = {},
    ) {
      let profileCalls = 0;
      let unitCalls = 0;

      const response = await buildMonitoringResponse({
        authorize: () =>
          authorizeRequest(
            {
              // Supabase identity verification is mocked in this test.
              getVerifiedUser: async () =>
                identity ? { id: identity } : null,

              getProfile: async (id) => {
                profileCalls++;

                const result = await db.query<{ id: string; role: string }>(
                  `SELECT id, role
                   FROM ahu_private.users
                   WHERE id = $1
                   LIMIT 1`,
                  [id],
                );

                return result.rows[0] ?? null;
              },

              isBrowserAuthorized: (id, value) => {
                if (options.failDevice) {
                  return Promise.reject(new Error("device query error"));
                }

                return isBrowserAuthorized(deviceQuery, id, value);
              },
            },
            token,
            permission,
          ),

        loadUnits: async () => {
          unitCalls++;

          if (options.failUnits) {
            throw new Error("private database details");
          }

          return readMonitoringUnits((text, values) =>
            db.query<MonitoringUnit>(text, values),
          );
        },
      });

      return { response, profileCalls, unitCalls };
    }

    await t.test(
      "matching user and browser receive only unit metadata",
      async () => {
        const { response, unitCalls } = await request("u1", browserToken);

        equal(response.status, 200);
        equal(response.headers.get("cache-control"), "no-store");
        equal(unitCalls, 1);

        const body = await response.json();

        deepStrictEqual(body, {
          units: [
            { id: "AHU-01", name: "Unit 1", location: "East" },
            { id: "AHU-07", name: "Unit 7", location: "West" },
          ],
        });
        equal(JSON.stringify(body).includes(browserToken), false);
      },
    );

    await t.test("another user cannot use the browser key", async () => {
      const { response, unitCalls } = await request("u2", browserToken);

      equal(response.status, 401);
      equal(unitCalls, 0);
    });

    await t.test("malformed browser keys do not load units", async () => {
      const { response, unitCalls } = await request("u1", "not-a-key");

      equal(response.status, 401);
      equal(unitCalls, 0);
    });

    await t.test(
      "revoked or expired browser keys do not load units",
      async () => {
        await db.exec(`
          UPDATE ahu_private.access_devices
          SET revoked_at = now()
          WHERE id = 'd1'
        `);

        let result = await request("u1", browserToken);
        equal(result.response.status, 401);
        equal(result.unitCalls, 0);

        await db.exec(`
          UPDATE ahu_private.access_devices
          SET revoked_at = NULL, expires_at = now() - interval '1 second'
          WHERE id = 'd1'
        `);

        result = await request("u1", browserToken);
        equal(result.response.status, 401);
        equal(result.unitCalls, 0);

        await db.exec(`
          UPDATE ahu_private.access_devices
          SET expires_at = now() + interval '1 day'
          WHERE id = 'd1'
        `);
      },
    );

    await t.test("unknown permissions do not load units", async () => {
      const { response, unitCalls } = await request(
        "u1",
        browserToken,
        "not-a-permission",
      );

      equal(response.status, 401);
      equal(unitCalls, 0);
    });

    await t.test(
      "missing verified identity does not read a profile or units",
      async () => {
        const { response, profileCalls, unitCalls } = await request(
          null,
          browserToken,
        );

        equal(response.status, 401);
        equal(profileCalls, 0);
        equal(unitCalls, 0);
      },
    );

    await t.test("browser-verification errors fail closed", async () => {
      const { response, unitCalls } = await request(
        "u1",
        browserToken,
        "monitoring:read",
        { failDevice: true },
      );

      equal(response.status, 401);
      equal(unitCalls, 0);
    });

    await t.test(
      "a unit-query error returns a generic unavailable response",
      async () => {
        const { response } = await request(
          "u1",
          browserToken,
          "monitoring:read",
          { failUnits: true },
        );

        equal(response.status, 503);
        equal(response.headers.get("cache-control"), "no-store");
        deepStrictEqual(await response.json(), {
          error: "Monitoring unavailable",
        });
      },
    );
  } finally {
    await db.close();
  }
});