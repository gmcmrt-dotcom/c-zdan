/**
 * Shared cash-pool ledger helper (P0-34).
 *
 * Every finance-merchant cash_pool delta on Flow C (topup finalize) or
 * Flow D (withdraw finalize/timeout/reversal) MUST go through
 * `writeCashPoolDelta` so that:
 *
 *   1. The merchant row is locked (`FOR UPDATE`) before the read+write of
 *      `cash_pool`, preventing two concurrent finalize calls from racing on
 *      the same merchant.
 *   2. `merchant_cash_pool_log` is appended with the actual before/after
 *      values (taken from the locked row, not from a stale snapshot), so
 *      `sum(merchant_cash_pool_log.change_amount) == merchant.cash_pool` is
 *      the invariant finance reconciliation can rely on.
 *   3. The `cash_pool` column is updated in the SAME transaction so the log
 *      and the column never disagree.
 *
 * The previous implementation only updated `merchants.cash_pool` directly
 * (in topup.service.ts and withdraw.service.ts) and never wrote a log row;
 * the only writes to `merchant_cash_pool_log` came from admin
 * adjustCashPool / setCashPool. That made provider reconciliation
 * impossible (sum-of-log != current cash_pool by design).
 *
 * NOTE: this helper expects to be called inside an existing transaction —
 * passing the trx handle keeps the lock + log + column-update atomic.
 */
import { sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { merchantCashPoolLog } from "../db/schema";

export type CashPoolLogReason =
  | "topup_cash_pool"
  | "merchant_withdraw_cash_pool"
  | "withdraw_reversal_cash_pool"
  | "withdraw_timeout_cash_pool";

export interface WriteCashPoolDeltaInput {
  merchantId: string;
  /** Positive for inflow (topup), negative for outflow (withdraw). */
  delta: number;
  reason: CashPoolLogReason;
  referenceType?: string | null;
  referenceId?: string | null;
  notes?: string | null;
  /** Optional actor id for admin-driven flows; null for system flows. */
  createdBy?: string | null;
}

export interface WriteCashPoolDeltaResult {
  balanceBefore: number;
  balanceAfter: number;
}

/**
 * Lock the merchant, append a cash_pool_log row, and update merchants.cash_pool
 * — all in the caller's transaction.
 *
 * The caller is responsible for any provider-side updates that should happen
 * in the same tx (e.g. transactions row, settlement log, withdraw session
 * status). This helper deliberately does the minimum so it stays composable.
 */
export async function writeCashPoolDelta(
  trx: Database,
  input: WriteCashPoolDeltaInput,
): Promise<WriteCashPoolDeltaResult> {
  if (!Number.isFinite(input.delta)) {
    throw new Error("CASH_POOL_DELTA_INVALID");
  }
  if (input.delta === 0) {
    // No-op delta — still safe to return the current value without writing
    // a log row (would just be noise in reconciliation queries).
    const [row] = await trx.execute<{ cash_pool: string | null }>(sql`
      SELECT cash_pool FROM merchants WHERE id = ${input.merchantId} FOR UPDATE
    `);
    const cur = Number(row?.cash_pool ?? 0);
    return { balanceBefore: cur, balanceAfter: cur };
  }

  // Atomically lock the merchant row and read cash_pool.
  const [locked] = await trx.execute<{ cash_pool: string | null }>(sql`
    SELECT cash_pool FROM merchants WHERE id = ${input.merchantId} FOR UPDATE
  `);
  if (!locked) {
    throw new Error("MERCHANT_NOT_FOUND");
  }
  const balanceBefore = Number(locked.cash_pool ?? 0);
  const balanceAfter = balanceBefore + input.delta;

  // Update the column to the absolute new value (no further race window
  // because we hold the row lock).
  await trx.execute(sql`
    UPDATE merchants
    SET cash_pool = ${String(balanceAfter)},
        cash_pool_updated_at = now()
    WHERE id = ${input.merchantId}
  `);

  // Append the audit row.
  await trx.insert(merchantCashPoolLog).values({
    merchantId: input.merchantId,
    changeAmount: String(input.delta),
    balanceBefore: String(balanceBefore),
    balanceAfter: String(balanceAfter),
    reason: input.reason,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    notes: input.notes ?? null,
    createdBy: input.createdBy ?? null,
  });

  return { balanceBefore, balanceAfter };
}
