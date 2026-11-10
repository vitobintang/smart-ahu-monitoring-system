import type { Database } from "firebase-admin/database";

/**
 * Minimal injectable Realtime Database surface used by the repository layer.
 *
 * Production binds this to firebase-admin's Database; tests use the in-memory
 * implementation below (same seam style as the SQL layer's injected exec/query).
 * Paths are slash-separated ("users/uid-1/role"); the empty string is the root.
 */

export interface RtdbAdapter {
  get<T = unknown>(path: string): Promise<T | null>;
  set(path: string, value: unknown): Promise<void>;
  update(path: string, values: Record<string, unknown>): Promise<void>;
  remove(path: string): Promise<void>;
  /**
   * RTDB transaction: `compute` receives the current value and returns the next.
   * Returning `undefined` aborts the transaction (committed: false) — used for
   * claim-style uniqueness (e.g. one owner per username key). Returning `null`
   * deletes the node. Returning the unchanged current value COMMITS (it is not
   * an abort) — return `undefined` when the intent is "do nothing".
   */
  transaction<T>(
    path: string,
    compute: (current: T | null) => T | null | undefined,
  ): Promise<{ committed: boolean; value: T | null }>;
}

/** Segments must never contain "/", ".", "#", "$", "[", "]" (RTDB key rules). */
export function assertRtdbPath(path: string): void {
  if (path.includes("//")) throw new Error(`Invalid RTDB path: ${path}`);
  for (const segment of path.split("/")) {
    if (!segment) continue;
    if (/[.#$[\]]/.test(segment)) throw new Error(`Invalid RTDB path segment: ${segment}`);
  }
}

/** Production adapter over firebase-admin's Database. */
export function createAdminRtdbAdapter(db: Database, prefixOverride?: string): RtdbAdapter {
  const prefix = prefixOverride ?? resolveRtdbPathPrefix();
  const ref = (path: string) => {
    assertRtdbPath(path);
    return db.ref(path);
  };
  return withPathPrefix(
    {
      async get<T>(path: string): Promise<T | null> {
        const snap = await ref(path).get();
        return (snap.val() ?? null) as T | null;
      },
      async set(path: string, value: unknown): Promise<void> {
        await ref(path).set(value);
      },
      async update(path: string, values: Record<string, unknown>): Promise<void> {
        await ref(path).update(values);
      },
      async remove(path: string): Promise<void> {
        await ref(path).remove();
      },
      async transaction<T>(path: string, compute: (current: T | null) => T | undefined) {
        const result = await ref(path).transaction((current: unknown) => compute(((current ?? null) as T | null)));
        return { committed: result.committed, value: (result.snapshot?.val() ?? null) as T | null };
      },
    },
    prefix,
  );
}

/**
 * Optional namespace for SHARED Realtime Databases (env `RTDB_PATH_PREFIX`,
 * e.g. "ahu-app"). Every adapter read/write is transparently relocated under
 * `prefix/...`, so the app's whole footprint (ahus, telemetry, users, …) lives
 * in one subtree and can never collide with the owner's existing nodes.
 * Empty by default (standalone projects keep the root layout).
 *
 * Segments must be non-empty and free of RTDB-illegal characters; nested
 * prefixes ("apps/ahu") are allowed.
 */
export function resolveRtdbPathPrefix(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.RTDB_PATH_PREFIX ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!raw) return "";
  if (raw.includes("//")) throw new Error("RTDB_PATH_PREFIX cannot contain empty path segments");
  for (const segment of raw.split("/")) {
    // Same key charset as assertRtdbPath: no ".", "#", "$", "[", "]".
    if (/[#$[\]]/.test(segment) || segment.includes(".")) {
      throw new Error(`Invalid RTDB_PATH_PREFIX segment: "${segment}"`);
    }
  }
  return raw;
}

/** Relocates every adapter operation under `prefix` (no-op when empty). */
export function withPathPrefix(adapter: RtdbAdapter, prefix: string): RtdbAdapter {
  if (!prefix) return adapter;
  const prefixed = (path: string) => (path ? `${prefix}/${path.replace(/^\/+|\/+$/g, "")}` : prefix);
  return {
    get: <T>(path: string) => adapter.get<T>(prefixed(path)),
    set: (path: string, value: unknown) => adapter.set(prefixed(path), value),
    update: (path: string, values: Record<string, unknown>) => adapter.update(prefixed(path), values),
    remove: (path: string) => adapter.remove(prefixed(path)),
    transaction: <T>(path: string, compute: (current: T | null) => T | null | undefined) =>
      adapter.transaction<T>(prefixed(path), compute),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function resolvePath(root: Record<string, unknown>, path: string): unknown {
  if (!path) return root;
  let node: unknown = root;
  for (const segment of path.split("/")) {
    if (!segment) continue;
    if (!isPlainObject(node)) return null;
    node = node[segment] ?? null;
  }
  return node ?? null;
}

/**
 * In-memory RTDB used by tests. Mimics the subset of semantics the app relies
 * on: nested get/set/update/remove plus abort-on-undefined transactions.
 */
export class InMemoryRtdb implements RtdbAdapter {
  private root: Record<string, unknown> = {};

  /** Test helper: direct view of the raw tree. */
  dump(): Record<string, unknown> {
    return deepClone(this.root);
  }

  /** Test helper: seed values without going through set(). */
  seed(values: Record<string, unknown>): void {
    this.root = deepClone(values);
  }

  async get<T = unknown>(path: string): Promise<T | null> {
    assertRtdbPath(path);
    return (deepClone(resolvePath(this.root, path)) ?? null) as T | null;
  }

  async set(path: string, value: unknown): Promise<void> {
    assertRtdbPath(path);
    if (!path) {
      this.root = isPlainObject(value) ? deepClone(value) : {};
      return;
    }
    const segments = path.split("/").filter(Boolean);
    let node: Record<string, unknown> = this.root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const key = segments[i];
      if (!isPlainObject(node[key])) node[key] = {};
      node = node[key] as Record<string, unknown>;
    }
    const last = segments[segments.length - 1];
    if (value === null) delete node[last];
    else node[last] = deepClone(value);
  }

  async update(path: string, values: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      await this.set(path ? `${path}/${key}` : key, value);
    }
  }

  async remove(path: string): Promise<void> {
    await this.set(path, null);
  }

  async transaction<T>(
    path: string,
    compute: (current: T | null) => T | null | undefined,
  ): Promise<{ committed: boolean; value: T | null }> {
    const current = (await this.get<T>(path)) ?? null;
    const next = compute(current);
    if (next === undefined) return { committed: false, value: current };
    await this.set(path, next);
    return { committed: true, value: deepClone(next) };
  }
}

