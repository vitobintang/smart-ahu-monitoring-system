import { test } from "node:test";
import { equal, match, notEqual, throws } from "node:assert/strict";

import {
  createDeviceToken,
  hashDeviceToken,
  type DeviceTokenPurpose,
} from "../src/lib/device-tokens";

test("tokens use 32 random bytes encoded as lowercase hex", () => {
  const token = createDeviceToken();

  match(token, /^[a-f0-9]{64}$/);
  equal(Buffer.from(token, "hex").length, 32);
});

test("separately created tokens differ", () => {
  notEqual(createDeviceToken(), createDeviceToken());
});

test("token hashes match the existing format", () => {
  const token = "a".repeat(64);

  equal(
    hashDeviceToken(token, "invitation"),
    "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb",
  );

  // The existing app uses the same hash calculation for both purposes.
  equal(
    hashDeviceToken(token, "invitation"),
    hashDeviceToken(token, "browser"),
  );
});

test("invalid token formats are rejected", () => {
  throws(() => hashDeviceToken("short", "invitation"), /format/);
  throws(() => hashDeviceToken("a".repeat(63) + "G", "browser"), /format/);
  throws(() => hashDeviceToken(" " + "a".repeat(64), "browser"), /format/);
});

test("unknown token purposes are rejected", () => {
  throws(
    () =>
      hashDeviceToken(
        "a".repeat(64),
        "unknown" as DeviceTokenPurpose,
      ),
    /purpose/,
  );
});