import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryRtdb, resolveRtdbPathPrefix, withPathPrefix } from "../src/lib/rtdb/store";

test("resolveRtdbPathPrefix trims slashes, rejects bad segments, defaults to empty", () => {
  assert.equal(resolveRtdbPathPrefix({ ...process.env, RTDB_PATH_PREFIX: "" }), "");
  assert.equal(resolveRtdbPathPrefix({} as NodeJS.ProcessEnv), "");
  assert.equal(resolveRtdbPathPrefix({ ...process.env, RTDB_PATH_PREFIX: " ahu-app " }), "ahu-app");
  assert.equal(resolveRtdbPathPrefix({ ...process.env, RTDB_PATH_PREFIX: "/ahu-app/" }), "ahu-app");
  assert.equal(resolveRtdbPathPrefix({ ...process.env, RTDB_PATH_PREFIX: "apps/ahu" }), "apps/ahu");
  assert.throws(() => resolveRtdbPathPrefix({ ...process.env, RTDB_PATH_PREFIX: "a//b" }));
  assert.throws(() => resolveRtdbPathPrefix({ ...process.env, RTDB_PATH_PREFIX: "a..b" }));
  assert.throws(() => resolveRtdbPathPrefix({ ...process.env, RTDB_PATH_PREFIX: "a#b" }));
  assert.throws(() => resolveRtdbPathPrefix({ ...process.env, RTDB_PATH_PREFIX: "a[b]" }));
  assert.throws(() => resolveRtdbPathPrefix({ ...process.env, RTDB_PATH_PREFIX: "a$b" }));
});

test("withPathPrefix relocates get/set/update/remove under the namespace", async () => {
  const backing = new InMemoryRtdb();
  const prefixed = withPathPrefix(backing, "ahu-app");

  await prefixed.set("ahus/AHU-01", { id: "AHU-01", setpoint: 21.5 });
  await prefixed.update("ahus/AHU-01", { setpoint: 22 });
  await prefixed.set("usernames", { bob: "uid-1" });

  // The app sees its own tree as if it were the root…
  assert.deepEqual(await prefixed.get("ahus/AHU-01"), { id: "AHU-01", setpoint: 22 });
  assert.deepEqual(await prefixed.get("usernames"), { bob: "uid-1" });
  assert.equal(await prefixed.get("devices/GTM-DAIKIN-001"), null);

  // …while the raw database holds everything under the prefix only.
  assert.deepEqual(Object.keys(backing.dump()).sort(), ["ahu-app"]);
  assert.deepEqual(await backing.get("devices/GTM-DAIKIN-001"), null);

  await prefixed.remove("ahus/AHU-01");
  assert.equal(await prefixed.get("ahus/AHU-01"), null);
  assert.deepEqual(await backing.get("ahus/ahu-app/ahus/AHU-01"), null); // never written at the root
  assert.deepEqual(Object.keys(await backing.get<Record<string, unknown>>("ahu-app") ?? {}).sort(), ["ahus", "usernames"]);
});

test("withPathPrefix transactions run against the namespaced node", async () => {
  const backing = new InMemoryRtdb();
  const prefixed = withPathPrefix(backing, "ahu-app");

  const claim = await prefixed.transaction<string>("usernames/bob", (current) => (current === null ? "uid-1" : undefined));
  assert.equal(claim.committed, true);
  const second = await prefixed.transaction<string>("usernames/bob", (current) => (current === null ? "uid-2" : undefined));
  assert.equal(second.committed, false);
  assert.equal(await backing.get<string>("ahu-app/usernames/bob"), "uid-1");
});

test("withPathPrefix is a no-op with an empty prefix", async () => {
  const backing = new InMemoryRtdb();
  const passthrough = withPathPrefix(backing, "");
  await passthrough.set("ahus/AHU-01", { id: "AHU-01" });
  assert.deepEqual(Object.keys(backing.dump()), ["ahus"]);
});
