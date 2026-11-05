import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

import { authorizeRequest } from "../src/lib/authorized-request";
import type { ClaimQuery } from "../src/lib/device-claims";
import { isBrowserAuthorized } from "../src/lib/device-verification";
import {
  readLatestObservations,
  type LatestObservation,
} from "../src/db/latest-observations";
import { buildObservationResponse } from "../src/lib/observation-response";

test("observation authorization and queries work together locally", async (t) => {
  const db = new PGlite();

  // This fictional test key is not a real browser token.
  const token = "b".repeat(64);
  const hash = createHash("sha256")
    .update(token, "utf8")
    .digest("hex");

  try {
    // Simplified temporary tables; no live database or migrations are used.
    await db.exec(`
      CREATE SCHEMA ahu_private;

      CREATE TYPE ahu_private.data_source AS ENUM (
        'PHYSICAL', 'SIMULATION'
      );

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

      INSERT INTO ahu_private.users VALUES
        ('u1', 'Operator'),
        ('u2', 'Operator');

      INSERT INTO ahu_private.ahus VALUES
        ('AHU-01', ARRAY['roomTemp', 'humidity']),
        ('AHU-02', ARRAY['roomTemp', 'humidity']),
        ('AHU-03', ARRAY['roomTemp']),
        ('AHU-04', ARRAY['roomTemp', 'humidity']),
        ('AHU-05', ARRAY['roomTemp', 'humidity']),
        ('OTHER-01', ARRAY['roomTemp', 'humidity']);

      INSERT INTO ahu_private.devices VALUES
        ('AHU-01', 'PHYSICAL', true),
        ('AHU-01', 'SIMULATION', true),
        ('AHU-02', 'PHYSICAL', true),
        ('AHU-02', 'SIMULATION', true),
        ('AHU-03', 'SIMULATION', true),
        ('AHU-04', 'SIMULATION', false),
        ('AHU-05', 'PHYSICAL', true),
        ('OTHER-01', 'PHYSICAL', true);

      INSERT INTO ahu_private.telemetry VALUES
        (1, 'AHU-01', '2026-01-01T10:00:00Z', 'PHYSICAL', 20, 40),
        (2, 'AHU-01', '2026-01-01T11:00:00Z', 'SIMULATION', 99, 99),
        (3, 'AHU-02', '2026-01-01T10:00:00Z', 'SIMULATION', 25, 50),
        (4, 'AHU-03', '2026-01-01T10:00:00Z', 'SIMULATION', 22, 51),
        (5, 'AHU-04', '2026-01-01T10:00:00Z', 'SIMULATION', 23, 52),
        (6, 'AHU-05', '2026-01-01T12:01:00Z', 'PHYSICAL', 24, 53),
        (7, 'OTHER-01', '2026-01-01T10:00:00Z', 'PHYSICAL', 28, 55);
    `);

    await db.query(
      `INSERT INTO ahu_private.access_devices
        (id, user_id, device_hash, claimed_at, revoked_at, expires_at)
       VALUES ('d1', 'u1', $1, now(), NULL, now() + interval '1 day')`,
      [hash],
    );

    const deviceQuery: ClaimQuery = (text, values) =>
      db.query<{ id: string }>(text, values);

    async function request(
      identity: string | null,
      browserToken: string,
      permission: unknown = "monitoring:read",
      options: {
        failDevice?: boolean;
        failObservations?: boolean;
      } = {},
    ) {
      let profileCalls = 0;
      let observationCalls = 0;

      const response = await buildObservationResponse({
        // Fixed clock for the test, not a real freshness check.
        now: () => Date.parse("2026-01-01T12:00:00.000Z"),

        authorize: () =>
          authorizeRequest(
            {
              // Supabase identity verification is mocked.
              getVerifiedUser: async () =>
                identity ? { id: identity } : null,

              getProfile: async (id) => {
                profileCalls++;

                const result = await db.query<{
                  id: string;
                  role: string;
                }>(
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
                  return Promise.reject(
                    new Error("private device error"),
                  );
                }

                return isBrowserAuthorized(deviceQuery, id, value);
              },
            },
            browserToken,
            permission,
          ),

        loadObservations: async () => {
          observationCalls++;

          if (options.failObservations) {
            throw new Error("private database detail");
          }

          return readLatestObservations((text, values) =>
            db.query<LatestObservation>(text, values),
          );
        },
      });

      return { response, profileCalls, observationCalls };
    }

    await t.test("authorized observations preserve source and timestamp", async () => {
      const { response, observationCalls } = await request("u1", token);

      equal(response.status, 200);
      equal(response.headers.get("cache-control"), "no-store");
      equal(observationCalls, 1);

      const body = await response.json();

      equal(JSON.stringify(body).includes(token), false);
      equal(JSON.stringify(body).includes(hash), false);

      const observations = body.observations;

      deepStrictEqual(
        observations.map((row: { ahuId: string }) => row.ahuId),
        ["AHU-01", "AHU-02", "AHU-03", "AHU-04", "AHU-05"],
      );

      deepStrictEqual(observations[0], {
        ahuId: "AHU-01",
        configuredSource: "PHYSICAL",
        observedSource: "PHYSICAL",
        measuredAt: "2026-01-01T10:00:00.000Z",
        timestampStatus: "past_or_present",
        roomTemp: { configured: true, value: 20 },
        humidity: { configured: true, value: 40 },
      });

      // Missing physical data must not fall back to simulation.
      equal(observations[1].configuredSource, "PHYSICAL");
      equal(observations[1].observedSource, null);
      equal(observations[1].roomTemp.value, null);

      // Unconfigured humidity is not returned.
      equal(observations[2].observedSource, "SIMULATION");
      equal(observations[2].roomTemp.value, 22);
      equal(observations[2].humidity.configured, false);
      equal(observations[2].humidity.value, null);

      // A disabled source does not make old simulation current.
      equal(observations[3].configuredSource, null);
      equal(observations[3].observedSource, null);
      equal(observations[3].roomTemp.value, null);

      // A future timestamp is returned, but its values are withheld.
      equal(observations[4].timestampStatus, "future");
      equal(observations[4].roomTemp.value, null);
      equal(observations[4].humidity.value, null);
    });

    await t.test("another user or malformed token never loads observations", async () => {
      for (const [identity, browserToken] of [
        ["u2", token],
        ["u1", "not-a-key"],
      ]) {
        const result = await request(identity, browserToken);

        equal(result.response.status, 401);
        equal(result.observationCalls, 0);
      }
    });

    await t.test("missing identity and unknown permission never load observations", async () => {
      const missing = await request(null, token);

      equal(missing.response.status, 401);
      equal(missing.profileCalls, 0);
      equal(missing.observationCalls, 0);

      const unknown = await request("u1", token, "unknown-permission");

      equal(unknown.response.status, 401);
      equal(unknown.observationCalls, 0);
    });

    await t.test("revoked and expired browsers never load observations", async () => {
      await db.exec(`
        UPDATE ahu_private.access_devices
        SET revoked_at = now()
        WHERE id = 'd1'
      `);

      let result = await request("u1", token);

      equal(result.response.status, 401);
      equal(result.observationCalls, 0);

      await db.exec(`
        UPDATE ahu_private.access_devices
        SET revoked_at = NULL,
            expires_at = now() - interval '1 second'
        WHERE id = 'd1'
      `);

      result = await request("u1", token);

      equal(result.response.status, 401);
      equal(result.observationCalls, 0);

      await db.exec(`
        UPDATE ahu_private.access_devices
        SET expires_at = now() + interval '1 day'
        WHERE id = 'd1'
      `);
    });

    await t.test("device-verification failures deny access", async () => {
      const result = await request(
        "u1",
        token,
        "monitoring:read",
        { failDevice: true },
      );

      equal(result.response.status, 401);
      equal(result.observationCalls, 0);
    });

    await t.test("observation-query failures return a generic no-store response", async () => {
      const result = await request(
        "u1",
        token,
        "monitoring:read",
        { failObservations: true },
      );

      equal(result.response.status, 503);
      equal(result.response.headers.get("cache-control"), "no-store");

      deepStrictEqual(await result.response.json(), {
        error: "Monitoring unavailable",
      });
    });
  } finally {
    await db.close();
  }
});