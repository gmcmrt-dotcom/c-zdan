/**
 * Akış A — Payment code (member → commerce merchant spend).
 *
 * Hard rules enforced:
 *   #1  idempotency (via merchant_ref, handled at HMAC layer)
 *   #7  no merchant name shown to member (member tx description uses txTypeLabel)
 *   #8  member pays gross = net, no commission deducted from member
 *   #9  reserved balance & reserved points (release on cancel/expire, consume on use)
 *   #10 tier snapshot stored at code creation time (fairness)
 *   #14 public_no triple-id model (P-* for spend)
 *   #15 commerce parent/child accounting → merchant_settlement_log uses child id
 *
 * `consume_payment_code` is invoked from merchant-charge (HMAC route) — see
 * routes/merchant-public.routes.ts.
 */
import { addSeconds } from "date-fns";
import { and, eq, lt, sql } from "drizzle-orm";
import { db, tx, type Database } from "../db/client";
import {
  accounts,
  loyaltyPointsLog,
  loyaltyTiers,
  merchantSettlementLog,
  merchants,
  paymentCodes,
  transactions,
} from "../db/schema";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from "../lib/errors";
import { makeTxPublicNo } from "../lib/public-no";
import { randomNumericCode } from "../lib/random";
import { computeFee } from "../lib/fees";
import { maybeUpgradeTier } from "./loyalty-tier.service";
import {
  computeSpendPoints,
  loadLoyaltySpendContext,
} from "./loyalty-scoring.service";

const CODE_LEN = 8;

function newCode(): string {
  return randomNumericCode(CODE_LEN);
}

// H6 — tier loader now accepts the caller's transaction. Previously it
// always used the top-level `db`, so the tier was read outside the locked
// account transaction; a concurrent admin tier change could let the user
// see one tier while spending against another.
async function getOrLoadTier(
  userId: string,
  trx: Database = db,
): Promise<{
  id: number;
  displayName: string;
  pointMultiplier: number;
  commissionDiscountPct: number;
  turnover: number;
}> {
  const [acc] = await trx
    .select({ tierId: accounts.currentTierId, points: accounts.totalPoints })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .limit(1);
  if (!acc) throw new NotFoundError("ACCOUNT_NOT_FOUND");
  const tiers = await trx
    .select()
    .from(loyaltyTiers)
    .where(eq(loyaltyTiers.isArchived, false))
    .orderBy(loyaltyTiers.sortOrder);
  const t = tiers.find((x) => x.id === acc.tierId) ?? tiers[0];
  if (!t) throw new NotFoundError("LOYALTY_TIER_NOT_FOUND");
  return {
    id: t.id,
    displayName: t.displayName,
    pointMultiplier: Number(t.pointMultiplier),
    commissionDiscountPct: Number(t.commissionDiscountPct),
    turnover: acc.points,
  };
}

export async function previewSpend(userId: string, amount: number) {
  if (!(amount > 0)) throw new BadRequestError("AMOUNT_INVALID");
  const [acc] = await db
    .select({ balance: accounts.balance, reserved: accounts.reservedBalance })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .limit(1);
  if (!acc) throw new NotFoundError("ACCOUNT_NOT_FOUND");
  const available = Number(acc.balance) - Number(acc.reserved);
  if (amount > available) throw new UnprocessableError("INSUFFICIENT_FUNDS");
  const tier = await getOrLoadTier(userId);
  const loyaltyCtx = await loadLoyaltySpendContext(userId);
  const spendPoints = computeSpendPoints({
    amount,
    tierMultiplier: tier.pointMultiplier,
    monthlySpendCount: loyaltyCtx.monthlySpendCount,
    streakDays: loyaltyCtx.streakDays,
    inCooldown: loyaltyCtx.inCooldown,
  });
  // Legacy RPC shape — Payment.tsx reads data[0].
  return [
    {
      spend_points: spendPoints,
      cashback_points: 0,
      cashback_amount: 0,
      tier_label: tier.displayName,
      turnover: loyaltyCtx.monthlySpendCount,
    },
  ];
}

export async function createPaymentCode(
  userId: string,
  amount: number,
  ttlSeconds = 300,
  customerName?: string,
) {
  if (!(amount > 0)) throw new BadRequestError("AMOUNT_INVALID");
  if (ttlSeconds < 60 || ttlSeconds > 3600) throw new BadRequestError("TTL_INVALID");

  return tx(async (trx) => {
    // P1 — cap active payment codes per user to avoid DoS via reservation
    // (a member could create N codes that together reserve the full balance,
    // locking spendable funds and bloating payment_codes). 5 is generous;
    // matches the legacy product cap.
    const ACTIVE_CODES_CAP = 5;
    const activeCount = await trx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM payment_codes
      WHERE user_id = ${userId} AND status = 'active'
    `);
    const cnt = (activeCount as unknown as Array<{ n: number }>)[0]?.n ?? 0;
    if (cnt >= ACTIVE_CODES_CAP) {
      throw new ConflictError("TOO_MANY_ACTIVE_CODES");
    }

    // Lock account row to atomically reserve.
    const [acc] = await trx.execute<{
      balance: string;
      reserved_balance: string;
      tier_id: number;
      total_points: number;
      cooldown_until: string | null;
    }>(sql`
      SELECT balance, reserved_balance, current_tier_id AS tier_id, total_points,
             cooldown_until
      FROM accounts WHERE user_id = ${userId} FOR UPDATE
    `);
    const row = acc as unknown as
      | {
          balance: string;
          reserved_balance: string;
          tier_id: number;
          total_points: number;
          cooldown_until: string | null;
        }
      | undefined;
    if (!row) throw new NotFoundError("ACCOUNT_NOT_FOUND");
    const balance = Number(row.balance);
    const reserved = Number(row.reserved_balance);
    const available = balance - reserved;
    if (amount > available) throw new UnprocessableError("INSUFFICIENT_FUNDS");

    // H6 — pass the open transaction so the tier read is part of the same
    // serialised view as the locked-account row above.
    const tier = await getOrLoadTier(userId, trx);
    const loyaltyCtx = await loadLoyaltySpendContext(userId, {
      cooldownUntil: row.cooldown_until,
      trx,
    });
    const reservedPoints = computeSpendPoints({
      amount,
      tierMultiplier: tier.pointMultiplier,
      monthlySpendCount: loyaltyCtx.monthlySpendCount,
      streakDays: loyaltyCtx.streakDays,
      inCooldown: loyaltyCtx.inCooldown,
    });

    // Allocate a unique code (retry on collision)
    let code = "";
    for (let i = 0; i < 10; i++) {
      code = newCode();
      const [dup] = await trx
        .select({ id: paymentCodes.id })
        .from(paymentCodes)
        .where(and(eq(paymentCodes.code, code), eq(paymentCodes.status, "active")))
        .limit(1);
      if (!dup) break;
      code = "";
    }
    if (!code) throw new Error("could not allocate payment code");

    const expiresAt = addSeconds(new Date(), ttlSeconds);

    const [pc] = await trx
      .insert(paymentCodes)
      .values({
        userId,
        code,
        amount: String(amount),
        status: "active",
        customerNameSnapshot: customerName ?? null,
        expiresAt,
        reservedSpendPoints: reservedPoints,
        reservedCashbackPoints: 0,
        reservedAtTierId: tier.id,
        reservedAtTurnover: tier.turnover,
      })
      .returning();
    if (!pc) throw new Error("payment code insert failed");

    // Reserve balance — increment reserved_balance.
    await trx
      .update(accounts)
      .set({
        reservedBalance: sql`${accounts.reservedBalance} + ${String(amount)}`,
        updatedAt: new Date(),
      })
      .where(eq(accounts.userId, userId));

    return {
      id: pc.id,
      code: pc.code,
      amount: Number(pc.amount),
      expiresAt: pc.expiresAt.toISOString(),
      status: pc.status,
    };
  });
}

/**
 * P0-37 — cancel a payment code under a row lock with a conditional UPDATE.
 *
 * The previous implementation did a non-locking SELECT then an unconditional
 * UPDATE, which could race with `consumePaymentCode` and (a) overwrite a
 * `consumed` row back to `cancelled`, AND (b) double-release the reservation
 * (driving `reserved_balance` negative — `GREATEST(... , 0)` masked it but
 * the books still drifted). The fix is a `FOR UPDATE` on the payment_code
 * row plus a `WHERE status='active' RETURNING` on the cancel; if zero rows
 * come back, someone else (consume or expire cron) has already terminated
 * the code and we refuse cleanly.
 */
export async function cancelPaymentCode(userId: string, codeId: string) {
  return tx(async (trx) => {
    const [pc] = await trx.execute<{
      id: string;
      user_id: string;
      amount: string;
      status: string;
    }>(sql`
      SELECT id, user_id, amount, status FROM payment_codes
      WHERE id = ${codeId} AND user_id = ${userId}
      FOR UPDATE
    `);
    if (!pc) throw new NotFoundError("CODE_NOT_FOUND");
    if (pc.status !== "active") throw new ConflictError("CODE_NOT_ACTIVE");

    // Lock the account row before we release the reservation so a concurrent
    // create/consume on the same account cannot interleave with our update.
    await trx.execute(sql`SELECT 1 FROM accounts WHERE user_id = ${userId} FOR UPDATE`);

    // Conditional update — only flip status if still active. This is belt
    // AND braces with the row lock above; if anyone else somehow gets in
    // between (different tx isolation), they cannot overwrite our state.
    const cancelled = await trx.execute<{ id: string }>(sql`
      UPDATE payment_codes
      SET status = 'cancelled', cancelled_at = now()
      WHERE id = ${codeId} AND status = 'active'
      RETURNING id
    `);
    if (!cancelled || (cancelled as unknown as Array<unknown>).length === 0) {
      throw new ConflictError("CODE_NOT_ACTIVE");
    }

    await trx
      .update(accounts)
      .set({
        reservedBalance: sql`GREATEST(${accounts.reservedBalance} - ${pc.amount}, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(accounts.userId, userId));
    return { success: true };
  });
}

export interface ConsumeInput {
  code: string;
  amount: number;
  customerName: string;
  merchantId: string;
  merchantRef: string | null;
  note?: string | null;
}

export interface ConsumeOutput {
  transactionId: string;
  walletTxNo: string;
  pointsAwarded: number;
}

/**
 * Akış A — Consume payment code.
 *
 * Validations:
 *   - code active (within window, not consumed/expired/cancelled)
 *   - amount matches code amount exactly
 *   - customer_name matches snapshot (case-insensitive, normalized)
 *
 * Side effects (atomic):
 *   - payment_codes.status='consumed', consumed_by_merchant set
 *   - accounts.balance -= amount, reserved_balance -= amount
 *   - transactions row (type=spend, public_no=P-*)
 *   - merchant_settlement_log row (change_amount = +(amount - fee))
 *   - loyalty_points_log row (reserved points materialize)
 *   - accounts.total_points += reservedSpendPoints
 */
export async function consumePaymentCode(input: ConsumeInput): Promise<ConsumeOutput> {
  if (!input.code) throw new BadRequestError("CODE_REQUIRED");
  if (!(input.amount > 0)) throw new BadRequestError("AMOUNT_INVALID");
  if (!input.customerName?.trim()) throw new BadRequestError("NAME_REQUIRED");

  return tx(async (trx) => {
    // Lock the payment_code row
    const [pcRow] = await trx.execute<Record<string, unknown>>(sql`
      SELECT * FROM payment_codes WHERE code = ${input.code} FOR UPDATE
    `);
    const pc = pcRow as unknown as
      | {
          id: string;
          user_id: string;
          amount: string;
          status: string;
          customer_name_snapshot: string | null;
          expires_at: Date;
          reserved_spend_points: number;
        }
      | undefined;
    if (!pc) throw new NotFoundError("CODE_NOT_FOUND");
    if (pc.status === "expired" || new Date(pc.expires_at).getTime() < Date.now())
      throw new ConflictError("CODE_EXPIRED");
    if (pc.status === "consumed") throw new ConflictError("CODE_USED");
    if (pc.status === "cancelled") throw new ConflictError("CODE_CANCELLED");
    if (pc.status !== "active") throw new ConflictError("CODE_NOT_ACTIVE");
    if (Number(pc.amount) !== input.amount) throw new UnprocessableError("AMOUNT_MISMATCH");
    if (pc.customer_name_snapshot) {
      const a = pc.customer_name_snapshot.trim().toLocaleLowerCase("tr-TR");
      const b = input.customerName.trim().toLocaleLowerCase("tr-TR");
      if (a !== b) throw new UnprocessableError("NAME_MISMATCH");
    }

    // P0-2 — Lock the merchant row so balance + commission read are consistent
    // with the settlement-log values we'll write below; previously the
    // settlement log captured stale balanceBefore/After on concurrent spends.
    const [m] = await trx.execute<{
      id: string;
      merchant_type: string;
      merchant_scope: string | null;
      parent_merchant_id: string | null;
      commission_pct: string;
      fixed_fee: string;
      balance: string;
    }>(sql`
      SELECT id, merchant_type, merchant_scope, parent_merchant_id,
             commission_pct, fixed_fee, balance
      FROM merchants WHERE id = ${input.merchantId} FOR UPDATE
    `);
    if (!m) throw new NotFoundError("MERCHANT_NOT_FOUND");
    if (m.merchant_type !== "commerce") throw new ForbiddenError("WRONG_MERCHANT_TYPE");
    // P1 — HARD_RULES #15: parent merchants are integration aggregates;
    // accounting must hit a child row, never the parent. Reject parent-scope
    // calls so a misconfigured integration cannot accrue against the parent.
    if (m.merchant_scope === "parent") throw new ForbiddenError("PARENT_MERCHANT_NOT_ALLOWED");
    // P1 — integer-cent fee math (replaces Math.round on floats).
    const fee = computeFee({ amount: input.amount, commissionPct: m.commission_pct, fixedFee: m.fixed_fee });
    const merchantNet = input.amount - fee;
    if (!(merchantNet >= 0)) throw new UnprocessableError("FEE_EXCEEDS_AMOUNT");

    // P0-2 — Lock the member's account row before reading + mutating it. The
    // atomic SQL increment was safe-ish in isolation, but pairing it with a
    // FOR UPDATE serialises concurrent consumes on the same code-holder so
    // reserved_balance never goes negative and total_points stays consistent.
    const [acctRow] = await trx.execute<{ balance: string }>(sql`
      SELECT balance FROM accounts WHERE user_id = ${pc.user_id} FOR UPDATE
    `);
    if (!acctRow) throw new NotFoundError("ACCOUNT_NOT_FOUND");

    // Deduct member balance + release reservation
    await trx
      .update(accounts)
      .set({
        balance: sql`${accounts.balance} - ${String(input.amount)}`,
        reservedBalance: sql`GREATEST(${accounts.reservedBalance} - ${String(input.amount)}, 0)`,
        totalPoints: sql`${accounts.totalPoints} + ${pc.reserved_spend_points}`,
        updatedAt: new Date(),
      })
      .where(eq(accounts.userId, pc.user_id));

    // P0-40 — balance_after computed from locked balance + this delta. The
    // FOR UPDATE above guarantees no other writer can interleave, so the
    // arithmetic matches the actual write. Named distinctly from the merchant
    // settlement-log `balanceAfter` further down to avoid shadowing.
    const memberBalanceAfter = (Number(acctRow.balance) - input.amount).toFixed(2);

    // tx row
    const publicNo = await makeTxPublicNo(trx, "spend");
    const [txn] = await trx
      .insert(transactions)
      .values({
        publicNo,
        userId: pc.user_id,
        type: "spend",
        status: "completed",
        amount: String(input.amount),
        fee: String(fee),
        balanceAfter: memberBalanceAfter,
        description: "spend",
        referenceId: pc.id,
        metadata: {
          merchant_id: input.merchantId,
          customer_name: input.customerName,
          merchant_ref: input.merchantRef,
          note: input.note ?? null,
        },
        merchantRef: input.merchantRef,
      })
      .returning({ id: transactions.id });
    if (!txn) throw new Error("transaction insert failed");

    // mark code consumed
    await trx
      .update(paymentCodes)
      .set({
        status: "consumed",
        consumedAt: new Date(),
        consumedByMerchant: input.merchantId,
      })
      .where(eq(paymentCodes.id, pc.id));

    // settlement log + balance bump.
    // P0-2 — balanceBefore comes from the locked SELECT above; balanceAfter
    // is a simple sum because no other writer can have touched this merchant
    // row while we hold the lock.
    const balanceBefore = Number(m.balance);
    const balanceAfter = balanceBefore + merchantNet;
    await trx.execute(sql`
      UPDATE merchants
      SET balance = balance + ${String(merchantNet)}
      WHERE id = ${input.merchantId}
    `);
    await trx.insert(merchantSettlementLog).values({
      merchantId: input.merchantId,
      changeAmount: String(merchantNet),
      balanceBefore: String(balanceBefore),
      balanceAfter: String(balanceAfter),
      reason: "spend",
      referenceType: "transaction",
      referenceId: txn.id,
      notes: input.merchantRef ?? null,
    });

    // loyalty
    if (pc.reserved_spend_points > 0) {
      await trx.insert(loyaltyPointsLog).values({
        userId: pc.user_id,
        points: pc.reserved_spend_points,
        reason: "spend",
        referenceId: txn.id,
      });
    }

    // L2 — auto tier upgrade when points + turnover thresholds are both met.
    await maybeUpgradeTier(pc.user_id, trx);

    return {
      transactionId: txn.id,
      walletTxNo: publicNo,
      pointsAwarded: pc.reserved_spend_points,
    };
  });
}

/** Idempotent cron: cancel codes past expires_at and release reservations. */
export async function expireStalePaymentCodes(): Promise<{ expired: number }> {
  return tx(async (trx) => {
    const expired = await trx.execute<{ id: string; user_id: string; amount: string }>(sql`
      UPDATE payment_codes
      SET status = 'expired', cancelled_at = now()
      WHERE status = 'active' AND expires_at < now()
      RETURNING id, user_id, amount
    `);
    const rows = expired as unknown as Array<{ id: string; user_id: string; amount: string }>;
    for (const r of rows) {
      await trx.execute(sql`
        UPDATE accounts
        SET reserved_balance = GREATEST(reserved_balance - ${r.amount}, 0),
            updated_at = now()
        WHERE user_id = ${r.user_id}
      `);
    }
    return { expired: rows.length };
  });
}
