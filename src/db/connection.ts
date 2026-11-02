import { Pool } from "pg";

import type { ClaimQuery } from "../lib/device-claims";
import { getDatabaseUrl } from "./config";

let pool: Pool | undefined;

export function getDatabasePool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrl(process.env.DATABASE_URL),
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    });
  }

  return pool;
}

export const queryDeviceRecords: ClaimQuery = async (text, values) => {
  const result = await getDatabasePool().query<{ id: string }>(text, values);

  return { rows: result.rows };
};