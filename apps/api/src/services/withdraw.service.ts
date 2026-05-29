/**
 * Akış D — Withdraw sessions (member → finance merchant) with reservation +
 * cash-pool-priority routing.
 *
 * Hard rules:
 *   #1  idempotency via merchant_ref (HMAC layer for callback)
 *   #7  member never sees merchant name; only method type label
 *   #8  member is debited gross; fee reduces what merchant nets
 *   #9  amount reserved in `accounts.reserved_balance` from request until callback
 *   #12 `balance` ≠ `cash_pool`; `cash_pool` is the merchant's bank-side cash
 *       and is the priority constraint for routing
 *   #14 public_no = W-* allocated at session creation; inherited by tx
 *
 * Routing priority:
 *   1. merchant_type = finance, is_active, payment_routing_rules direction=withdraw
 *   2. cash_pool >= amount
 *   3. cash_pool_updated_at >= now() - 15min (freshness)
 *   4. failure_rate_pct < 5 (last 24h proxy — column-driven)
 *   5. per_tx_limit / daily_limit not exceeded (TODO: daily_limit aggregate)
 *   6. ORDER BY avg_withdraw_seconds ASC, last_failure_at NULLS FIRST
 *   7. LIMIT 1
 */
import { addSeconds } from "date-fns";
import { and, eq, sql } from "drizzle-orm";
import { db, tx } from "../db/client";
import {
  accounts,
  merchantCashPoolLog,
  merchants,
  paymentRoutingRules,
  topupSessions as _topupSessions,
  transactions,
  withdrawSessions,
} from "../db/schema";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from "../lib/errors";
import { allocPublicNo } from "../lib/public-no";
import { writeCashPoolDelta } from "./cash-pool";
import { applyWithdrawPenalty } from "./member.service";
import { maybeSetWithdrawCooldown } from "./loyalty-scoring.service";
import { writeProviderLedger } from "./provider-ledger.service";
import { computeFee } from "../lib/fees";

const SESSION_TTL_SEC = 30 * 60;

export interface RequestWithdrawInput {
  userId: string;
  methodType: string;
  amount: number;
  iban?: string | null;
  ibanHolder?: string | null;
  cryptoType?: string | null;
  payoutAddress?: string | null;
  notes?: string | null;
}

async function pickFinanceMerchantForWithdraw(input: {
  methodType: string;
  amount: number;
}): Promise<{ id: string; fee: number } | null> {
  // P0-39 — `cash_pool` alone is no longer the whole capacity. When a finance
  // merchant has `overdraft_enabled=true`, they accept routed withdraws up to
  // `cash_pool + overdraft_limit`. The previous routing only checked
  // `cash_pool >= amount`, so finance merchants with overdraft enabled could
  // never accept anything beyond their literal pool — the column was decorative.
  // The reservation UPDATE in `requestWithdrawV3` mirrors this same effective
  // capacity so the lock predicate stays consistent.
  const rows = await db.execute<{
    id: string;
    cash_pool: string;
    avg: number | null;
    withdraw_commission_pct: string;
    withdraw_fixed_fee: string;
    per_tx_limit: string | null;
  }>(sql`
    SELECT m.id,
           m.cash_pool,
           m.avg_withdraw_seconds AS avg,
           COALESCE(m.withdraw_commission_pct, 0) AS withdraw_commission_pct,
           COALESCE(m.withdraw_fixed_fee, 0) AS withdraw_fixed_fee,
           m.per_tx_limit
    FROM merchants m
    JOIN payment_routing_rules r
      ON r.merchant_id = m.id
     AND r.direction = 'withdraw'
     AND r.is_active = TRUE
     AND r.method_type = ${input.methodType}
    WHERE m.is_active = TRUE
      AND m.merchant_type = 'finance'
      AND (m.cash_pool + (CASE WHEN m.overdraft_enabled THEN COALESCE(m.overdraft_limit, 0) ELSE 0 END))
            >= ${String(input.amount)}
      AND (m.cash_pool_updated_at IS NULL OR m.cash_pool_updated_at >= now() - interval '15 minutes')
      AND (m.failure_rate_pct IS NULL OR m.failure_rate_pct < 5)
      AND (m.per_tx_limit IS NULL OR m.per_tx_limit >= ${String(input.amount)})
    ORDER BY m.avg_withdraw_seconds NULLS LAST, m.last_failure_at NULLS FIRST
    LIMIT 1
  `);
  const list = rows as unknown as Array<{
    id: string;
    withdraw_commission_pct: string;
    withdraw_fixed_fee: string;
  }>;
  const m = list[0];
  if (!m) return null;
  // P1 — integer-cent fee math (replaces float Math.round).
  const fee = computeFee({
    amount: input.amount,
    commissionPct: m.withdraw_commission_pct,
    fixedFee: m.withdraw_fixed_fee,
  });
  return { id: m.id, fee };
}

export async function requestWithdrawV3(input: RequestWithdrawInput) {
  if (!(input.amount > 0)) throw new BadRequestError("AMOUNT_INVALID");

  return tx(async (trx) => {
    // One pending session per user (member can't queue two withdraws)
    const open = await trx.execute(sql`
      SELECT 1 FROM withdraw_sessions
      WHERE user_id = ${input.userId}
        AND status IN ('pending','sent_to_merchant')
    `);
    if ((open as unknown as unknown[]).length > 0) {
      throw new ConflictError("WITHDRAW_IN_PROGRESS");
    }

    // Lock account, check available
    const [acc] = await trx.execute<{ balance: string; reserved_balance: string }>(sql`
      SELECT balance, reserved_balance FROM accounts WHERE user_id = ${input.userId} FOR UPDATE
    `);
    const accRow = acc as unknown as
      | { balance: string; reserved_balance: string }
      | undefined;
    if (!accRow) throw new NotFoundError("ACCOUNT_NOT_FOUND");
    const available = Number(accRow.balance) - Number(accRow.reserved_balance);
    if (input.amount > available) throw new UnprocessableError("INSUFFICIENT_FUNDS");

    const picked = await pickFinanceMerchantForWithdraw({
      methodType: input.methodType,
      amount: input.amount,
    });
    if (!picked) throw new UnprocessableError("NO_AVAILABLE_PROVIDER");

    // P0-16 — Atomically reserve cash_pool on the finance merchant we picked,
    // OR pick a different merchant if someone else took it first. Without this,
    // multiple concurrent withdraws could all route to the same merchant whose
    // pool only covers one, leading to a negative cash_pool when callbacks
    // finalize. The "WHERE cash_pool + overdraft_credit >= net" predicate is
    // the actual lock.
    //
    // P0-39 — overdraft is now respected here too: a finance merchant with
    // `overdraft_enabled=true` accepts the reservation as long as
    // `cash_pool + overdraft_limit >= net`. Selection in
    // `pickFinanceMerchantForWithdraw` uses the same predicate so the two
    // stay consistent.
    //
    // P0-34 — `RETURNING cash_pool` so we can synthesise a `cash_pool_log`
    // row inline (one INSERT below). The conditional UPDATE keeps the
    // routing-race property; the log INSERT keeps `sum(log) == cash_pool`
    // intact across routing → callback.
    const netDebit = input.amount - picked.fee;
    const reservedRows = await trx.execute<{
      id: string;
      cash_pool_after: string;
    }>(sql`
      UPDATE merchants
      SET cash_pool = cash_pool - ${String(netDebit)},
          cash_pool_updated_at = now()
      WHERE id = ${picked.id}
        AND is_active = TRUE
        AND merchant_type = 'finance'
        AND (cash_pool + (CASE WHEN overdraft_enabled THEN COALESCE(overdraft_limit, 0) ELSE 0 END))
              >= ${String(netDebit)}
      RETURNING id, cash_pool AS cash_pool_after
    `);
    const reservedList = reservedRows as unknown as Array<{
      id: string;
      cash_pool_after: string;
    }>;
    if (reservedList.length === 0) {
      // Lost the race for this merchant's pool; bubble up so the caller can
      // retry (which will pick a different merchant the next time).
      throw new UnprocessableError("NO_AVAILABLE_PROVIDER");
    }
    const cashPoolAfterRouting = Number(reservedList[0]!.cash_pool_after);
    const cashPoolBeforeRouting = cashPoolAfterRouting + netDebit;

    // Method-specific field validation
    if (input.methodType === "havale" || input.methodType === "papara") {
      if (!input.iban) throw new BadRequestError("IBAN_REQUIRED");
      if (!input.ibanHolder) throw new BadRequestError("IBAN_HOLDER_REQUIRED");
    }
    if (input.methodType === "kripto") {
      if (!input.cryptoType) throw new BadRequestError("CRYPTO_TYPE_REQUIRED");
      if (!input.payoutAddress) throw new BadRequestError("PAYOUT_ADDRESS_REQUIRED");
    }

    // Reserve member balance
    await trx
      .update(accounts)
      .set({
        reservedBalance: sql`${accounts.reservedBalance} + ${String(input.amount)}`,
        updatedAt: new Date(),
      })
      .where(eq(accounts.userId, input.userId));

    const publicNo = await allocPublicNo(trx, "W");
    const expiresAt = addSeconds(new Date(), SESSION_TTL_SEC);

    const [s] = await trx
      .insert(withdrawSessions)
      .values({
        publicNo,
        userId: input.userId,
        merchantId: picked.id,
        methodType: input.methodType,
        amount: String(input.amount),
        fee: String(picked.fee),
        status: "pending",
        iban: input.iban ?? null,
        ibanHolder: input.ibanHolder ?? null,
        cryptoType: input.cryptoType ?? null,
        payoutAddress: input.payoutAddress ?? null,
        notes: input.notes ?? null,
        reservedAt: new Date(),
        expiresAt,
      })
      .returning();
    if (!s) throw new Error("withdraw session insert failed");

    // P0-34 — Append the cash_pool_log row for the routing-time deduction
    // (the actual UPDATE happened above; this is the audit chain entry that
    // matches it). Without this, sum(merchant_cash_pool_log.change_amount)
    // would not equal merchant.cash_pool and finance reconciliation breaks.
    await trx.insert(merchantCashPoolLog).values({
      merchantId: picked.id,
      changeAmount: String(-netDebit),
      balanceBefore: String(cashPoolBeforeRouting),
      balanceAfter: String(cashPoolAfterRouting),
      reason: "merchant_withdraw_cash_pool",
      referenceType: "withdraw_session",
      referenceId: s.id,
      notes: `routing reservation for session ${s.publicNo}`,
    });

    return s;
  });
}

export async function getWithdrawSessionStatus(userId: string, sessionId: string) {
  const [s] = await db
    .select()
    .from(withdrawSessions)
    .where(and(eq(withdrawSessions.id, sessionId), eq(withdrawSessions.userId, userId)))
    .limit(1);
  if (!s) throw new NotFoundError("SESSION_NOT_FOUND");
  return s;
}

// ============================================================================
// Callback finalizer — /webhooks/merchant/withdraw-callback (HMAC route)
// ============================================================================
export interface FinalizeWithdrawCallbackInput {
  merchantId: string;
  internalRef: string;
  merchantRef: string;
  status: "success" | "failed";
  externalTxId?: string | null;
  failureReason?: string | null;
  note?: string | null;
}

export interface FinalizeWithdrawResult {
  transactionId: string | null;
  walletTxNo: string;
  merchantRef: string;
  externalTxId: string | null;
}

export async function finalizeWithdrawCallback(
  input: FinalizeWithdrawCallbackInput,
): Promise<FinalizeWithdrawResult> {
  return tx(async (trx) => {
    // P0-2 — Lock the session row. Without this two concurrent success
    // callbacks could both pass the status check and double-debit the member
    // (and double-drain cash_pool). The lock + status guard serialise them.
    const [s] = await trx.execute<{
      id: string;
      user_id: string;
      merchant_id: string;
      amount: string;
      fee: string;
      status: string;
      public_no: string;
      method_type: string;
    }>(sql`
      SELECT id, user_id, merchant_id, amount, fee, status, public_no, method_type
      FROM withdraw_sessions WHERE id = ${input.internalRef} FOR UPDATE
    `);
    if (!s) throw new NotFoundError("SESSION_NOT_FOUND");
    if (s.merchant_id !== input.merchantId) throw new ForbiddenError("MERCHANT_MISMATCH");
    if (["success", "failed", "timeout", "expired", "cancelled"].includes(s.status))
      throw new ConflictError("ALREADY_FINALIZED");

    if (input.status === "failed") {
      // P0-2 — lock the member account row before releasing the reservation.
      await trx.execute(sql`SELECT 1 FROM accounts WHERE user_id = ${s.user_id} FOR UPDATE`);
      await trx
        .update(accounts)
        .set({
          reservedBalance: sql`GREATEST(${accounts.reservedBalance} - ${s.amount}, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(accounts.userId, s.user_id));
      // P0-16 — restore the cash_pool reservation taken at routing time.
      // P0-34 — go through the shared helper so the reversal is audit-logged
      // alongside the original deduction (sum-of-log keeps matching cash_pool).
      const feeNumF = Number(s.fee);
      const netDebitF = Number(s.amount) - feeNumF;
      await writeCashPoolDelta(trx, {
        merchantId: s.merchant_id,
        delta: netDebitF, // positive — reversing a previous outflow
        reason: "withdraw_reversal_cash_pool",
        referenceType: "withdraw_session",
        referenceId: s.id,
        notes: input.merchantRef,
      });
      await trx
        .update(withdrawSessions)
        .set({
          status: "failed",
          finalizedAt: new Date(),
          releasedAt: new Date(),
          callbackReceivedAt: new Date(),
          callbackPayload: input as never,
          merchantRef: input.merchantRef,
          externalTxId: input.externalTxId ?? null,
          failureReason: input.failureReason ?? null,
          updatedAt: new Date(),
        })
        .where(eq(withdrawSessions.id, s.id));
      return {
        transactionId: null,
        walletTxNo: s.public_no,
        merchantRef: input.merchantRef,
        externalTxId: input.externalTxId ?? null,
      };
    }

    // Success: debit member balance + reserved, write tx. Finance cash_pool
    // was already deducted at routing time — no settlement_log row here.
    // P0-2 / P0-40 — lock the member account row AND read the current balance
    // so we can stamp balance_after on the transaction row.
    const [memAcc] = await trx.execute<{ balance: string }>(sql`
      SELECT balance FROM accounts WHERE user_id = ${s.user_id} FOR UPDATE
    `);
    if (!memAcc) throw new NotFoundError("ACCOUNT_NOT_FOUND");
    // P0-2 — lock the merchant row so the cash_pool log read is consistent
    // under concurrent admin adjust + topup callback. The cash_pool column
    // itself is NOT updated here (it was already deducted at routing time
    // by `requestWithdrawV3`'s atomic reservation UPDATE).
    await trx.execute(sql`
      SELECT 1 FROM merchants WHERE id = ${s.merchant_id} FOR UPDATE
    `);

    await trx.execute(sql`
      UPDATE accounts
      SET balance = balance - ${s.amount},
          reserved_balance = GREATEST(reserved_balance - ${s.amount}, 0),
          updated_at = now()
      WHERE user_id = ${s.user_id}
    `);
    const memberBalanceAfter = (Number(memAcc.balance) - Number(s.amount)).toFixed(2);

    const [txn] = await trx
      .insert(transactions)
      .values({
        publicNo: s.public_no,
        userId: s.user_id,
        type: "merchant_withdraw",
        status: "completed",
        amount: s.amount,
        fee: "0",
        balanceAfter: memberBalanceAfter,
        description: "merchant_withdraw",
        referenceId: s.id,
        merchantRef: input.merchantRef,
        externalTxId: input.externalTxId ?? null,
        metadata: {
          merchant_id: s.merchant_id,
          method_type: s.method_type,
          merchant_fee: Number(s.fee),
        },
      })
      .returning({ id: transactions.id });
    if (!txn) throw new Error("tx insert failed");

    // L1 Faz 1 — loyalty withdraw penalty (idempotent per transaction id).
    await applyWithdrawPenalty(trx, {
      userId: s.user_id,
      withdrawAmount: Number(s.amount),
      transactionId: txn.id,
    });

    // L1 Faz 2 — ≥3 withdraw in 30d → 50% spend multiplier for next 30 days.
    await maybeSetWithdrawCooldown(trx, s.user_id);

    // P0-16 / P0-34 — cash_pool already deducted + logged at routing time.
    const feeNum = Number(s.fee);
    const netDebit = Number(s.amount) - feeNum;

    // L1 — provider_ledger write via resolver (P0-35 / Q4 Option B).
    // Skips gracefully if merchant isn't in `merchant_provider_method_map`.
    await writeProviderLedger(trx, {
      merchantId: s.merchant_id,
      txType: "withdraw",
      direction: "out",
      amountGross: s.amount,
      providerCommission: s.fee,
      amountNet: String(netDebit),
      status: "success",
      transactionId: txn.id,
      externalRef: input.externalTxId ?? null,
      internalRef: input.merchantRef ?? null,
      userId: s.user_id,
    });

    await trx
      .update(withdrawSessions)
      .set({
        status: "success",
        finalizedAt: new Date(),
        callbackReceivedAt: new Date(),
        callbackPayload: input as never,
        merchantRef: input.merchantRef,
        externalTxId: input.externalTxId ?? null,
        transactionId: txn.id,
        updatedAt: new Date(),
      })
      .where(eq(withdrawSessions.id, s.id));

    return {
      transactionId: txn.id,
      walletTxNo: s.public_no,
      merchantRef: input.merchantRef,
      externalTxId: input.externalTxId ?? null,
    };
  });
}

/**
 * Cron: timeout pending withdraws past expires_at. Releases reservation.
 *
 * P1 (second sweep) — Run the session-update + per-row reservation release
 * inside a single transaction. The previous implementation issued separate
 * top-level `db.execute` calls, so a crash mid-loop could leave sessions in
 * `timeout` status while their reservation was never released — silently
 * locking the member's spendable balance.
 *
 * One CTE does the whole thing atomically: UPDATE sessions WHERE expired,
 * then UPDATE accounts joining on the affected user_id + amount. The single
 * statement also avoids a 1-by-1 round-trip per timed-out session.
 */
export async function scanWithdrawTimeouts(): Promise<{ timed_out: number }> {
  // P0-34 — Wrap the whole sweep in a single tx + use a CTE chain so we can
  // log the cash_pool reversal alongside the column update. The CTE returns
  // the post-update cash_pool, and we INSERT one cash_pool_log row per
  // timed-out session so sum-of-log stays equal to merchant.cash_pool.
  return tx(async (trx) => {
    const rows = await trx.execute<{
      id: string;
      merchant_id: string;
      delta: string;
      cash_pool_after: string;
    }>(sql`
      WITH timed_out AS (
        UPDATE withdraw_sessions
        SET status = 'timeout', finalized_at = now(), released_at = now(), updated_at = now()
        WHERE status IN ('pending','sent_to_merchant')
          AND expires_at < now()
        RETURNING id, user_id, merchant_id, amount, fee
      ),
      released_accounts AS (
        UPDATE accounts a
        SET reserved_balance = GREATEST(a.reserved_balance - t.amount, 0),
            updated_at = now()
        FROM timed_out t
        WHERE a.user_id = t.user_id
        RETURNING a.user_id
      ),
      -- P0-16 — restore the cash_pool reservation taken at routing time.
      released_pool AS (
        UPDATE merchants m
        SET cash_pool = cash_pool + (t.amount - t.fee),
            cash_pool_updated_at = now()
        FROM timed_out t
        WHERE m.id = t.merchant_id
        RETURNING m.id, t.id AS session_id, t.merchant_id, (t.amount - t.fee)::text AS delta, m.cash_pool::text AS cash_pool_after
      )
      SELECT session_id AS id, merchant_id, delta, cash_pool_after FROM released_pool
    `);
    const list = rows as unknown as Array<{
      id: string;
      merchant_id: string;
      delta: string;
      cash_pool_after: string;
    }>;
    for (const r of list) {
      const after = Number(r.cash_pool_after);
      const delta = Number(r.delta);
      await trx.insert(merchantCashPoolLog).values({
        merchantId: r.merchant_id,
        changeAmount: r.delta, // positive (reversal)
        balanceBefore: String(after - delta),
        balanceAfter: r.cash_pool_after,
        reason: "withdraw_timeout_cash_pool",
        referenceType: "withdraw_session",
        referenceId: r.id,
        notes: "scan_withdraw_timeouts auto-release",
      });
    }
    return { timed_out: list.length };
  });
}
