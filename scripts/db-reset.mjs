#!/usr/bin/env node
/**
 * LOCAL ONLY — drops public + drizzle schemas, re-runs migrations + base seed.
 *
 * Usage: npm run db:reset
 * Then:  npm run test:seed && npm run test:seed:verify
 *         npm run test:bo-overrides   (optional — FE alias izinleri)
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
dotenv.config({ path: join(ROOT, "apps/api/.env") });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing — expected in apps/api/.env");
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  console.error("Refusing db:reset in production.");
  process.exit(1);
}

const hostHint = url.includes("@") ? url.split("@").pop() : url;
if (!/localhost|127\.0\.0\.1/.test(hostHint)) {
  console.error(`Refusing db:reset on non-local DATABASE_URL host (${hostHint}).`);
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url });
try {
  await pool.query(`
    DROP SCHEMA IF EXISTS drizzle CASCADE;
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO PUBLIC;
  `);
  console.error("[db:reset] schemas dropped and recreated");
} finally {
  await pool.end();
}

for (const script of ["db:migrate", "db:seed", "admin:bootstrap"]) {
  const r = spawnSync("npm", ["run", script], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.error(
  "[db:reset] done — admin@wallet.local ready (Admin1234). Next:\n" +
    "  npm run test:seed && npm run test:seed:verify\n" +
    "  npm run test:bo-overrides   # optional FE alias perms\n" +
    "  Re-login in browser (db:reset invalidates old sessions).",
);
