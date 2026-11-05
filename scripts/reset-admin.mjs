// Administrator password recovery script.
// Works across Windows PowerShell, CMD, macOS, and Linux:
//   npm run db:reset-admin -- <new_password>
//   npm run db:reset-admin -- <admin_email> <new_password>
//   npm run db:reset-admin -- --email <admin_email> --password <new_password>
// Or via environment variables:
//   PowerShell: $env:BOOTSTRAP_ADMIN_EMAIL="admin@example.com"; $env:BOOTSTRAP_ADMIN_PASSWORD="newpassword"; npm run db:reset-admin
//   Bash:       BOOTSTRAP_ADMIN_EMAIL="admin@example.com" BOOTSTRAP_ADMIN_PASSWORD="newpassword" npm run db:reset-admin
import { config } from "dotenv";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

function parseCliArgs(argv) {
  let email;
  let password;
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--email" || arg === "-e") {
      email = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--email=")) {
      email = arg.slice("--email=".length);
    } else if (arg === "--password" || arg === "-p") {
      password = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--password=")) {
      password = arg.slice("--password=".length);
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  if (positional.length === 1 && !password) {
    password = positional[0];
  } else if (positional.length >= 2) {
    if (!email) email = positional[0];
    if (!password) password = positional[1];
  }

  return { email, password };
}

const cli = parseCliArgs(process.argv.slice(2));
const { DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const targetEmail = (cli.email ?? process.env.BOOTSTRAP_ADMIN_EMAIL ?? "").trim().toLowerCase();
const targetPassword = cli.password ?? process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";

if (!DATABASE_URL || !NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY in .env.local / .env.",
  );
  process.exitCode = 1;
} else if (!targetPassword || targetPassword.length < 8) {
  console.error(
    [
      "Provide a new password (8+ characters).",
      "Cross-platform usage (PowerShell, CMD, Bash):",
      "  npm run db:reset-admin -- <new_password>",
      "  npm run db:reset-admin -- <admin_email> <new_password>",
      "",
      "Or in Windows PowerShell using environment variables:",
      '  $env:BOOTSTRAP_ADMIN_EMAIL="admin@example.com"; $env:BOOTSTRAP_ADMIN_PASSWORD="newpassword"; npm run db:reset-admin',
    ].join("\n"),
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
    const { rows } = targetEmail
      ? await client.query(
          "SELECT id, email FROM ahu_private.users WHERE lower(email) = $1 AND role = 'Admin'",
          [targetEmail],
        )
      : await client.query("SELECT id, email FROM ahu_private.users WHERE role = 'Admin'");

    if (rows.length === 0) {
      throw new Error(
        targetEmail
          ? `No Admin profile found for "${targetEmail}" in ahu_private.users.`
          : "No Admin profile found in ahu_private.users.",
      );
    }
    if (rows.length > 1) {
      throw new Error(
        "Multiple Admin accounts exist. Pass the email explicitly: npm run db:reset-admin -- <admin_email> <new_password>",
      );
    }

    const admin = rows[0];
    const { error } = await auth.auth.admin.updateUserById(admin.id, {
      password: targetPassword,
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
