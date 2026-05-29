import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env, isProd } from "../lib/env";
import * as schema from "./schema/index";

/**
 * Single shared Postgres connection pool. Drizzle wraps it.
 *
 * `max: 20` keeps us under PG's default 100-connection limit even with
 * multiple worker processes; tune in env later.
 *
 * `prepare: false` keeps the pool PgBouncer-friendly (transaction pool mode
 * does not support prepared statements). Closes p3-third-sweep item
 * "client.ts prepare:false — fine for PgBouncer, document"; the trade-off
 * is a small per-query parse cost which is dwarfed by network round-trip
 * for our typical OLTP workload (median query <2 ms).
 *
 * P0-14 — SSL handling:
 *   - If `DATABASE_URL` carries `sslmode=require|verify-ca|verify-full`,
 *     `postgres-js` honours it automatically.
 *   - Otherwise, in production, we still upgrade to SSL with
 *     `rejectUnauthorized=false` (matching `sslmode=require`) so an unconfigured
 *     deploy is still encrypted; surface a startup warning so the operator
 *     knows to switch to verify-full + a pinned CA.
 *   - In dev / test the default plaintext loopback connection is preserved.
 */
function resolveSsl(url: string): boolean | { rejectUnauthorized: boolean } {
  const hasSslMode = /[?&]sslmode=/.test(url);
  if (hasSslMode) return false; // postgres-js parses ?sslmode= itself
  if (!isProd) return false;
  // eslint-disable-next-line no-console
  console.warn(
    "[db] DATABASE_URL has no sslmode in production — connecting with TLS but NOT verifying the server cert. Set sslmode=verify-full + a CA bundle for a real cert chain.",
  );
  return { rejectUnauthorized: false };
}

export const sql = postgres(env.DATABASE_URL, {
  max: 20,
  idle_timeout: 30,
  prepare: false,
  ssl: resolveSsl(env.DATABASE_URL),
});

export const db = drizzle(sql, { schema, logger: false });
export type Database = typeof db;

/** Run a function inside a transaction, returning its result. */
export function tx<T>(fn: (trx: Database) => Promise<T>): Promise<T> {
  return db.transaction((t) => fn(t as unknown as Database));
}
