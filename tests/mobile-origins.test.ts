import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedMobileOrigin } from "../src/lib/mobile-origins";

test("native API origins are exact matches, never wildcard or prefix matches", () => {
  assert.equal(isAllowedMobileOrigin("capacitor://localhost", ""), true);
  assert.equal(isAllowedMobileOrigin("https://localhost", ""), true);
  assert.equal(isAllowedMobileOrigin("http://localhost:5173", ""), process.env.NODE_ENV !== "production");
  assert.equal(isAllowedMobileOrigin("https://localhost.attacker.example", ""), false);
  assert.equal(isAllowedMobileOrigin("https://attacker.example", ""), false);
  assert.equal(isAllowedMobileOrigin("null", ""), false);
  assert.equal(isAllowedMobileOrigin(null, "https://mobile.example"), false);
});

test("additional trusted origins must be explicitly listed", () => {
  assert.equal(isAllowedMobileOrigin("https://mobile.example", "https://mobile.example"), true);
  assert.equal(isAllowedMobileOrigin("https://other.example", "https://mobile.example"), false);
});
