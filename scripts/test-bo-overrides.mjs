#!/usr/bin/env node
/**
 * Test-only: grant admin@ FE alias permissions for button visibility testing.
 * Safe on local / CI — refuses production unless ALLOW_TEST_SEED=true.
 *
 * Run after db:seed + test:seed:
 *   node scripts/test-bo-overrides.mjs
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "..", "apps/api/.env");

dotenv.config({ path: ENV_PATH });

const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@wallet.local";

/** Forward-looking FE alias keys from admin-bo-registry (not all enforced on BE yet). */
const ALIAS_OVERRIDES = [
  ["members", "view_login_ips"],
  ["members", "update"],
  ["members", "manual_adjust"],
  ["members.kyc", "approve"],
  ["transactions", "view"],
  ["transactions", "export"],
  ["transactions", "manual_adjust"],
  ["merchants", "network_config"],
  ["merchants", "integration_urls"],
  ["merchants", "cash_collection_fee"],
  ["permissions", "update"],
  ["templates", "edit"],
  ["loyalty", "update"],
  ["loyalty", "manual_grant"],
  ["referrals", "edit_config"],
  ["affiliates", "contact"],
  ["commissions", "export"],
];

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(`DATABASE_URL missing — expected in ${ENV_PATH}`);
  }
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_TEST_SEED !== "true") {
    throw new Error("Refusing to apply BO overrides in production.");
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const userRes = await client.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [ADMIN_EMAIL]);
    const userId = userRes.rows[0]?.id;
    if (!userId) {
      throw new Error(`${ADMIN_EMAIL} not found — run admin:bootstrap first`);
    }

    await client.query("BEGIN");
    for (const [resource, action] of ALIAS_OVERRIDES) {
      await client.query(
        `INSERT INTO user_permission_overrides (user_id, resource, action, granted, reason)
         VALUES ($1, $2, $3, true, 'test-bo-overrides.mjs')
         ON CONFLICT (user_id, resource, action)
         DO UPDATE SET granted = true, reason = EXCLUDED.reason`,
        [userId, resource, action],
      );
    }
    await client.query("COMMIT");
    console.log(`[test-bo-overrides] Granted ${ALIAS_OVERRIDES.length} alias overrides to ${ADMIN_EMAIL}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[test-bo-overrides] FAILED:", err.message ?? err);
  process.exit(1);
});
