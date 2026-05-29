/**
 * Commerce merchant cashout (Akış — settlement → crypto).
 *
 * Hard rules §16: reserve amount+fee, callback settles balance + settlement log.
 * K6: USDT methods require explicit commission input (= platform revenue).
 */
import { and, eq, sql } from "drizzle-orm";
import { db, tx } from "../db/client";
import {
  merchantCashoutMethods,
  merchantCashoutSessions,
  merchantSettlementLog,
  merchantUserPermissionOverrides,
  merchants,
} from "../db/schema";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from "../lib/errors";
import { allocPublicNo } from "../lib/public-no";
import { computeFee } from "../lib/fees";
import { writeAudit } from "./admin/audit";

const USDT_PREFIX = "USDT_";

function isUsdtMethod(code: string): boolean {
  return code.toUpperCase().startsWith(USDT_PREFIX);
}

async function assertMerchantCashoutPermission(opts: {
  actorUserId: string;
  merchantUserId: string;
  role: string;
  targetMerchantId: string;
}) {
  if (opts.role === "owner") return;
  const [ov] = await db
    .select({ isAllowed: merchantUserPermissionOverrides.isAllowed })
    .from(merchantUserPermissionOverrides)
    .where(
      and(
        eq(merchantUserPermissionOverrides.merchantUserId, opts.merchantUserId),
        eq(merchantUserPermissionOverrides.permissionKey, "merchant_cashout:create"),
      ),
    )
    .limit(1);
  if (!ov?.isAllowed) throw new ForbiddenError("CASHOUT_PERMISSION_DENIED");
}

async function resolveTargetMerchant(opts: {
  contextMerchantId: string;
  targetMerchantId: string;
}) {
  const [ctx] = await db
    .select({
      id: merchants.id,
      merchantType: merchants.merchantType,
      merchantScope: merchants.merchantScope,
    })
    .from(merchants)
    .where(eq(merchants.id, opts.contextMerchantId))
    .limit(1);
  if (!ctx) throw new NotFoundError("MERCHANT_NOT_FOUND");
  if (ctx.merchantType !== "commerce") throw new ForbiddenError("COMMERCE_ONLY");

  let merchantId = opts.targetMerchantId;
  if (ctx.merchantScope === "parent") {
    const [child] = await db
      .select({ id: merchants.id })
      .from(merchants)
      .where(and(eq(merchants.id, merchantId), eq(merchants.parentMerchantId, ctx.id)))
      .limit(1);
    if (!child) throw new ForbiddenError("CHILD_MERCHANT_REQUIRED");
  } else if (merchantId !== ctx.id) {
    throw new ForbiddenError("MERCHANT_SCOPE_MISMATCH");
  }

  const [m] = await db
    .select({
      id: merchants.id,
      balance: merchants.balance,
      cashoutReservedAmount: merchants.cashoutReservedAmount,
      cashoutCommissionPct: merchants.cashoutCommissionPct,
      cashoutFixedFee: merchants.cashoutFixedFee,
      merchantScope: merchants.merchantScope,
    })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);
  if (!m) throw new NotFoundError("MERCHANT_NOT_FOUND");
  if (m.merchantScope === "parent") {
    throw new ForbiddenError("PARENT_AGGREGATE_CASHOUT_DENIED");
  }
  return m;
}

export async function requestMerchantCashout(opts: {
  actorUserId: string;
  merchantUserId: string;
  role: string;
  contextMerchantId: string;
  merchantId: string;
  methodCode: string;
  amount: number;
  payoutAddress: string;
  commission?: number;
  ip?: string | null;
}) {
  await assertMerchantCashoutPermission({
    actorUserId: opts.actorUserId,
    merchantUserId: opts.merchantUserId,
    role: opts.role,
    targetMerchantId: opts.merchantId,
  });

  const [method] = await db
    .select()
    .from(merchantCashoutMethods)
    .where(eq(merchantCashoutMethods.code, opts.methodCode))
    .limit(1);
  if (!method || !method.isActive) throw new BadRequestError("CASHOUT_METHOD_INACTIVE");

  const minAmt = method.minAmount != null ? Number(method.minAmount) : 0;
  const maxAmt = method.maxAmount != null ? Number(method.maxAmount) : null;
  if (opts.amount < minAmt) throw new BadRequestError("AMOUNT_BELOW_MIN");
  if (maxAmt != null && opts.amount > maxAmt) throw new BadRequestError("AMOUNT_ABOVE_MAX");

  const merchant = await resolveTargetMerchant({
    contextMerchantId: opts.contextMerchantId,
    targetMerchantId: opts.merchantId,
  });

  let fee: number;
  if (isUsdtMethod(opts.methodCode)) {
    if (opts.commission == null || !(opts.commission >= 0)) {
      throw new BadRequestError("COMMISSION_REQUIRED");
    }
    fee = Math.round(opts.commission * 100) / 100;
  } else {
    fee = computeFee({
      amount: opts.amount,
      commissionPct: Number(merchant.cashoutCommissionPct),
      fixedFee: Number(merchant.cashoutFixedFee),
    });
  }

  const total = Math.round((opts.amount + fee) * 100) / 100;
  const available =
    Number(merchant.balance) - Number(merchant.cashoutReservedAmount);
  if (total > available) throw new UnprocessableError("INSUFFICIENT_MERCHANT_BALANCE");

  return tx(async (trx) => {
    const [locked] = await trx.execute<{ id: string; balance: string; cashout_reserved_amount: string }>(sql`
      SELECT id, balance, cashout_reserved_amount
      FROM merchants
      WHERE id = ${merchant.id}
      FOR UPDATE
    `);
    const row = (locked as unknown as Array<{ id: string; balance: string; cashout_reserved_amount: string }>)[0];
    if (!row) throw new NotFoundError("MERCHANT_NOT_FOUND");

    const avail =
      Number(row.balance) - Number(row.cashout_reserved_amount);
    if (total > avail) throw new UnprocessableError("INSUFFICIENT_MERCHANT_BALANCE");

    const publicNo = await allocPublicNo(trx, "MC");
    const merchantRef = `cashout:${publicNo}`;

    const [session] = await trx
      .insert(merchantCashoutSessions)
      .values({
        publicNo,
        merchantId: merchant.id,
        methodCode: opts.methodCode,
        requestedBy: opts.actorUserId,
        amount: String(opts.amount),
        fee: String(fee),
        payoutAddress: opts.payoutAddress,
        status: "pending",
        providerRef: merchantRef,
      })
      .returning({ id: merchantCashoutSessions.id });

    await trx
      .update(merchants)
      .set({
        cashoutReservedAmount: sql`${merchants.cashoutReservedAmount} + ${String(total)}`,
      })
      .where(eq(merchants.id, merchant.id));

    await writeAudit({
      actorId: opts.actorUserId,
      action: "merchant_cashout.request",
      resourceType: "merchant_cashout_session",
      resourceId: session?.id ?? null,
      after: {
        public_no: publicNo,
        merchant_id: merchant.id,
        amount: opts.amount,
        fee,
        platform_revenue: fee,
        method_code: opts.methodCode,
        merchant_ref: merchantRef,
      },
      ip: opts.ip ?? null,
      trx,
    });

    return {
      success: true,
      session_id: session?.id,
      public_no: publicNo,
      merchant_ref: merchantRef,
      fee,
      total_reserved: total,
    };
  });
}

export async function finalizeMerchantCashoutCallback(opts: {
  publicNo?: string;
  merchantRef?: string;
  status: "success" | "failed";
  externalTxId?: string | null;
  failureReason?: string | null;
  actorId?: string | null;
  ip?: string | null;
}) {
  const key = opts.publicNo ?? opts.merchantRef;
  if (!key) throw new BadRequestError("SESSION_KEY_REQUIRED");

  return tx(async (trx) => {
    const whereClause = opts.publicNo
      ? sql`public_no = ${opts.publicNo}`
      : sql`provider_ref = ${opts.merchantRef}`;

    const locked = await trx.execute<{
      id: string;
      public_no: string;
      merchant_id: string;
      amount: string;
      fee: string;
      status: string;
      provider_ref: string | null;
    }>(sql`
      SELECT id, public_no, merchant_id, amount::text, fee::text, status, provider_ref
      FROM merchant_cashout_sessions
      WHERE ${whereClause}
      FOR UPDATE
      LIMIT 1
    `);
    const sRow = (locked as unknown as Array<{
      id: string;
      public_no: string;
      merchant_id: string;
      amount: string;
      fee: string;
      status: string;
      provider_ref: string | null;
    }>)[0];

    if (!sRow) throw new NotFoundError("CASHOUT_SESSION_NOT_FOUND");
    const s = sRow;
    if (s.status === "success" || s.status === "failed" || s.status === "cancelled") {
      return { success: true, idempotent: true, public_no: s.public_no, status: s.status };
    }

    const amount = Number(s.amount);
    const fee = Number(s.fee);
    const total = Math.round((amount + fee) * 100) / 100;

    const [m] = await trx.execute<{ balance: string; cashout_reserved_amount: string }>(sql`
      SELECT balance, cashout_reserved_amount
      FROM merchants
      WHERE id = ${s.merchant_id}
      FOR UPDATE
    `);
    const merch = (m as unknown as Array<{ balance: string; cashout_reserved_amount: string }>)[0];
    if (!merch) throw new NotFoundError("MERCHANT_NOT_FOUND");

    if (opts.status === "success") {
      const balanceBefore = Number(merch.balance);
      const balanceAfter = Math.round((balanceBefore - total) * 100) / 100;
      if (balanceAfter < 0) throw new UnprocessableError("INSUFFICIENT_MERCHANT_BALANCE");

      await trx
        .update(merchants)
        .set({
          balance: String(balanceAfter),
          cashoutReservedAmount: sql`GREATEST(${merchants.cashoutReservedAmount} - ${String(total)}, 0)`,
        })
        .where(eq(merchants.id, s.merchant_id));

      await trx.insert(merchantSettlementLog).values({
        merchantId: s.merchant_id,
        changeAmount: String(-total),
        balanceBefore: String(balanceBefore),
        balanceAfter: String(balanceAfter),
        reason: "merchant_cashout_paid",
        referenceType: "merchant_cashout_session",
        referenceId: s.id,
        notes: JSON.stringify({
          platform_revenue: fee,
          gross_amount: amount,
          public_no: s.public_no,
          external_tx_id: opts.externalTxId ?? null,
        }),
        createdBy: opts.actorId ?? null,
      });

      await trx
        .update(merchantCashoutSessions)
        .set({
          status: "success",
          externalTxId: opts.externalTxId ?? null,
          finalizedAt: new Date(),
          updatedAt: new Date(),
          callbackReceivedAt: new Date(),
        })
        .where(eq(merchantCashoutSessions.id, s.id));
    } else {
      await trx
        .update(merchants)
        .set({
          cashoutReservedAmount: sql`GREATEST(${merchants.cashoutReservedAmount} - ${String(total)}, 0)`,
        })
        .where(eq(merchants.id, s.merchant_id));

      await trx
        .update(merchantCashoutSessions)
        .set({
          status: "failed",
          failureReason: opts.failureReason ?? "provider_failed",
          finalizedAt: new Date(),
          updatedAt: new Date(),
          callbackReceivedAt: new Date(),
        })
        .where(eq(merchantCashoutSessions.id, s.id));
    }

    if (opts.actorId) {
      await writeAudit({
        actorId: opts.actorId,
        action: `merchant_cashout.callback_${opts.status}`,
        resourceType: "merchant_cashout_session",
        resourceId: s.id,
        after: {
          public_no: s.public_no,
          status: opts.status,
          platform_revenue: opts.status === "success" ? fee : 0,
        },
        ip: opts.ip ?? null,
        trx,
      });
    }

    return { success: true, public_no: s.public_no, status: opts.status };
  });
}
