import { test } from "node:test";
import { deepEqual, equal, throws } from "node:assert/strict";

import { parseServiceAccountFields } from "../src/lib/firebase/admin";

test("Firebase service-account environment fields form Admin credentials and normalize escaped newlines", () => {
  const credentials = parseServiceAccountFields(
    {
      EXAMPLE_PROJECT_ID: "  identity-project  ",
      EXAMPLE_CLIENT_EMAIL: "admin@example.invalid",
      EXAMPLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nline\\n-----END PRIVATE KEY-----\\n",
    },
    "EXAMPLE_",
  ) as Record<string, string>;

  deepEqual(credentials, {
    project_id: "identity-project",
    client_email: "admin@example.invalid",
    private_key: "-----BEGIN PRIVATE KEY-----\nline\n-----END PRIVATE KEY-----\n",
  });
});

test("Firebase service-account fields are optional, but partial sets are rejected", () => {
  equal(parseServiceAccountFields({}, "EXAMPLE_"), null);
  throws(
    () => parseServiceAccountFields({ EXAMPLE_PROJECT_ID: "identity-project" }, "EXAMPLE_"),
    /set PROJECT_ID, CLIENT_EMAIL, and PRIVATE_KEY together/,
  );
});
