import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  __ahuPostgresqlPool?: Pool;
  __ahuDrizzleDb?: NodePgDatabase;
};

const TRANSIENT_PG_PATTERNS = [
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
];

const TRANSIENT_PG_CODES = new Set(["53300", "57P01", "57P02", "57P03", "08000", "08003", "08006"]);

function isTransientDbError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as { message?: unknown; code?: unknown; cause?: unknown };
  if (typeof rec.code === "string" && TRANSIENT_PG_CODES.has(rec.code)) return true;
  const msg = typeof rec.message === "string" ? rec.message.toLowerCase() : "";
  if (TRANSIENT_PG_PATTERNS.some((p) => msg.includes(p))) return true;
  if (rec.cause && rec.cause !== err) return isTransientDbError(rec.cause);
  return false;
}

function defaultPoolMax(databaseUrl: string): number {
  const explicit = Number(process.env.PG_POOL_MAX);
  if (Number.isFinite(explicit) && explicit >= 1) return Math.floor(explicit);
  // Supabase session pooler enforces a shared project-wide max_pool_size (often 10).
  // Keeping the Node pool compact (3 warm sockets) multiplexes burst queries in memory
  // without exhausting Supavisor slots alongside Auth and Dashboard connections.
  const isSupabase =
    databaseUrl.includes("supabase.com") || databaseUrl.includes("supabase.co");
  return isSupabase ? 3 : 5;
}

function installTransientQueryRetry(pool: Pool): void {
  const rawQuery = pool.query.bind(pool) as (...args: unknown[]) => unknown;
  const wrapped = (...args: unknown[]): unknown => {
    // Preserve callback-style invocations untouched if pg internals ever pass a callback
    const lastArg = args[args.length - 1];
    if (typeof lastArg === "function") {
      return rawQuery(...args);
    }
    const run = async () => {
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          return await (rawQuery(...args) as Promise<unknown>);
        } catch (err) {
          if (attempt >= maxAttempts || !isTransientDbError(err)) {
            throw err;
          }
          const delayMs = attempt * 180 + Math.floor(Math.random() * 90);
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      return rawQuery(...args);
    };
    return run();
  };
  (pool as unknown as { query: typeof wrapped }).query = wrapped;
}

function getDb(): NodePgDatabase {
  if (globalForDb.__ahuDrizzleDb) return globalForDb.__ahuDrizzleDb;

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  let pool = globalForDb.__ahuPostgresqlPool;
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: defaultPoolMax(databaseUrl),
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 20_000,
      statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 30_000),
    });
    pool.on("error", (err) => {
      console.error("[AHU][pg] idle client error:", err.message);
    });
    installTransientQueryRetry(pool);
  }

  const instance = drizzle(pool);
  globalForDb.__ahuPostgresqlPool = pool;
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
