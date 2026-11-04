// Administrator password recovery script. Run from a trusted terminal with server env vars.
import { config } from "dotenv";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const {
  DATABASE_URL,
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  BOOTSTRAP_ADMIN_EMAIL,
  BOOTSTRAP_ADMIN_PASSWORD,
} = process.env;

if (
  !DATABASE_URL ||
  !NEXT_PUBLIC_SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY ||
  !BOOTSTRAP_ADMIN_PASSWORD ||
  BOOTSTRAP_ADMIN_PASSWORD.length < 8
) {
  console.error(
    "Set DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BOOTSTRAP_ADMIN_EMAIL (optional if only one Admin exists) and BOOTSTRAP_ADMIN_PASSWORD (8+ characters).",
  );
  process.exitCode = 1;
} else {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  const auth = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const emailArg = BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    const { rows } = emailArg
      ? await client.query(
          "SELECT id, email FROM ahu_private.users WHERE lower(email) = $1 AND role = 'Admin'",
          [emailArg],
        )
      : await client.query("SELECT id, email FROM ahu_private.users WHERE role = 'Admin'");

    if (rows.length === 0) {
      throw new Error("No matching Admin profile found in ahu_private.users.");
    }
    if (rows.length > 1) {
      throw new Error("Multiple Admin accounts exist. Set BOOTSTRAP_ADMIN_EMAIL to specify which Admin to reset.");
    }

    const admin = rows[0];
    const { error } = await auth.auth.admin.updateUserById(admin.id, {
      password: BOOTSTRAP_ADMIN_PASSWORD,
      email_confirm: true,
    });
    if (error) {
      throw new Error(`Supabase Auth password reset failed: ${error.message}`);
    }

    await client.query("DELETE FROM ahu_private.login_attempts");
    await client.query(
      "INSERT INTO ahu_private.audit_logs (id, user_id, user_email, action, entity, details) VALUES ($1, $2, $3, $4, $5, $6::jsonb)",
      [
        randomUUID(),
        admin.id,
        admin.email,
        "ADMIN_PASSWORD_RESET",
        `user:${admin.id}`,
        JSON.stringify({ recovery: true }),
      ],
    );
    await client.query("COMMIT");
    console.log(`Admin password reset for ${admin.email}. Sign in with email and password only (no token needed).`);
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error(error instanceof Error ? error.message : "Admin password reset failed");
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool.end();
  }
}
