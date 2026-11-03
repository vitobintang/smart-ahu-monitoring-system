// Run once from a trusted terminal after migrations. Never put the code in Git.
import { config } from "dotenv";
import { Pool } from "pg";
import { randomBytes, randomUUID, createHash } from "node:crypto";
config({ path: ".env.local", quiet: true }); config({ path: ".env", quiet: true });
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
if (!process.env.DATABASE_URL || !email) {
  console.error("Set DATABASE_URL and BOOTSTRAP_ADMIN_EMAIL in your private environment."); process.exitCode = 1;
} else {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(91867424)");
    const existing = await client.query(`SELECT count(*)::int AS count FROM ahu_private.access_devices d
      JOIN ahu_private.users u ON u.id = d.user_id WHERE u.role = 'Admin' AND d.revoked_at IS NULL
      AND ((d.claimed_at IS NULL AND d.invitation_expires_at > now()) OR (d.claimed_at IS NOT NULL AND d.expires_at > now()))`);
    if (existing.rows[0].count) throw new Error("An active Admin authorization exists. An authorized Admin must issue further tokens.");
    const user = await client.query("SELECT id FROM ahu_private.users WHERE lower(email) = $1 AND role = 'Admin'", [email]);
    if (user.rows.length !== 1) throw new Error("Admin profile not found. Create the first admin before bootstrapping a device.");
    const token = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(token).digest("hex");
    const id = randomUUID();
    await client.query("INSERT INTO ahu_private.access_devices (id,user_id,label,invitation_hash,invitation_expires_at) VALUES ($1,$2,$3,$4,now() + interval '24 hours')", [id, user.rows[0].id, "Initial Admin browser", hash]);
    await client.query("INSERT INTO ahu_private.audit_logs (id,user_id,user_email,action,entity,details) VALUES ($1,$2,$3,$4,$5,$6::jsonb)", [randomUUID(), user.rows[0].id, email, "ACCESS_DEVICE_BOOTSTRAPPED", `access-device:${id}`, JSON.stringify({ recovery: true })]);
    await client.query("COMMIT");
    console.log("One-time initial admin device token (valid for 24 hours; keep private):\n" + token);
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error(err instanceof Error ? err.message : "Bootstrap failed"); process.exitCode = 1;
  } finally { client?.release(); await pool.end(); }
}