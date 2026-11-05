// One-time administrator bootstrap. Run only against a fresh, migrated project.
import { config } from "dotenv";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const { DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD } = process.env;
if (!DATABASE_URL || !NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !BOOTSTRAP_ADMIN_EMAIL || !BOOTSTRAP_ADMIN_PASSWORD || BOOTSTRAP_ADMIN_PASSWORD.length < 12) {
  console.error("Set DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD (12+ characters).");
  process.exitCode = 1;
} else {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  const auth = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let client;
  let createdId;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(91867423)");
    const { rows } = await client.query('SELECT count(*)::int AS count FROM ahu_private.users');
    if (rows[0].count !== 0) throw new Error("Bootstrap is only permitted when no role profiles exist.");
    const email = BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase();
    const rawUsername = (process.env.BOOTSTRAP_ADMIN_USERNAME || email.split("@")[0] || "admin")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[._-]+|[._-]+$/g, "")
      .slice(0, 32);
    const username = rawUsername.length >= 3 ? rawUsername : `${rawUsername}admin`.slice(0, 32);
    const { data, error } = await auth.auth.admin.createUser({ email, password: BOOTSTRAP_ADMIN_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`Supabase Auth user creation failed: ${error?.message ?? "unknown error"}`);
    createdId = data.user.id;
    await client.query('INSERT INTO ahu_private.users (id, email, username, full_name, role) VALUES ($1, $2, $3, $4, $5)', [createdId, email, username, "System Administrator", "Admin"]);
    await client.query("COMMIT");
    createdId = undefined;
    console.log("Administrator created. Remove bootstrap credentials from the environment.");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (createdId) {
      const { error: rollbackError } = await auth.auth.admin.deleteUser(createdId);
      if (rollbackError) console.error("Could not roll back the Auth user; remove it in Supabase:", createdId);
    }
    console.error(error instanceof Error ? error.message : "Bootstrap failed");
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool.end();
  }
}