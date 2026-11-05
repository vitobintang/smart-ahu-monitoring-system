import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  __ahuPostgresqlPool?: Pool;
  __ahuDrizzleDb?: NodePgDatabase;
};

function getDb(): NodePgDatabase {
  if (globalForDb.__ahuDrizzleDb) return globalForDb.__ahuDrizzleDb;

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool =
    globalForDb.__ahuPostgresqlPool ??
    new Pool({
      connectionString: databaseUrl,
      max: Number(process.env.PG_POOL_MAX ?? 10),
      keepAlive: true,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 30_000),
    });

  if (!globalForDb.__ahuPostgresqlPool) {
    pool.on("error", (err) => {
      console.error("[AHU][pg] idle client error:", err.message);
    });
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