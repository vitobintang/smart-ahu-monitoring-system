import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  __ahuPostgresqlPool?: Pool;
  __ahuDrizzleDb?: NodePgDatabase;
};

const RETRYABLE_PG_PATTERNS = [
  "emaxconnsession",
  "maxclientsinsessionmode",
  "max clients reached",
  "remaining connection slots are reserved",
  "too many clients already",
  "connection terminated unexpectedly",
  "connection ended unexpectedly",
  "client has encountered a connection error",
  "timeout expired",
  "econnreset",
  "etimedout",
  "epipe",
  "eai_again",
];

const OFFLINE_DNS_PATTERNS = ["enotfound", "enetunreach", "ehostunreach", "econnrefused"];

const TRANSIENT_PG_CODES = new Set([
  "53300",
  "57P01",
  "57P02",
  "57P03",
  "08000",
  "08003",
  "08006",
]);

function collectErrorChainText(err: unknown, depth = 0): { codes: string[]; text: string } {
  if (!err || typeof err !== "object" || depth > 5) return { codes: [], text: "" };
  const rec = err as { message?: unknown; code?: unknown; cause?: unknown };
  const codes: string[] = [];
  if (typeof rec.code === "string") codes.push(rec.code);
  const ownMsg = typeof rec.message === "string" ? rec.message : "";
  const nested = rec.cause && rec.cause !== err ? collectErrorChainText(rec.cause, depth + 1) : { codes: [], text: "" };
  return {
    codes: [...codes, ...nested.codes],
    text: `${ownMsg} ${nested.text}`.toLowerCase(),
  };
}

export function isOfflineNetworkError(err: unknown): boolean {
  const { codes, text } = collectErrorChainText(err);
  if (codes.some((c) => OFFLINE_DNS_PATTERNS.includes(c.toLowerCase()))) return true;
  return OFFLINE_DNS_PATTERNS.some((p) => text.includes(p));
}

export function isTransientDbError(err: unknown): boolean {
  const { codes, text } = collectErrorChainText(err);
  // Note: XX000 is used by Supavisor for EMAXCONNSESSION, checked via text pattern below
  if (codes.some((c) => TRANSIENT_PG_CODES.has(c))) return true;
  return RETRYABLE_PG_PATTERNS.some((p) => text.includes(p));
}

/** Extracts a concise single-line root-cause summary without dumping full SQL column lists. */
export function summarizeDbError(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const rec = err as { message?: unknown; code?: unknown; cause?: unknown };
  if (rec.cause && rec.cause !== err && typeof rec.cause === "object") {
    const c = rec.cause as { message?: unknown; code?: unknown };
    if (typeof c.message === "string" && c.message.trim()) {
      return c.code ? `${c.code}: ${c.message.trim()}` : c.message.trim();
    }
  }
  return typeof rec.message === "string" ? rec.message.split("\n")[0] : String(err);
}

function defaultPoolMax(databaseUrl: string): number {
  const explicit = Number(process.env.PG_POOL_MAX);
  if (Number.isFinite(explicit) && explicit >= 1) return Math.floor(explicit);
  // Supabase session pooler enforces a strict shared pool_size (often 15 across
  // Studio, Auth, migrations, and dev reloads). Keeping a single shared Node pool
  // capped at 2 warm sockets multiplexes all queries cleanly in memory without
  // ever exhausting Supavisor session slots.
  const isSupabase =
    databaseUrl.includes("supabase.com") || databaseUrl.includes("supabase.co");
  return isSupabase ? 2 : 5;
}

function attachClientSafetyListener(client: PoolClient): void {
  const tagged = client as PoolClient & { __ahuErrorGuardAttached?: boolean };
  if (tagged.__ahuErrorGuardAttached) return;
  tagged.__ahuErrorGuardAttached = true;
  // Prevents checked-out transaction clients from throwing uncaughtException when
  // Supavisor or Wi-Fi drops a socket mid-flight.
  client.on("error", (err) => {
    console.warn("[AHU][pg-client] transient socket reset:", err.message);
  });
}

function installTransientPoolRetries(pool: Pool): void {
  const rawQuery = pool.query.bind(pool) as (...args: unknown[]) => unknown;
  const wrappedQuery = (...args: unknown[]): unknown => {
    const lastArg = args[args.length - 1];
    if (typeof lastArg === "function") {
      return rawQuery(...args);
    }
    const run = async () => {
      const maxAttempts = 4;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          return await (rawQuery(...args) as Promise<unknown>);
        } catch (err) {
          if (attempt >= maxAttempts || isOfflineNetworkError(err) || !isTransientDbError(err)) {
            throw err;
          }
          const delayMs = attempt * 260 + Math.floor(Math.random() * 140);
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      return rawQuery(...args);
    };
    return run();
  };
  (pool as unknown as { query: typeof wrappedQuery }).query = wrappedQuery;

  // Also wrap pool.connect() (used by Drizzle db.transaction()) with transient retry + client guard!
  const rawConnect = pool.connect.bind(pool) as (...args: unknown[]) => unknown;
  const wrappedConnect = (...args: unknown[]): unknown => {
    if (args.length > 0 && typeof args[0] === "function") {
      return rawConnect(...args);
    }
    const run = async (): Promise<PoolClient> => {
      const maxAttempts = 4;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const client = (await (rawConnect() as Promise<PoolClient>));
          attachClientSafetyListener(client);
          return client;
        } catch (err) {
          if (attempt >= maxAttempts || isOfflineNetworkError(err) || !isTransientDbError(err)) {
            throw err;
          }
          const delayMs = attempt * 280 + Math.floor(Math.random() * 150);
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      const client = (await (rawConnect() as Promise<PoolClient>));
      attachClientSafetyListener(client);
      return client;
    };
    return run();
  };
  (pool as unknown as { connect: typeof wrappedConnect }).connect = wrappedConnect;
}

export function getSharedPool(connectionStringOverride?: string): Pool {
  if (globalForDb.__ahuPostgresqlPool) return globalForDb.__ahuPostgresqlPool;

  const databaseUrl = (connectionStringOverride ?? process.env.DATABASE_URL)?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: defaultPoolMax(databaseUrl),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    idleTimeoutMillis: 8_000,
    allowExitOnIdle: true,
    connectionTimeoutMillis: 12_000,
    statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 25_000),
  });

  pool.on("connect", (client) => {
    attachClientSafetyListener(client);
  });

  pool.on("error", (err) => {
    console.warn("[AHU][pg-pool] idle client reset:", err.message);
  });

  installTransientPoolRetries(pool);
  globalForDb.__ahuPostgresqlPool = pool;
  return pool;
}

function getDb(): NodePgDatabase {
  if (globalForDb.__ahuDrizzleDb) return globalForDb.__ahuDrizzleDb;
  const pool = getSharedPool();
  const instance = drizzle(pool);
  globalForDb.__ahuDrizzleDb = instance;
  return instance;
}

export const db: NodePgDatabase = new Proxy({} as NodePgDatabase, {
  get(_target, prop) {
    const instance = getDb();
    const value = Reflect.get(instance, prop, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
