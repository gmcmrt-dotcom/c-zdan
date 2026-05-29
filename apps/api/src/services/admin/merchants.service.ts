/**
 * Admin: merchant management — create, rotate secret, set commission/limits,
 * credit_limit, manual settlement, cash pool sync, finance integration test,
 * BO user attach/detach/role.
 */
import { addDays } from "date-fns";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, tx } from "../../db/client";
import {
  merchantApplications,
  merchantCashPoolLog,
  merchantSecretRotations,
  merchantSettlementLog,
  merchantUsers,
  merchants,
  users,
} from "../../db/schema";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from "../../lib/errors";
import { env } from "../../lib/env";
import { computeFee } from "../../lib/fees";
import { withAdminIdempotency } from "./idempotency";
import { hmacSha256Hex, randomToken, sha256Hex } from "../../lib/random";
import { encryptString } from "../../lib/crypto";
import { writeAudit } from "./audit";

const MERCHANT_HMAC_PEPPER = () => {
  const v = env.MERCHANT_HMAC_PEPPER;
  if (!v) throw new BadRequestError("MERCHANT_PEPPER_MISSING");
  return v;
};

function newApiKey(prefix: "tk" | "tk_child" = "tk"): string {
  return `${prefix}_${randomToken(16)}`;
}
function newSigningSecret(): string {
  return randomToken(32);
}
function pepperedHash(secret: string): string {
  return hmacSha256Hex(MERCHANT_HMAC_PEPPER(), secret);
}

export async function listMerchants(opts: { type?: "commerce" | "finance" }) {
  const conds = [] as ReturnType<typeof eq>[];
  if (opts.type) conds.push(eq(merchants.merchantType, opts.type));
  const rows = await db
    .select()
    .from(merchants)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(merchants.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    apiKey: r.apiKey,
    merchantType: r.merchantType,
    scope: r.merchantScope,
    parentMerchantId: r.parentMerchantId,
    isActive: r.isActive,
    balance: Number(r.balance),
    creditLimit: Number(r.creditLimit),
    cashPool: Number(r.cashPool),
    commissionPct: Number(r.commissionPct),
    fixedFee: Number(r.fixedFee),
  }));
}

export async function getMerchantDetail(merchantId: string) {
  const [m] = await db.select().from(merchants).where(eq(merchants.id, merchantId)).limit(1);
  if (!m) throw new NotFoundError("MERCHANT_NOT_FOUND");
  return m;
}

export async function merchantChildren(parentId: string) {
  const rows = await db.select().from(merchants).where(eq(merchants.parentMerchantId, parentId));
  return rows;
}

export async function adminCreateMerchant(opts: {
  actorId: string;
  name: string;
  type: "commerce" | "finance";
  commissionPct?: number | null;
  fixedFee?: number | null;
  notes?: string | null;
  ipWhitelist?: string[] | null;
  perTxLimit?: number | null;
  dailyLimit?: number | null;
  depositMin?: number | null;
  depositMax?: number | null;
  withdrawMin?: number | null;
  withdrawMax?: number | null;
  ip?: string | null;
}) {
  if (!opts.name?.trim()) throw new BadRequestError("NAME_REQUIRED");
  if (opts.type !== "commerce" && opts.type !== "finance") {
    throw new BadRequestError("INVALID_MERCHANT_TYPE");
  }
  const apiKey = newApiKey();
  const signingSecret = newSigningSecret();
  const apiSecret = randomToken(32);
  const apiSecretHash = pepperedHash(apiSecret);
  const numOrNull = (v: number | null | undefined) =>
    v == null || Number.isNaN(Number(v)) ? null : String(v);
  // P0-12 — write the encrypted column and clear the plaintext column on new
  // merchants. Existing rows continue to read the plaintext column until they
  // are re-saved (backfill).
  const signingSecretEncrypted = encryptString(signingSecret);
  const [m] = await db
    .insert(merchants)
    .values({
      name: opts.name.trim(),
      apiKey,
      apiSecretHash,
      signingSecret: null,
      signingSecretEncrypted,
      signingSecretSetAt: new Date(),
      merchantType: opts.type,
      commissionPct: String(opts.commissionPct ?? 0),
      fixedFee: String(opts.fixedFee ?? 0),
      isActive: true,
      merchantScope: "standalone",
      ipWhitelist: opts.ipWhitelist ?? [],
      perTxLimit: numOrNull(opts.perTxLimit),
      dailyLimit: numOrNull(opts.dailyLimit),
      depositMinAmount: numOrNull(opts.depositMin),
      depositMaxAmount: numOrNull(opts.depositMax),
      withdrawMinAmount: numOrNull(opts.withdrawMin),
      withdrawMaxAmount: numOrNull(opts.withdrawMax),
      notes: opts.notes ?? null,
      createdBy: opts.actorId,
    })
    .returning({ id: merchants.id });
  if (!m) throw new Error("merchant insert failed");
  await writeAudit({
    actorId: opts.actorId,
    action: "merchant.create",
    resourceType: "merchant",
    resourceId: m.id,
    after: { name: opts.name, type: opts.type },
    ip: opts.ip ?? null,
  });
  return { id: m.id, apiKey, apiSecret, signingSecret };
}

export async function adminRotateMerchantSecret(opts: {
  actorId: string;
  merchantId: string;
  ip?: string | null;
  reason?: string | null;
}) {
  const newSecret = newSigningSecret();
  // P0-12 — write encrypted, clear plaintext, audit + write rotation history.
  // P1 — ALSO null out `apiSecretHash` so the legacy `x-api-secret` header
  // path (kept for back-compat with un-migrated merchants) is fully
  // invalidated on rotation. Without this, an attacker who captured the old
  // api_secret hash equivalent could keep authenticating via the legacy
  // route even after the merchant rotated their signing_secret.
  const signingSecretEncrypted = encryptString(newSecret);
  await tx(async (trx) => {
    const [m] = await trx
      .select({ id: merchants.id })
      .from(merchants)
      .where(eq(merchants.id, opts.merchantId))
      .limit(1);
    if (!m) throw new NotFoundError("MERCHANT_NOT_FOUND");
    // Generate a random hash that no merchant secret can match → legacy
    // x-api-secret path is permanently dead for this merchant after rotate.
    // (The column is NOT NULL so we replace rather than null out.)
    const deadHash = pepperedHash(randomToken(32));
    await trx
      .update(merchants)
      .set({
        signingSecret: null,
        signingSecretEncrypted,
        signingSecretSetAt: new Date(),
        apiSecretHash: deadHash,
      })
      .where(eq(merchants.id, opts.merchantId));
    await trx.insert(merchantSecretRotations).values({
      merchantId: opts.merchantId,
      rotatedBy: opts.actorId,
      reason: opts.reason ?? null,
      ip: opts.ip ?? null,
    });
    await writeAudit({
      actorId: opts.actorId,
      action: "merchant.rotate_secret",
      resourceType: "merchant",
      resourceId: opts.merchantId,
      ip: opts.ip ?? null,
    });
  });
  return { signingSecret: newSecret };
}

export async function setMerchantCommission(opts: {
  actorId: string;
  merchantId: string;
  commissionPct: number;
  fixedFee: number;
  ip?: string | null;
}) {
  await db
    .update(merchants)
    .set({
      commissionPct: String(opts.commissionPct),
      fixedFee: String(opts.fixedFee),
    })
    .where(eq(merchants.id, opts.merchantId));
  await writeAudit({
    actorId: opts.actorId,
    action: "merchant.set_commission",
    resourceType: "merchant",
    resourceId: opts.merchantId,
    after: { commissionPct: opts.commissionPct, fixedFee: opts.fixedFee },
    ip: opts.ip ?? null,
  });
  return { success: true };
}

export async function setMerchantLimits(opts: {
  actorId: string;
  merchantId: string;
  perTxLimit?: number | null;
  dailyLimit?: number | null;
  depositMin?: number | null;
  depositMax?: number | null;
  withdrawMin?: number | null;
  withdrawMax?: number | null;
  ip?: string | null;
}) {
  await db
    .update(merchants)
    .set({
      perTxLimit: opts.perTxLimit == null ? null : String(opts.perTxLimit),
      dailyLimit: opts.dailyLimit == null ? null : String(opts.dailyLimit),
      depositMinAmount: opts.depositMin == null ? null : String(opts.depositMin),
      depositMaxAmount: opts.depositMax == null ? null : String(opts.depositMax),
      withdrawMinAmount: opts.withdrawMin == null ? null : String(opts.withdrawMin),
      withdrawMaxAmount: opts.withdrawMax == null ? null : String(opts.withdrawMax),
    })
    .where(eq(merchants.id, opts.merchantId));
  await writeAudit({
    actorId: opts.actorId,
    action: "merchant.set_limits",
    resourceType: "merchant",
    resourceId: opts.merchantId,
    after: opts as never,
    ip: opts.ip ?? null,
  });
  return { success: true };
}

export async function setCreditLimit(opts: {
  actorId: string;
  merchantId: string;
  newLimit: number;
  reason: string;
  ip?: string | null;
}) {
  if (opts.newLimit < 0) throw new BadRequestError("LIMIT_NEGATIVE");
  if (!opts.reason?.trim()) throw new BadRequestError("REASON_REQUIRED");
  return tx(async (trx) => {
    const [m] = await trx
      .select({ balance: merchants.balance, creditLimit: merchants.creditLimit })
      .from(merchants)
      .where(eq(merchants.id, opts.merchantId))
      .limit(1);
    if (!m) throw new NotFoundError("MERCHANT_NOT_FOUND");
    if (Number(m.balance) < -opts.newLimit)
      throw new UnprocessableError("BALANCE_BELOW_LIMIT");
    await trx
      .update(merchants)
      .set({ creditLimit: String(opts.newLimit) })
      .where(eq(merchants.id, opts.merchantId));
    await writeAudit({
      actorId: opts.actorId,
      action: "merchant.set_credit_limit",
      resourceType: "merchant",
      resourceId: opts.merchantId,
      before: { creditLimit: Number(m.creditLimit) },
      after: { creditLimit: opts.newLimit },
      metadata: { reason: opts.reason },
      ip: opts.ip ?? null,
    });
    return { success: true };
  });
}

export async function recordManualSettlement(opts: {
  actorId: string;
  merchantId: string;
  amount: number;
  notes?: string | null;
  ip?: string | null;
  /** H4 — Optional idempotency key for the admin BO. */
  idempotencyKey?: string | null;
}) {
  if (opts.amount === 0) throw new BadRequestError("AMOUNT_ZERO");
  return tx(async (trx) =>
    withAdminIdempotency(
      trx,
      { actorId: opts.actorId, action: "merchant.manual_settlement", key: opts.idempotencyKey ?? null },
      async () => {
    const [m] = await trx
      .select({ balance: merchants.balance, creditLimit: merchants.creditLimit })
      .from(merchants)
      .where(eq(merchants.id, opts.merchantId))
      .limit(1);
    if (!m) throw new NotFoundError("MERCHANT_NOT_FOUND");
    const balanceBefore = Number(m.balance);
    const balanceAfter = balanceBefore + opts.amount;
    if (balanceAfter < -Number(m.creditLimit))
      throw new UnprocessableError("WOULD_BREACH_CREDIT_LIMIT");
    await trx
      .update(merchants)
      .set({ balance: String(balanceAfter) })
      .where(eq(merchants.id, opts.merchantId));
    const [row] = await trx
      .insert(merchantSettlementLog)
      .values({
        merchantId: opts.merchantId,
        changeAmount: String(opts.amount),
        balanceBefore: String(balanceBefore),
        balanceAfter: String(balanceAfter),
        reason: "manual_settlement",
        referenceType: "manual",
        notes: opts.notes ?? null,
        createdBy: opts.actorId,
      })
      .returning({ id: merchantSettlementLog.id });
    // log_id is bigserial → BigInt in JS; coerce to string for jsonb safety
    const logId = row?.id != null ? String(row.id) : null;
    await writeAudit({
      actorId: opts.actorId,
      action: "merchant.manual_settlement",
      resourceType: "merchant",
      resourceId: opts.merchantId,
      metadata: { amount: opts.amount, notes: opts.notes ?? null, log_id: logId },
      ip: opts.ip ?? null,
    });
        return { success: true as const, logId };
      },
    ),
  );
}

export async function adjustCashPool(opts: {
  actorId: string;
  merchantId: string;
  amount: number;
  reason: string;
  note?: string | null;
  collectionFeePct?: number | null;
  collectionFixedFee?: number | null;
  ip?: string | null;
  /** H4 — Optional idempotency key for the admin BO. */
  idempotencyKey?: string | null;
}) {
  if (opts.amount === 0) throw new BadRequestError("AMOUNT_ZERO");
  if (!opts.reason?.trim()) throw new BadRequestError("REASON_REQUIRED");
  return tx(async (trx) =>
    withAdminIdempotency(
      trx,
      { actorId: opts.actorId, action: "merchant.cash_pool_adjust", key: opts.idempotencyKey ?? null },
      async () => {
    const [m] = await trx
      .select({ cashPool: merchants.cashPool, merchantType: merchants.merchantType })
      .from(merchants)
      .where(eq(merchants.id, opts.merchantId))
      .limit(1);
    if (!m) throw new NotFoundError("MERCHANT_NOT_FOUND");
    if (m.merchantType !== "finance") throw new ForbiddenError("WRONG_MERCHANT_TYPE");
    const before = Number(m.cashPool);
    const after = before + opts.amount;
    if (after < 0) throw new UnprocessableError("CASH_POOL_NEGATIVE");
    // P1 — integer-cent fee math (replaces float Math.round).
    const feeMajor = computeFee({
      amount: Math.abs(opts.amount),
      commissionPct: opts.collectionFeePct ?? 0,
      fixedFee: opts.collectionFixedFee ?? 0,
    });
    const feeAmount = feeMajor || null;
    await trx
      .update(merchants)
      .set({ cashPool: String(after), cashPoolUpdatedAt: new Date() })
      .where(eq(merchants.id, opts.merchantId));
    const [log] = await trx
      .insert(merchantCashPoolLog)
      .values({
        merchantId: opts.merchantId,
        changeAmount: String(opts.amount),
        balanceBefore: String(before),
        balanceAfter: String(after),
        reason: opts.reason,
        // `note` column was dropped (mig 0005) — fold into the kept `notes`.
        notes: opts.note ?? null,
        collectionFeePct: opts.collectionFeePct == null ? null : String(opts.collectionFeePct),
        collectionFixedFee:
          opts.collectionFixedFee == null ? null : String(opts.collectionFixedFee),
        collectionFeeAmount: feeAmount == null ? null : String(feeAmount),
        createdBy: opts.actorId,
      })
      .returning({ id: merchantCashPoolLog.id });
    const logId = log?.id != null ? String(log.id) : null;
    await writeAudit({
      actorId: opts.actorId,
      action: "merchant.cash_pool_adjust",
      resourceType: "merchant",
      resourceId: opts.merchantId,
      metadata: { amount: opts.amount, reason: opts.reason, log_id: logId },
      ip: opts.ip ?? null,
    });
        return { success: true as const, logId };
      },
    ),
  );
}

export async function setCashPool(opts: {
  actorId: string;
  merchantId: string;
  cashPool: number;
  notes?: string | null;
  ip?: string | null;
  /** H4 — Optional idempotency key for the admin BO. */
  idempotencyKey?: string | null;
}) {
  if (opts.cashPool < 0) throw new BadRequestError("CASH_POOL_NEGATIVE");
  return tx(async (trx) =>
    withAdminIdempotency(
      trx,
      { actorId: opts.actorId, action: "merchant.cash_pool_set", key: opts.idempotencyKey ?? null },
      async () => {
    const [m] = await trx
      .select({ cashPool: merchants.cashPool })
      .from(merchants)
      .where(eq(merchants.id, opts.merchantId))
      .limit(1);
    if (!m) throw new NotFoundError("MERCHANT_NOT_FOUND");
    const before = Number(m.cashPool);
    const delta = opts.cashPool - before;
    await trx
      .update(merchants)
      .set({ cashPool: String(opts.cashPool), cashPoolUpdatedAt: new Date() })
      .where(eq(merchants.id, opts.merchantId));
    if (delta !== 0) {
      await trx.insert(merchantCashPoolLog).values({
        merchantId: opts.merchantId,
        changeAmount: String(delta),
        balanceBefore: String(before),
        balanceAfter: String(opts.cashPool),
        reason: "admin_set_cash_pool",
        notes: opts.notes ?? null,
        createdBy: opts.actorId,
      });
    }
    await writeAudit({
      actorId: opts.actorId,
      action: "merchant.set_cash_pool",
      resourceType: "merchant",
      resourceId: opts.merchantId,
      before: { cashPool: before },
      after: { cashPool: opts.cashPool },
      ip: opts.ip ?? null,
    });
        return { success: true as const };
      },
    ),
  );
}

export async function attachMerchantUser(opts: {
  actorId: string;
  merchantId: string;
  email: string;
  role: "owner" | "accountant" | "read_only";
  fullName?: string | null;
  phone?: string | null;
  ip?: string | null;
}) {
  const lower = opts.email.toLowerCase();
  return tx(async (trx) => {
    const [existingUser] = await trx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${lower}`)
      .limit(1);
    const [dup] = await trx
      .select({ id: merchantUsers.id })
      .from(merchantUsers)
      .where(
        and(
          eq(merchantUsers.merchantId, opts.merchantId),
          sql`lower(${merchantUsers.email}) = ${lower}`,
        ),
      )
      .limit(1);
    if (dup) throw new ConflictError("ALREADY_ATTACHED");
    const [row] = await trx
      .insert(merchantUsers)
      .values({
        merchantId: opts.merchantId,
        userId: existingUser?.id ?? null,
        email: lower,
        fullName: opts.fullName ?? null,
        phone: opts.phone ?? null,
        role: opts.role,
        isActive: true,
      })
      .returning({ id: merchantUsers.id });
    await writeAudit({
      actorId: opts.actorId,
      action: "merchant.attach_user",
      resourceType: "merchant",
      resourceId: opts.merchantId,
      metadata: { email: lower, role: opts.role, merchant_user_id: row?.id },
      ip: opts.ip ?? null,
    });
    return { success: true, merchantUserId: row?.id ?? null, requiresSignup: !existingUser };
  });
}

export async function detachMerchantUser(opts: {
  actorId: string;
  merchantUserId: string;
  /**
   * H6 — Scope check. When supplied, the service refuses to detach a
   * merchant_user that doesn't belong to this merchant id. The admin BO
   * page that shows "users for merchant X" passes the merchantId so a
   * crafted request with another merchant's `merchantUserId` cannot
   * mutate it. When null/undefined, the caller is trusted (legacy path).
   */
  merchantId?: string | null;
  ip?: string | null;
}) {
  // H6 — Verify the target row exists AND belongs to the merchant the
  // actor is scoping to. NotFound rather than Forbidden so we don't
  // confirm the row's existence for an unscoped caller.
  const [target] = await db
    .select({ id: merchantUsers.id, merchantId: merchantUsers.merchantId })
    .from(merchantUsers)
    .where(eq(merchantUsers.id, opts.merchantUserId))
    .limit(1);
  if (!target) throw new NotFoundError("MERCHANT_USER_NOT_FOUND");
  if (opts.merchantId && target.merchantId !== opts.merchantId) {
    throw new NotFoundError("MERCHANT_USER_NOT_FOUND");
  }
  await db
    .update(merchantUsers)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(merchantUsers.id, opts.merchantUserId));
  await writeAudit({
    actorId: opts.actorId,
    action: "merchant.detach_user",
    resourceType: "merchant_user",
    resourceId: opts.merchantUserId,
    metadata: { merchantId: target.merchantId },
    ip: opts.ip ?? null,
  });
  return { success: true };
}

export async function changeMerchantUserRole(opts: {
  actorId: string;
  merchantUserId: string;
  newRole: "owner" | "accountant" | "read_only";
  /** H6 — Same scope check as detachMerchantUser. */
  merchantId?: string | null;
  ip?: string | null;
}) {
  const [target] = await db
    .select({ id: merchantUsers.id, merchantId: merchantUsers.merchantId })
    .from(merchantUsers)
    .where(eq(merchantUsers.id, opts.merchantUserId))
    .limit(1);
  if (!target) throw new NotFoundError("MERCHANT_USER_NOT_FOUND");
  if (opts.merchantId && target.merchantId !== opts.merchantId) {
    throw new NotFoundError("MERCHANT_USER_NOT_FOUND");
  }
  await db
    .update(merchantUsers)
    .set({ role: opts.newRole, updatedAt: new Date() })
    .where(eq(merchantUsers.id, opts.merchantUserId));
  await writeAudit({
    actorId: opts.actorId,
    action: "merchant.change_role",
    resourceType: "merchant_user",
    resourceId: opts.merchantUserId,
    metadata: { merchantId: target.merchantId },
    after: { role: opts.newRole },
    ip: opts.ip ?? null,
  });
  return { success: true };
}

export async function listFinanceMerchants() {
  return listMerchants({ type: "finance" });
}

export async function getMerchantFinancialSummary(opts: {
  merchantId: string;
  startDate: string;
  endDate: string;
}) {
  const [row] = await db.execute<{
    spend_count: number;
    spend_amount: string;
    credit_count: number;
    credit_amount: string;
    settlement_delta: string;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM transactions WHERE metadata->>'merchant_id' = ${opts.merchantId} AND type='spend' AND created_at BETWEEN ${opts.startDate}::timestamptz AND ${opts.endDate}::timestamptz) AS spend_count,
      COALESCE((SELECT sum(amount)::text FROM transactions WHERE metadata->>'merchant_id' = ${opts.merchantId} AND type='spend' AND created_at BETWEEN ${opts.startDate}::timestamptz AND ${opts.endDate}::timestamptz),'0') AS spend_amount,
      (SELECT count(*)::int FROM transactions WHERE metadata->>'merchant_id' = ${opts.merchantId} AND type='merchant_credit' AND created_at BETWEEN ${opts.startDate}::timestamptz AND ${opts.endDate}::timestamptz) AS credit_count,
      COALESCE((SELECT sum(amount)::text FROM transactions WHERE metadata->>'merchant_id' = ${opts.merchantId} AND type='merchant_credit' AND created_at BETWEEN ${opts.startDate}::timestamptz AND ${opts.endDate}::timestamptz),'0') AS credit_amount,
      COALESCE((SELECT sum(change_amount)::text FROM merchant_settlement_log WHERE merchant_id = ${opts.merchantId} AND created_at BETWEEN ${opts.startDate}::timestamptz AND ${opts.endDate}::timestamptz),'0') AS settlement_delta
  `);
  return row;
}
