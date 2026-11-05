import type { Pool } from "pg";

import { getDatabaseUrl } from "./config";
import { getSharedPool } from "./index";

export function getDatabasePool(): Pool {
  const validatedUrl = getDatabaseUrl(process.env.DATABASE_URL);
  return getSharedPool(validatedUrl);
}

