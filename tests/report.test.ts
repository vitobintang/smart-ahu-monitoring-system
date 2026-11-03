import { test } from "node:test";
import assert from "node:assert/strict";
// No connection is opened by these pure CSV tests.
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1/test";

test("CSV protects untrusted text and quotes multiline fields", async () => {
  const { reportToCsv, spreadsheetSafe } = await import("../src/lib/queries");
  assert.equal(spreadsheetSafe("=HYPERLINK(\"bad\")"), "'=HYPERLINK(\"bad\")");
  assert.equal(spreadsheetSafe("  +1"), "'  +1");
  assert.equal(spreadsheetSafe("ordinary"), "ordinary");
  const result = reportToCsv({ samples: [{ timestamp: new Date("2026-01-01T00:00:00Z"), source: "PHYSICAL", messageId: "=cmd", faultCode: "first\rsecond", current: 1, voltage: 220, isCurrentFallback: true, isVoltageFallback: true }] } as never);
  assert.match(result, /'=cmd/);
  assert.ok(result.includes('"first\rsecond"'));
  assert.match(result, /ESTIMATED_FALLBACK,ESTIMATED_FALLBACK/);
});