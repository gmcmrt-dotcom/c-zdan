/**
 * Akış B — `credit_member` (member self-transfer from commerce merchant balance
 * into wallet).
 *
 * Hard rules:
 *   #1   idempotency via merchant_ref (handled upstream in HMAC layer)
 *   #8.1 net merchant ledger: merchant.balance -= (amount + fee)
 *   #11  atomic check (Flow B only): amount + fee <= balance + credit_limit
 *        — overdraft ceiling when settlement book is insufficient; not a
 *        general withdrawable pool. Else INSUFFICIENT_MERCHANT_BALANCE.
 *        SELECT FOR UPDATE on merchant.
 *   #15  child id for accounting; parent never accrues directly
 *   #14  public_no = C-* via shared generator
 */
import { eq, sql } from "drizzle-orm";
import { db, tx } from "../db/client";
import {
  accounts,
  merchantSettlementLog,
  merchants,
  profiles,
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
import { computeFee } from "../lib/fees";

export interface CreditMemberInput {
  merchantId: string;
  walletNo: string;
  customerName: string;
  amount: number;
  merchantRef: string | null;
  note?: string | null;
}

export interface CreditMemberResult {
  transactionId: string;
  walletTxNo: string;
  newMemberBalance: number;
  merchantOutstanding: number;
}

function normalizeName(s: string): string {
  return s.trim().toLocaleLowerCase("tr-TR");
}

export async function creditMember(input: CreditMemberInput): Promise<CreditMemberResult> {
  if (!input.walletNo) throw new BadRequestError("WALLET_NO_REQUIRED");
  if (!input.customerName?.trim()) throw new BadRequestError("NAME_REQUIRED");
  if (!(input.amount > 0)) throw new BadRequestError("AMOUNT_INVALID");

  return tx(async (trx) => {
    // 1. Lock merchant row, recompute fee
    const [m] = await trx.execute<Record<string, unknown>>(sql`
      SELECT id, merchant_type, commission_pct, fixed_fee, balance, credit_limit, scope_marker
      FROM (
        SELECT id, merchant_type, commission_pct, fixed_fee, balance, credit_limit, merchant_scope AS scope_marker
        FROM merchants WHERE id = ${input.merchantId} FOR UPDATE
      ) s
    `);
    const mr = m as unknown as
      | {
          id: string;
          merchant_type: "commerce" | "finance";
          commission_pct: string;
          fixed_fee: string;
          balance: string;
          credit_limit: string;
          scope_marker: string | null;
        }
      | undefined;
    if (!mr) throw new NotFoundError("MERCHANT_NOT_FOUND");
    if (mr.merchant_type !== "commerce") throw new ForbiddenError("WRONG_MERCHANT_TYPE");
    // P1 — HARD_RULES #15: parent merchants are integration aggregates;
    // accounting must hit a child row, never the parent.
    if (mr.scope_marker === "parent") throw new ForbiddenError("PARENT_MERCHANT_NOT_ALLOWED");

    // P1 — integer-cent fee math (replaces float Math.round).
    const fee = computeFee({ amount: input.amount, commissionPct: mr.commission_pct, fixedFee: mr.fixed_fee });
    const totalDebit = input.amount + fee;
    const available = Number(mr.balance) + Number(mr.credit_limit);
    if (totalDebit > available) throw new UnprocessableError("INSUFFICIENT_MERCHANT_BALANCE");

    // 2. Resolve member by member_no; verify name matches
    const [p] = await trx
      .select({
        id: profiles.id,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        isFrozen: profiles.isFrozen,
      })
      .from(profiles)
      .where(eq(profiles.memberNo, input.walletNo))
      .limit(1);
    if (!p) throw new NotFoundError("MEMBER_NOT_FOUND");
    if (p.isFrozen) throw new ForbiddenError("MEMBER_FROZEN");
    const fullName = normalizeName(`${p.firstName} ${p.lastName}`);
    if (fullName !== normalizeName(input.customerName)) {
      throw new UnprocessableError("NAME_MISMATCH");
    }

    // 3. Apply: merchant balance -= total, member balance += amount.
    // P0-2 / P0-40 — lock the member account row AND read current balance so
    // we can stamp balance_after on the transaction row. Without the read we
    // could only approximate, which is useless for dispute reconciliation.
    const [memAcc] = await trx.execute<{ balance: string }>(sql`
      SELECT balance FROM accounts WHERE user_id = ${p.id} FOR UPDATE
    `);
    if (!memAcc) throw new NotFoundError("ACCOUNT_NOT_FOUND");

    const balanceBefore = Number(mr.balance);
    const balanceAfter = balanceBefore - totalDebit;
    await trx.execute(sql`
      UPDATE merchants SET balance = ${String(balanceAfter)} WHERE id = ${input.merchantId}
    `);
    await trx.execute(sql`
      UPDATE accounts
      SET balance = balance + ${String(input.amount)}, updated_at = now()
      WHERE user_id = ${p.id}
    `);
    const memberBalanceAfter = (Number(memAcc.balance) + input.amount).toFixed(2);

    // 4. Transaction row (member-facing — no merchant name leaked here)
    const publicNo = await makeTxPublicNo(trx, "merchant_credit");
    const [txn] = await trx
      .insert(transactions)
      .values({
        publicNo,
        userId: p.id,
        type: "merchant_credit",
        status: "completed",
        amount: String(input.amount),
        fee: "0", // member always sees gross
        balanceAfter: memberBalanceAfter,
        description: "merchant_credit",
        metadata: {
          merchant_id: input.merchantId,
          merchant_fee: fee,
          merchant_ref: input.merchantRef,
          note: input.note ?? null,
        },
        merchantRef: input.merchantRef,
      })
      .returning({ id: transactions.id });
    if (!txn) throw new Error("transaction insert failed");

    // 5. Settlement log
    await trx.insert(merchantSettlementLog).values({
      merchantId: input.merchantId,
      changeAmount: String(-totalDebit),
      balanceBefore: String(balanceBefore),
      balanceAfter: String(balanceAfter),
      reason: "merchant_credit",
      referenceType: "transaction",
      referenceId: txn.id,
      notes: input.merchantRef ?? null,
    });

    // 6. Read fresh member balance for response
    const [acc] = await trx
      .select({ balance: accounts.balance })
      .from(accounts)
      .where(eq(accounts.userId, p.id))
      .limit(1);

    return {
      transactionId: txn.id,
      walletTxNo: publicNo,
      newMemberBalance: Number(acc?.balance ?? 0),
      merchantOutstanding: balanceAfter < 0 ? Math.abs(balanceAfter) : 0,
    };
  });
}
