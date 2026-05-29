/**
 * Akış C — Topup sessions + finalize callback.
 *
 * Hard rules:
 *   #1  idempotency via merchant_ref (HMAC layer)
 *   #7  member never sees merchant name → only method_type label
 *   #8  member pays gross = net (no fee deducted from member)
 *   #14 public_no = T-* generated at session creation; inherited by transaction
 *   #15 finance merchant scope (no commerce parent/child here)
 *
 * Lifecycle (status state machine):
 *   pending → awaiting_member_action (after topup-init) → member_confirmed
 *           → success | failed | expired | cancelled
 *
 * One open session per user (DB partial unique). New requests with an active
 * session must wait for it to terminate.
 */
import { addSeconds } from "date-fns";
import { and, eq, sql } from "drizzle-orm";
import { db, tx } from "../db/client";
import {
  accounts,
  merchantSettlementLog,
  merchants,
  paymentRoutingRules,
  topupSessions,
  transactions,
} from "../db/schema";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from "../lib/errors";
import { allocPublicNo, makeTxPublicNo } from "../lib/public-no";
import { env, isProd } from "../lib/env";
import { writeCashPoolDelta } from "./cash-pool";
import { writeProviderLedger } from "./provider-ledger.service";
import { computeFee } from "../lib/fees";

const SESSION_TTL_SEC = 20 * 60;

/** Pick a finance merchant for (method_type) using weighted load balancing. */
async function pickFinanceMerchantForTopup(methodType: string): Promise<{ id: string } | null> {
  const rows = await db.execute<{ merchant_id: string; weight_pct: string }>(sql`
    SELECT r.merchant_id, r.weight_pct
    FROM payment_routing_rules r
    JOIN merchants m ON m.id = r.merchant_id AND m.is_active = TRUE AND m.merchant_type = 'finance'
    WHERE r.is_active = TRUE
      AND r.direction = 'topup'
      AND r.method_type = ${methodType}
  `);
  const list = rows as unknown as Array<{ merchant_id: string; weight_pct: string }>;
  if (list.length === 0) return null;
  const total = list.reduce((s, x) => s + Number(x.weight_pct || 0), 0);
  if (total <= 0) return { id: list[0]!.merchant_id };
  const pick = Math.random() * total;
  let acc = 0;
  for (const r of list) {
    acc += Number(r.weight_pct || 0);
    if (pick <= acc) return { id: r.merchant_id };
  }
  return { id: list[list.length - 1]!.merchant_id };
}

export async function getPendingTopup(userId: string) {
  const [row] = await db
    .select()
    .from(topupSessions)
    .where(
      and(
        eq(topupSessions.userId, userId),
        sql`${topupSessions.status} IN ('pending','awaiting_member_action','member_confirmed','redirected')`,
      ),
    )
    .orderBy(sql`${topupSessions.createdAt} DESC`)
    .limit(1);
  return row ?? null;
}

export interface CreateTopupSessionInput {
  userId: string;
  methodType: string;
  amount: number;
  returnBase?: string | null;
}

/**
 * P0-8 — Validate a member-supplied returnBase against an allow-list so an
 * attacker can't have us redirect-loop them through a phishing host.
 *
 * Allowed in production:
 *   - one of the configured CORS_ORIGINS entries (exact origin match)
 *   - a relative path (server prepends to its own origin)
 *
 * Dev / test keep the loose behaviour so localhost dev servers work.
 */
function safeReturnBase(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;
  if (raw.startsWith("/")) return raw.replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BadRequestError("INVALID_RETURN_BASE");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new BadRequestError("INVALID_RETURN_BASE");
  }
  // Strip trailing slash and any path/search/hash — we add our own.
  const origin = `${parsed.protocol}//${parsed.host}`;
  if (isProd) {
    const corsList = (env.CORS_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!corsList.includes(origin)) {
      throw new BadRequestError("RETURN_BASE_NOT_ALLOWED");
    }
  }
  return origin;
}

export async function createTopupSession(input: CreateTopupSessionInput) {
  if (!(input.amount > 0)) throw new BadRequestError("AMOUNT_INVALID");
  const validatedReturnBase = safeReturnBase(input.returnBase ?? null);

  return tx(async (trx) => {
    // one open session per user
    const open = await trx.execute(sql`
      SELECT 1 FROM topup_sessions
      WHERE user_id = ${input.userId}
        AND status IN ('pending','awaiting_member_action','member_confirmed','redirected')
    `);
    if ((open as unknown as unknown[]).length > 0) {
      throw new ConflictError("TOPUP_IN_PROGRESS");
    }

    const picked = await pickFinanceMerchantForTopup(input.methodType);
    if (!picked) throw new UnprocessableError("NO_AVAILABLE_PROVIDER");

    const publicNo = await allocPublicNo(trx, "T");
    const expiresAt = addSeconds(new Date(), SESSION_TTL_SEC);
    const inserted = await trx
      .insert(topupSessions)
      .values({
        publicNo,
        userId: input.userId,
        merchantId: picked.id,
        methodType: input.methodType,
        amount: String(input.amount),
        status: "pending",
        expiresAt,
        returnUrl: validatedReturnBase
          ? `${validatedReturnBase}/topup/status?ref=${encodeURIComponent(publicNo)}`
          : null,
      })
      .returning();
    const s = inserted[0];
    if (!s) throw new Error("topup session insert failed");
    return s;
  });
}

export async function getTopupSessionStatus(userId: string, sessionId: string) {
  const [s] = await db
    .select()
    .from(topupSessions)
    .where(and(eq(topupSessions.id, sessionId), eq(topupSessions.userId, userId)))
    .limit(1);
  if (!s) throw new NotFoundError("SESSION_NOT_FOUND");
  return s;
}

export async function confirmTopupByMember(userId: string, sessionId: string) {
  return tx(async (trx) => {
    const [s] = await trx
      .select()
      .from(topupSessions)
      .where(and(eq(topupSessions.id, sessionId), eq(topupSessions.userId, userId)))
      .limit(1);
    if (!s) throw new NotFoundError("SESSION_NOT_FOUND");
    if (s.status !== "awaiting_member_action") throw new ConflictError("WRONG_STATUS");
    await trx
      .update(topupSessions)
      .set({ status: "member_confirmed", memberConfirmedAt: new Date(), updatedAt: new Date() })
      .where(eq(topupSessions.id, sessionId));
    return { success: true };
  });
}

export async function cancelTopupByMember(userId: string, sessionId: string) {
  return tx(async (trx) => {
    const [s] = await trx
      .select()
      .from(topupSessions)
      .where(and(eq(topupSessions.id, sessionId), eq(topupSessions.userId, userId)))
      .limit(1);
    if (!s) throw new NotFoundError("SESSION_NOT_FOUND");
    if (!["pending", "awaiting_member_action"].includes(s.status))
      throw new ConflictError("WRONG_STATUS");
    await trx
      .update(topupSessions)
      .set({ status: "cancelled", finalizedAt: new Date(), updatedAt: new Date() })
      .where(eq(topupSessions.id, sessionId));
    return { success: true };
  });
}

export async function setTopupSessionPaymentInfo(input: {
  userId: string;
  sessionId: string;
  iban: string;
  accountHolder: string;
  bankName?: string | null;
  paymentReference?: string | null;
}) {
  return tx(async (trx) => {
    const [s] = await trx
      .select()
      .from(topupSessions)
      .where(and(eq(topupSessions.id, input.sessionId), eq(topupSessions.userId, input.userId)))
      .limit(1);
    if (!s) throw new NotFoundError("SESSION_NOT_FOUND");
    if (!["pending", "awaiting_member_action"].includes(s.status))
      throw new ConflictError("WRONG_STATUS");
    await trx
      .update(topupSessions)
      .set({
        iban: input.iban,
        accountHolder: input.accountHolder,
        bankName: input.bankName ?? null,
        paymentReference: input.paymentReference ?? null,
        status: "awaiting_member_action",
        updatedAt: new Date(),
      })
      .where(eq(topupSessions.id, input.sessionId));
    return { success: true };
  });
}

// ============================================================================
// Callback finalizer — called from /webhooks/merchant/topup-callback (HMAC route)
// ============================================================================
export interface FinalizeTopupCallbackInput {
  merchantId: string;
  internalRef: string; // topup_sessions.id
  merchantRef: string;
  amount: number;
  status: "success" | "failed";
  customerName?: string | null;
  paymentMethodDetail?: string | null;
  externalTxId?: string | null;
  failureReason?: string | null;
  note?: string | null;
}

export interface FinalizeTopupResult {
  topupRequestId: string | null;
  walletTxNo: string | null;
  merchantRef: string;
  externalTxId: string | null;
}

export async function finalizeTopupCallback(
  input: FinalizeTopupCallbackInput,
): Promise<FinalizeTopupResult> {
  return tx(async (trx) => {
    // P0-2 — Lock the session row before the status check + branching. Two
    // concurrent provider callbacks (network duplicate or merchant retry) could
    // previously both pass the `ALREADY_FINALIZED` check on different DB
    // connections and both credit the member. The FOR UPDATE serialises them
    // so the second caller sees the terminal status.
    const [s] = await trx.execute<{
      id: string;
      user_id: string;
      merchant_id: string;
      amount: string;
      status: string;
      public_no: string;
      method_type: string;
    }>(sql`
      SELECT id, user_id, merchant_id, amount, status, public_no, method_type
      FROM topup_sessions WHERE id = ${input.internalRef} FOR UPDATE
    `);
    if (!s) throw new NotFoundError("SESSION_NOT_FOUND");
    if (s.merchant_id !== input.merchantId) throw new ForbiddenError("MERCHANT_MISMATCH");
    // P0-21 — `expired` is not terminal: a late provider callback still credits
    // the member. Only success / failed / cancelled are immutable.
    if (["success", "failed", "cancelled"].includes(s.status))
      throw new ConflictError("ALREADY_FINALIZED");

    await trx
      .update(topupSessions)
      .set({
        callbackReceivedAt: new Date(),
        callbackPayload: input as never,
        merchantRef: input.merchantRef,
        externalTxId: input.externalTxId ?? null,
        updatedAt: new Date(),
      } as never)
      .where(eq(topupSessions.id, s.id));

    if (input.status === "failed") {
      await trx
        .update(topupSessions)
        .set({ status: "failed", finalizedAt: new Date(), updatedAt: new Date() })
        .where(eq(topupSessions.id, s.id));
      return { topupRequestId: null, walletTxNo: null, merchantRef: input.merchantRef, externalTxId: input.externalTxId ?? null };
    }

    // Success — credit member, finance merchant commission accounted on cash_pool side.
    // P0-22 — provider amount is source of truth; session amount is advisory only.
    const sessionAmount = Number(s.amount);
    const creditAmount = input.amount;
    const amountMismatch = sessionAmount !== creditAmount;

    // Read merchant rates without locking — the cash_pool lock will be taken
    // by `writeCashPoolDelta` below so we don't double-lock the row.
    const [m] = await trx.execute<{
      deposit_commission_pct: string | null;
      deposit_fixed_fee: string | null;
    }>(sql`
      SELECT deposit_commission_pct, deposit_fixed_fee
      FROM merchants WHERE id = ${s.merchant_id}
    `);
    // P1 — integer-cent fee math (replaces float Math.round).
    const providerFee = computeFee({
      amount: creditAmount,
      commissionPct: m?.deposit_commission_pct ?? 0,
      fixedFee: m?.deposit_fixed_fee ?? 0,
    });
    const merchantNet = creditAmount - providerFee;

    // P0-2 — lock the member account row before credit so concurrent spend +
    // topup-callback don't interleave their balance updates. We also read the
    // current balance so we can stamp balance_after on the transaction (P0-40).
    const [memAcc] = await trx.execute<{ balance: string }>(sql`
      SELECT balance FROM accounts WHERE user_id = ${s.user_id} FOR UPDATE
    `);
    if (!memAcc) throw new NotFoundError("ACCOUNT_NOT_FOUND");

    // Member balance gross-credit
    await trx.execute(sql`
      UPDATE accounts SET balance = balance + ${String(creditAmount)}, updated_at = now()
      WHERE user_id = ${s.user_id}
    `);
    const memberBalanceAfter = (Number(memAcc.balance) + creditAmount).toFixed(2);

    // Transaction inherits session public_no (single end-to-end ID per hard rule §14)
    const [txn] = await trx
      .insert(transactions)
      .values({
        publicNo: s.public_no,
        userId: s.user_id,
        type: "topup",
        status: "completed",
        amount: String(creditAmount),
        fee: "0", // member: gross == net
        balanceAfter: memberBalanceAfter,
        description: "topup",
        referenceId: s.id,
        merchantRef: input.merchantRef,
        externalTxId: input.externalTxId,
        metadata: {
          merchant_id: s.merchant_id,
          method_type: s.method_type,
          provider_fee: providerFee,
          payment_method_detail: input.paymentMethodDetail ?? null,
          session_amount: s.amount,
          ...(amountMismatch
            ? { amount_mismatch: true, provider_amount: String(creditAmount) }
            : {}),
        },
      })
      .returning({ id: transactions.id });
    if (!txn) throw new Error("tx insert failed");

    // P0-34 — Finance merchant cash_pool: write through the shared helper so
    // we get (a) FOR UPDATE lock, (b) cash_pool column update, (c) cash_pool
    // log row appended — all in one atomic step inside this transaction. The
    // helper is the only sanctioned way to move cash_pool from a service.
    const { balanceBefore: cashPoolBefore, balanceAfter: cashPoolAfter } =
      await writeCashPoolDelta(trx, {
        merchantId: s.merchant_id,
        delta: merchantNet,
        reason: "topup_cash_pool",
        referenceType: "transaction",
        referenceId: txn.id,
        notes: input.merchantRef,
      });

    // P0-33 — Settlement-style log entry for finance merchant (informational
    // shadow of the canonical cash_pool log; values come from the locked row
    // returned by the helper so before/after are truthful).
    await trx.insert(merchantSettlementLog).values({
      merchantId: s.merchant_id,
      changeAmount: String(merchantNet),
      balanceBefore: String(cashPoolBefore),
      balanceAfter: String(cashPoolAfter),
      reason: "topup_cash_pool",
      referenceType: "transaction",
      referenceId: txn.id,
      notes: input.merchantRef,
    });

    // L1 — provider_ledger write via resolver (P0-35 / Q4 Option B). Skips
    // gracefully if the merchant isn't onboarded in `merchant_provider_method_map`
    // (warn logged); finance reconciliation degrades to cash_pool_log.
    await writeProviderLedger(trx, {
      merchantId: s.merchant_id,
      txType: "topup",
      direction: "in",
      amountGross: creditAmount,
      providerCommission: providerFee,
      amountNet: merchantNet,
      status: "success",
      transactionId: txn.id,
      externalRef: input.externalTxId ?? null,
      internalRef: input.merchantRef ?? null,
      userId: s.user_id,
    });

    await trx
      .update(topupSessions)
      .set({
        status: "success",
        ...(amountMismatch ? { amount: String(creditAmount) } : {}),
        finalizedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(topupSessions.id, s.id));

    return {
      topupRequestId: txn.id,
      walletTxNo: s.public_no,
      merchantRef: input.merchantRef,
      externalTxId: input.externalTxId ?? null,
    };
  });
}

/** Cron: expire sessions past expires_at. */
export async function expireStaleTopupSessions(): Promise<{ expired: number }> {
  const res = await db.execute<{ id: string }>(sql`
    UPDATE topup_sessions
    SET status = 'expired', finalized_at = now(), updated_at = now()
    WHERE status IN ('pending','awaiting_member_action','member_confirmed','redirected')
      AND expires_at < now()
    RETURNING id
  `);
  return { expired: (res as unknown as Array<{ id: string }>).length };
}
