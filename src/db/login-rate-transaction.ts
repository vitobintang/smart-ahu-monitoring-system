import type {
  RateQuery,
  RateTransaction,
} from "../lib/shared-login-rate";

// Pool-compatible interfaces allow testing without connecting to Supabase.
type RateClient = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: unknown[] }>;

  release(error?: Error | boolean): void;
};

export type RatePool = {
  connect(): Promise<RateClient>;
};

// Each call uses one checked-out connection for the whole transaction.
export function createRateTransaction(
  pool: RatePool,
): RateTransaction {
  return async function transaction<T>(
    work: (query: RateQuery) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();

    let began = false;
    let committing = false;
    let discard = false;

    try {
      await client.query("BEGIN");
      began = true;

      const query: RateQuery = async (text, values) => {
        const result = await client.query(text, values);
        return { rows: result.rows };
      };

      const result = await work(query);

      committing = true;
      await client.query("COMMIT");

      return result;
    } catch (error) {
      // Do not reuse the client if BEGIN or COMMIT failed.
      if (!began || committing) {
        discard = true;
      }

      if (began) {
        try {
          await client.query("ROLLBACK");
        } catch {
          discard = true;
        }
      }

      throw error;
    } finally {
      client.release(discard ? true : undefined);
    }
  };
}