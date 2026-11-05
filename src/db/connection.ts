import type { Pool } from "pg";

import type { ClaimQuery } from "../lib/device-claims";
import { getDatabaseUrl } from "./config";
import { getSharedPool } from "./index";

export function getDatabasePool(): Pool {
  const validatedUrl = getDatabaseUrl(process.env.DATABASE_URL);
  return getSharedPool(validatedUrl);
}

export const queryDeviceRecords: ClaimQuery = async (text, values) => {
  const result = await getDatabasePool().query<{ id: string }>(text, values);

  return { rows: result.rows };
};
