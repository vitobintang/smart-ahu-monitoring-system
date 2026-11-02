import { test } from "node:test";
import { equal, match, notEqual } from "node:assert/strict";

import {
  createCsrfToken,
  csrfTokensMatch,
  isSameOrigin,
} from "../src/lib/request-security";

test("origin comparison handles canonical HTTPS and ports", () => {
  equal(
    isSameOrigin("https://APP.example.com:443", "https://app.example.com/"),
    true,
  );
  equal(
    isSameOrigin("https://app.example.com:8443", "https://app.example.com:8443"),
    true,
  );
});

test("local HTTP is accepted only for the matching origin", () => {
  equal(isSameOrigin("http://localhost:3000", "http://localhost:3000"), true);
  equal(isSameOrigin("http://localhost:3001", "http://localhost:3000"), false);
});

test("different hosts, schemes, or ports are rejected", () => {
  equal(
    isSameOrigin("https://app.example.com.evil.test", "https://app.example.com"),
    false,
  );
  equal(isSameOrigin("https://other.example.com", "https://app.example.com"), false);
  equal(isSameOrigin("http://app.example.com", "https://app.example.com"), false);
  equal(
    isSameOrigin("https://app.example.com:8443", "https://app.example.com"),
    false,
  );
});

test("missing, malformed, or non-origin values are rejected", () => {
  const invalid = [
    null,
    undefined,
    "null",
    "not-a-url",
    "https://app.example.com/path",
    "https://app.example.com?x=1",
    "https://user:pass@app.example.com",
    "https://app.example.com#x",
    " https://app.example.com",
  ];

  for (const value of invalid) {
    equal(isSameOrigin(value, "https://app.example.com"), false);
  }

  equal(isSameOrigin("https://app.example.com", undefined), false);
  equal(
    isSameOrigin("https://app.example.com", "https://app.example.com/path"),
    false,
  );
});

test("CSRF tokens use random 32-byte values", () => {
  const first = createCsrfToken();
  const second = createCsrfToken();

  match(first, /^[a-f0-9]{64}$/);
  equal(Buffer.from(first, "hex").length, 32);
  notEqual(first, second);
  equal(csrfTokensMatch(first, first), true);
});

test("missing, malformed, or different CSRF tokens do not match", () => {
  const first = "a".repeat(64);
  const second = "b".repeat(64);

  equal(csrfTokensMatch(first, second), false);
  equal(csrfTokensMatch(first, null), false);
  equal(csrfTokensMatch(undefined, first), false);
  equal(csrfTokensMatch("short", first), false);
  equal(csrfTokensMatch("A".repeat(64), first), false);
});