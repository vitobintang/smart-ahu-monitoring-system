import { test } from "node:test";
import { strict as assert } from "node:assert";
import { validateLoginInput } from "../src/lib/login-input";

test("accepts bounded input without changing an existing password", () => {
  const input = { email: "Person@example.invalid", password: "  spaces matter  " };
  assert.deepEqual(validateLoginInput(input), input);
});

test("rejects malformed, extra and oversized fields without returning them", () => {
  const cases = [null, [], {}, { email: "a" }, { email: "a", password: 123 },
    { email: " a", password: "x" }, { email: "a\nb", password: "x" },
    { email: "x".repeat(321), password: "x" }, { email: "a", password: "" },
    { email: "a", password: "a".repeat(4097) }, { email: "a", password: "x", browserToken: "private" }];
  for (const value of cases) assert.equal(validateLoginInput(value), null);
});

test("uses UTF-8 byte length for the password bound", () => {
  assert.ok(validateLoginInput({ email: "a", password: "é".repeat(2048) }));
  assert.equal(validateLoginInput({ email: "a", password: "é".repeat(2049) }), null);
});