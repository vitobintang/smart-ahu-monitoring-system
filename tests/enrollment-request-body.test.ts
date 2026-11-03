import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readEnrollmentJson } from "../src/lib/enrollment-request-body";
function request(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request("https://ahu.example.invalid/enroll", { method: "POST", headers: { "content-type": "application/json", ...headers }, body,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}) } as RequestInit);
}
test("enrollment reader accepts bounded JSON and rejects invalid formats", async () => {
  assert.deepEqual(await readEnrollmentJson(request('{"key":"value"}')), { key: "value" });
  assert.equal(await readEnrollmentJson(request("not JSON")), null);
  assert.equal(await readEnrollmentJson(request("{}", { "content-type": "text/plain" })), null);
  assert.equal(await readEnrollmentJson(request("{}", { "content-encoding": "gzip" })), null);
  assert.equal(await readEnrollmentJson(request("{}", { "content-length": "1" })), null);
  assert.equal(await readEnrollmentJson(request(new Uint8Array([0xff]))), null);
  assert.equal(await readEnrollmentJson(request("x".repeat(33)), { maxBytes: 32 }), null);
});
test("enrollment reader cancels a slow stream and rejects locked bodies", async () => {
  let canceled = false; const stream = new ReadableStream<Uint8Array>({ cancel() { canceled = true; } });
  assert.equal(await readEnrollmentJson(request(stream), { timeoutMs: 20 }), null); assert.equal(canceled, true);
  const locked = request("{}"); const reader = locked.body!.getReader();
  try { assert.equal(await readEnrollmentJson(locked), null); } finally { reader.releaseLock(); }
});
