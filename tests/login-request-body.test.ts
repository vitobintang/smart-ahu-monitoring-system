import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readLoginRequestBody } from "../src/lib/login-request-body";

function request(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request("https://ahu.example.invalid/login", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  } as RequestInit);
}

test("accepts bounded JSON and preserves password exactly", async () => {
  const body = JSON.stringify({ email: "user@example.invalid", password: "  secret  " });
  assert.deepEqual(await readLoginRequestBody(request(body, { "content-length": String(Buffer.byteLength(body)) })),
    { email: "user@example.invalid", password: "  secret  " });
  assert.ok(await readLoginRequestBody(request(body, { "content-type": 'application/json; charset="utf-8"' })));
});

test("rejects bad formats and invalid headers", async () => {
  const body = JSON.stringify({ email: "a", password: "b" });
  for (const headers of [
    { "content-type": "text/plain" }, { "content-type": "application/json; charset=latin1" },
    { "content-type": "application/json; charset=utf-8; other=1" }, { "content-encoding": "gzip" },
    { "content-length": "-1" }, { "content-length": "01" }, { "content-length": "99999999999999999999" },
    { "content-length": "8193" }, { "content-length": "1" },
  ]) assert.equal(await readLoginRequestBody(request(body, headers)), null);
  assert.equal(await readLoginRequestBody(request("not json")), null);
  assert.equal(await readLoginRequestBody(request(JSON.stringify({ email: "a", password: "b", extra: 1 }))), null);
  assert.equal(await readLoginRequestBody(request(null)), null);
});

test("enforces streamed byte limit, UTF-8 validity, and chunk limit", async () => {
  assert.equal(await readLoginRequestBody(request("x".repeat(33)), { maxBytes: 32 }), null);
  assert.equal(await readLoginRequestBody(request(new Uint8Array([0xff, 0xfe]))), null);
  let produced = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) {
    if (produced++ < 1025) controller.enqueue(new Uint8Array()); else controller.close();
  } });
  assert.equal(await readLoginRequestBody(request(stream)), null);
});

test("times out an unfinished stream and rejects invalid limits", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  assert.equal(await readLoginRequestBody(request(stream), { timeoutMs: 20 }), null);
  assert.equal(cancelled, true);
  assert.equal(await readLoginRequestBody(request("{}"), { maxBytes: 8193 }), null);
  assert.equal(await readLoginRequestBody(request("{}"), { timeoutMs: 0 }), null);
});

test("a locked body fails closed rather than throwing", async () => {
  const req = request(JSON.stringify({ email: "a", password: "b" }));
  const lock = req.body!.getReader();
  try { assert.equal(await readLoginRequestBody(req), null); }
  finally { lock.releaseLock(); }
});