import { test } from "node:test";
import { equal, match, notEqual, throws } from "node:assert/strict";

import {
  createDeviceToken,
  hashDeviceToken,
  type DeviceTokenPurpose,
} from "../src/lib/device-tokens";

test("tokens use 32 bytes in URL-safe form", () => {
  const token = createDeviceToken();

  match(token, /^[A-Za-z0-9_-]{43}$/);
  equal(Buffer.from(token, "base64url").length, 32);
});

test("separately created tokens differ", () => {
  notEqual(createDeviceToken(), createDeviceToken());
});

test("hashes are deterministic and separated by purpose", () => {
  const token = "A".repeat(43);

  equal(
    hashDeviceToken(token, "invitation"),
    "fed949ab88fabd69d6424c534a21ba0196370b340444ae3251290614105b03c6",
  );

  equal(
    hashDeviceToken(token, "invitation"),
    hashDeviceToken(token, "invitation"),
  );

  notEqual(
    hashDeviceToken(token, "invitation"),
    hashDeviceToken(token, "browser"),
  );
});

test("invalid token formats are rejected", () => {
  throws(() => hashDeviceToken("short", "invitation"), /format/);
  throws(() => hashDeviceToken("A".repeat(42) + "@", "browser"), /format/);
  throws(() => hashDeviceToken(" " + "A".repeat(43), "browser"), /format/);
});

test("unknown token purposes are rejected", () => {
  throws(
    () =>
      hashDeviceToken(
        "A".repeat(43),
        "unknown" as DeviceTokenPurpose,
      ),
    /purpose/,
  );
});