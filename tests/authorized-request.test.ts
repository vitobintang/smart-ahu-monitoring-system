import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";

import {
  authorizeRequest,
  type AuthorizationDependencies,
} from "../src/lib/authorized-request";

function dependencies(): AuthorizationDependencies {
  return {
    getVerifiedUser: async () => ({ id: "user-1" }),

    getProfile: async (id) => ({
      id,
      role: "Operator",
    }),

    isBrowserAuthorized: async (id, token) =>
      id === "user-1" && token === "example-token",
  };
}

test("verified user, role, and browser allow a permitted request", async () => {
  deepStrictEqual(
    await authorizeRequest(dependencies(), "example-token", "commands:request"),
    { id: "user-1", role: "Operator" },
  );
});

test("missing session is denied without reading the profile", async () => {
  const deps = dependencies();
  let profileCalled = false;

  deps.getVerifiedUser = async () => null;
  deps.getProfile = async () => {
    profileCalled = true;
    return null;
  };

  equal(await authorizeRequest(deps, "example-token", "monitoring:read"), null);
  equal(profileCalled, false);
});

test("missing or mismatched profiles are denied", async () => {
  const deps = dependencies();

  deps.getProfile = async () => null;
  equal(await authorizeRequest(deps, "example-token", "monitoring:read"), null);

  deps.getProfile = async () => ({ id: "another-user", role: "Admin" });
  equal(await authorizeRequest(deps, "example-token", "monitoring:read"), null);
});

test("unknown roles and disallowed permissions are denied", async () => {
  const deps = dependencies();

  deps.getProfile = async (id) => ({ id, role: "Unknown" });
  equal(await authorizeRequest(deps, "example-token", "monitoring:read"), null);

  deps.getProfile = async (id) => ({ id, role: "Viewer" });
  equal(await authorizeRequest(deps, "example-token", "commands:request"), null);
  equal(await authorizeRequest(deps, "example-token", "unknown:permission"), null);
});

test("missing or unauthorized browser tokens are denied", async () => {
  equal(await authorizeRequest(dependencies(), null, "monitoring:read"), null);
  equal(
    await authorizeRequest(dependencies(), "wrong-token", "monitoring:read"),
    null,
  );
});

test("authentication and database failures deny access", async () => {
  const deps = dependencies();

  deps.getVerifiedUser = async () => {
    throw new Error("auth unavailable");
  };
  equal(await authorizeRequest(deps, "example-token", "monitoring:read"), null);

  deps.getVerifiedUser = async () => ({ id: "user-1" });
  deps.getProfile = async () => {
    throw new Error("database unavailable");
  };
  equal(await authorizeRequest(deps, "example-token", "monitoring:read"), null);

  deps.getProfile = async (id) => ({ id, role: "Operator" });
  deps.isBrowserAuthorized = async () => {
    throw new Error("database unavailable");
  };
  equal(await authorizeRequest(deps, "example-token", "monitoring:read"), null);
});