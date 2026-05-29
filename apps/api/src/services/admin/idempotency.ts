/**
 * Admin BO idempotency helper (H4).
 *
 * Pattern:
 *
 *   return withAdminIdempotency(trx, {
 *     actorId,
 *     action: "member.balance_adjust",
 *     key: opts.idempotencyKey,
 *   }, async () => {
 *     // … the actual money write …
 *     return result;
 *   });
 *
 * If `key` is null/undefined, the helper just runs the inner block (no
 * dedup). If a row with `(actor_id, action, key)` already exists, the
 * helper returns its cached `result` instead of running the block again
 * (annotated with `idempotent: true`). Otherwise it runs the block, then
 * stores the result and returns it.
 *
 * The unique constraint serialises concurrent submissions — the second
 * caller's INSERT fails with a unique-violation, we catch it and return
 * the now-existing row.
 */
import { and, eq } from "drizzle-orm";
import { adminIdempotency } from "../../db/schema";
import type { Database } from "../../db/client";

export interface AdminIdempotencyOpts {
  actorId: string;
  action: string;
  key: string | null | undefined;
}

export async function withAdminIdempotency<T extends Record<string, unknown>>(
  trx: Database,
  opts: AdminIdempotencyOpts,
  fn: () => Promise<T>,
): Promise<T & { idempotent?: boolean }> {
  if (!opts.key) {
    return fn();
  }

  // Look up first — typical happy path is no prior row, so this is one
  // index probe per call.
  const [prior] = await trx
    .select({ result: adminIdempotency.result })
    .from(adminIdempotency)
    .where(
      and(
        eq(adminIdempotency.actorId, opts.actorId),
        eq(adminIdempotency.action, opts.action),
        eq(adminIdempotency.key, opts.key),
      ),
    )
    .limit(1);
  if (prior) {
    return { ...(prior.result as T), idempotent: true };
  }

  const result = await fn();

  // Insert; on a race, the unique index trips and we fall through to read
  // the row the other caller just wrote.
  try {
    await trx
      .insert(adminIdempotency)
      .values({
        actorId: opts.actorId,
        action: opts.action,
        key: opts.key,
        result: result as Record<string, unknown>,
      })
      .onConflictDoNothing();
  } catch {
    // best-effort cache; never block the money write if the cache insert fails
  }
  return result;
}
