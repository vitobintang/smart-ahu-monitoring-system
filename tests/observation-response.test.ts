import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";

import type { LatestObservation } from "../src/db/latest-observations";
import { buildObservationResponse } from "../src/lib/observation-response";

const user = { id: "user-1", role: "Operator" as const };
const now = () => Date.parse("2026-01-01T12:00:00Z");

const row: LatestObservation = {
  ahu_id: "AHU-01",
  configured_source: "PHYSICAL",
  observed_source: "PHYSICAL",
  measured_at: new Date("2026-01-01T10:00:00Z"),
  room_temp_installed: true,
  humidity_installed: true,
  room_temp: 20,
  humidity: 45,
};

const deps = (rows: LatestObservation[]) => ({
  authorize: async () => user,
  loadObservations: async () => rows,
  now,
});

test("denied requests do not query observations", async () => {
  let loads = 0;

  const response = await buildObservationResponse({
    authorize: async () => null,
    loadObservations: async () => {
      loads++;
      return [row];
    },
  });

  equal(response.status, 401);
  equal(response.headers.get("cache-control"), "no-store");
  equal(loads, 0);
  deepStrictEqual(await response.json(), { error: "Not authenticated" });
});

test("authorized response describes a historical measurement", async () => {
  const response = await buildObservationResponse(deps([row]));

  equal(response.status, 200);
  equal(response.headers.get("cache-control"), "no-store");

  deepStrictEqual(await response.json(), {
    observations: [
      {
        ahuId: "AHU-01",
        configuredSource: "PHYSICAL",
        observedSource: "PHYSICAL",
        measuredAt: "2026-01-01T10:00:00.000Z",
        timestampStatus: "past_or_present",
        roomTemp: { configured: true, value: 20 },
        humidity: { configured: true, value: 45 },
      },
    ],
  });
});

test("missing observations stay unknown", async () => {
  const response = await buildObservationResponse(
    deps([
      {
        ...row,
        observed_source: null,
        measured_at: null,
        room_temp: 999,
        humidity: 999,
      },
    ]),
  );

  const { observations } = await response.json();

  equal(observations[0].configuredSource, "PHYSICAL");
  equal(observations[0].observedSource, null);
  equal(observations[0].timestampStatus, "unknown");
  equal(observations[0].roomTemp.value, null);
});

test("future timestamps cannot provide reading values", async () => {
  const response = await buildObservationResponse(
    deps([
      {
        ...row,
        measured_at: new Date("2026-01-01T12:00:01Z"),
      },
    ]),
  );

  const { observations } = await response.json();

  equal(observations[0].timestampStatus, "future");
  equal(observations[0].roomTemp.value, null);
  equal(observations[0].humidity.value, null);
});

test("unconfigured or non-finite values are unavailable", async () => {
  const response = await buildObservationResponse(
    deps([
      {
        ...row,
        room_temp_installed: false,
        room_temp: 123,
        humidity: NaN,
      },
    ]),
  );

  const { observations } = await response.json();

  equal(observations[0].roomTemp.configured, false);
  equal(observations[0].roomTemp.value, null);
  equal(observations[0].humidity.value, null);
});

test("empty observations are allowed", async () => {
  const response = await buildObservationResponse(deps([]));

  deepStrictEqual(await response.json(), { observations: [] });
});

test("invalid sources, duplicate units and invalid dates fail closed", async () => {
  const examples: LatestObservation[][] = [
    [{ ...row, observed_source: "SIMULATION" }],
    [row, row],
    [{ ...row, measured_at: new Date("invalid") }],
    [{ ...row, ahu_id: "OTHER-01" }],
  ];

  for (const example of examples) {
    const response = await buildObservationResponse(deps(example));

    equal(response.status, 503);
    equal(response.headers.get("cache-control"), "no-store");

    deepStrictEqual(await response.json(), {
      error: "Monitoring unavailable",
    });
  }
});

test("authorization errors never query observations", async () => {
  let loads = 0;

  const response = await buildObservationResponse({
    authorize: async () => {
      throw new Error("private auth detail");
    },
    loadObservations: async () => {
      loads++;
      return [row];
    },
  });

  equal(response.status, 503);
  equal(loads, 0);

  deepStrictEqual(await response.json(), {
    error: "Monitoring unavailable",
  });
});

test("database errors are generic and not cached", async () => {
  const response = await buildObservationResponse({
    authorize: async () => user,
    loadObservations: async () => {
      throw new Error("private database detail");
    },
  });

  equal(response.status, 503);
  equal(response.headers.get("cache-control"), "no-store");

  deepStrictEqual(await response.json(), {
    error: "Monitoring unavailable",
  });
});