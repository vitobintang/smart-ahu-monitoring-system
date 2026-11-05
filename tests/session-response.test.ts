import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";

import { buildSessionResponse } from "../src/lib/session-response";

test("unauthorized sessions receive a generic response", async () => {
  const response = await buildSessionResponse(async () => null);

  equal(response.status, 401);
  equal(response.headers.get("cache-control"), "no-store");
  deepStrictEqual(await response.json(), { error: "Not authenticated" });
});

test("authorized sessions return user identity and role", async () => {
  const response = await buildSessionResponse(async () => ({
    id: "user-1",
    role: "Operator",
  }));

  equal(response.status, 200);
  equal(response.headers.get("cache-control"), "no-store");
  deepStrictEqual(await response.json(), {
    user: { id: "user-1", role: "Operator" },
  });
});

test("unexpected errors do not expose details", async () => {
  const response = await buildSessionResponse(async () => {
    throw new Error("sensitive details");
  });

  equal(response.status, 401);
  deepStrictEqual(await response.json(), { error: "Not authenticated" });
});