/**
 * Public merchant API (HMAC).
 *
 * All routes use `express.raw()` instead of `express.json()` because HMAC is
 * computed over the raw request body. The merchantHmac middleware parses the
 * Buffer into JSON only after the signature has been verified, and writes the
 * response via ctx.respond() to ensure audit + idempotency caching happen.
 */
import { Router, raw } from "express";
import rateLimit from "express-rate-limit";
import { ZodError, z } from "zod";
import { merchantHmac } from "../lib/merchant-hmac";
import { consumePaymentCode } from "../services/payment-code.service";
import { creditMember } from "../services/merchant-credit.service";
import { finalizeTopupCallback } from "../services/topup.service";
import { finalizeWithdrawCallback } from "../services/withdraw.service";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";
import { isTest } from "../lib/env";

export const merchantPublicRouter = Router();

// Raw body for HMAC across all merchant-api routes
merchantPublicRouter.use(raw({ type: "application/json", limit: "1mb" }));

// P0-15 — per-IP burst limiter for merchant-api. Business-level per-merchant
// throughput is enforced by per_tx_limit/daily_limit; this is a coarse defence
// against unauthenticated flooding (bad keys filling merchant_api_calls).
// Keyed by the merchant key header when present, otherwise IP, so a single
// merchant's noisy integration cannot starve a noisy IP neighbour.
merchantPublicRouter.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest,
    keyGenerator: (req) => {
      const key = (req.headers["x-merchant-key"] as string | undefined)
        ?? (req.headers["x-api-key"] as string | undefined);
      return key ? `mkey:${key}` : `ip:${req.ip}`;
    },
    handler: (_req, res) => {
      res.status(429).json({ success: false, error_code: "MERCHANT_API_RATE_LIMIT" });
    },
  }),
);

/** Convert any thrown error into the merchant-API envelope shape. */
function appErrorToCode(err: unknown): { status: number; code: string } {
  if (err instanceof AppError) return { status: err.statusCode, code: err.errorCode };
  if (err instanceof ZodError) return { status: 400, code: "BAD_BODY" };
  logger.error({ err }, "merchant-api: unexpected error");
  return { status: 500, code: "INTERNAL" };
}

// ============ Akış A — consume payment code ============
const ChargeBody = z.object({
  code: z.string().regex(/^\d{8}$/),
  amount: z.coerce.number().positive(),
  customer_name: z.string().min(1),
  note: z.string().optional(),
});

merchantPublicRouter.post("/charge", merchantHmac("merchant-charge"), async (req, _res, _next) => {
  const ctx = req.merchantCtx!;
  try {
    // P0-4 — HARD_RULES #1: every merchant call must carry x-merchant-ref so
    // idempotency works. Returning early before the service runs prevents a
    // duplicate-charge race that would otherwise hit a non-deduplicated path.
    if (!ctx.merchantRef) {
      await ctx.respond(
        400,
        { success: false, error_code: "MERCHANT_REF_REQUIRED" },
        "MERCHANT_REF_REQUIRED",
      );
      return;
    }
    const body = ChargeBody.parse(ctx.body);
    const out = await consumePaymentCode({
      code: body.code,
      amount: body.amount,
      customerName: body.customer_name,
      merchantId: ctx.merchant.id,
      merchantRef: ctx.merchantRef,
      note: body.note ?? null,
    });
    await ctx.respond(200, {
      success: true,
      transaction_id: out.transactionId,
      wallet_tx_no: out.walletTxNo,
      merchant_ref: ctx.merchantRef,
      points_awarded: out.pointsAwarded,
    });
  } catch (err) {
    const { status, code } = appErrorToCode(err);
    await ctx.respond(status, { success: false, error_code: code }, code);
  }
});

// ============ Akış B — credit member ============
const CreditBody = z.object({
  wallet_no: z.string().min(1),
  customer_name: z.string().min(1),
  amount: z.coerce.number().positive(),
  note: z.string().optional(),
});

merchantPublicRouter.post("/credit", merchantHmac("merchant-credit"), async (req, _res) => {
  const ctx = req.merchantCtx!;
  try {
    // P0-4 — see /charge above. Flow B requires merchant_ref by HARD_RULES #1.
    if (!ctx.merchantRef) {
      await ctx.respond(
        400,
        { success: false, error_code: "MERCHANT_REF_REQUIRED" },
        "MERCHANT_REF_REQUIRED",
      );
      return;
    }
    const body = CreditBody.parse(ctx.body);
    const out = await creditMember({
      merchantId: ctx.merchant.id,
      walletNo: body.wallet_no,
      customerName: body.customer_name,
      amount: body.amount,
      merchantRef: ctx.merchantRef,
      note: body.note ?? null,
    });
    await ctx.respond(200, {
      success: true,
      transaction_id: out.transactionId,
      wallet_tx_no: out.walletTxNo,
      merchant_ref: ctx.merchantRef,
      new_member_balance: out.newMemberBalance,
      merchant_outstanding: out.merchantOutstanding,
    });
  } catch (err) {
    const { status, code } = appErrorToCode(err);
    await ctx.respond(status, { success: false, error_code: code }, code);
  }
});

// ============ Legacy aliases ============
const DepositBody = z.object({
  member_no: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  amount: z.coerce.number().positive(),
  external_ref: z.string().optional(),
});
merchantPublicRouter.post(
  "/deposit",
  merchantHmac("merchant-deposit", { allowLegacy: true }),
  async (req, _res) => {
    const ctx = req.merchantCtx!;
    try {
      const body = DepositBody.parse(ctx.body);
      const out = await creditMember({
        merchantId: ctx.merchant.id,
        walletNo: body.member_no,
        customerName: `${body.first_name} ${body.last_name}`,
        amount: body.amount,
        merchantRef: ctx.merchantRef ?? body.external_ref ?? null,
      });
      await ctx.respond(200, {
        success: true,
        transaction_id: out.transactionId,
        wallet_tx_no: out.walletTxNo,
        merchant_ref: ctx.merchantRef,
        new_member_balance: out.newMemberBalance,
        merchant_outstanding: out.merchantOutstanding,
        deprecation: "Use POST /merchant-api/credit instead",
      });
    } catch (err) {
      const { status, code } = appErrorToCode(err);
      await ctx.respond(status, { success: false, error_code: code }, code);
    }
  },
);

merchantPublicRouter.post(
  "/withdraw",
  merchantHmac("merchant-withdraw", { allowLegacy: true }),
  async (req, _res) => {
    const ctx = req.merchantCtx!;
    await ctx.respond(403, { success: false, error_code: "DEPRECATED_ENDPOINT" }, "DEPRECATED_ENDPOINT");
  },
);

// ============ Akış C callback ============
const TopupCallback = z.object({
  internal_ref: z.string().uuid(),
  merchant_ref: z.string(),
  amount: z.coerce.number().positive(),
  status: z.enum(["success", "failed"]),
  customer_name: z.string().optional(),
  payment_method_detail: z.string().optional(),
  external_tx_id: z.string().optional(),
  failure_reason: z.string().optional(),
  note: z.string().optional(),
});
merchantPublicRouter.post(
  "/topup-callback",
  merchantHmac("merchant-topup-callback"),
  async (req, _res) => {
    const ctx = req.merchantCtx!;
    try {
      const body = TopupCallback.parse(ctx.body);
      const out = await finalizeTopupCallback({
        merchantId: ctx.merchant.id,
        internalRef: body.internal_ref,
        merchantRef: body.merchant_ref,
        amount: body.amount,
        status: body.status,
        customerName: body.customer_name ?? null,
        paymentMethodDetail: body.payment_method_detail ?? null,
        externalTxId: body.external_tx_id ?? null,
        failureReason: body.failure_reason ?? null,
        note: body.note ?? null,
      });
      await ctx.respond(200, {
        success: true,
        topup_request_id: out.topupRequestId,
        wallet_tx_no: out.walletTxNo,
        merchant_ref: out.merchantRef,
        external_tx_id: out.externalTxId,
      });
    } catch (err) {
      const { status, code } = appErrorToCode(err);
      await ctx.respond(status, { success: false, error_code: code }, code);
    }
  },
);

// ============ Akış D callback ============
const WithdrawCallback = z.object({
  internal_ref: z.string().uuid(),
  merchant_ref: z.string(),
  status: z.enum(["success", "failed"]),
  external_tx_id: z.string().optional(),
  failure_reason: z.string().optional(),
  note: z.string().optional(),
});
merchantPublicRouter.post(
  "/withdraw-callback",
  merchantHmac("merchant-withdraw-callback"),
  async (req, _res) => {
    const ctx = req.merchantCtx!;
    try {
      const body = WithdrawCallback.parse(ctx.body);
      const out = await finalizeWithdrawCallback({
        merchantId: ctx.merchant.id,
        internalRef: body.internal_ref,
        merchantRef: body.merchant_ref,
        status: body.status,
        externalTxId: body.external_tx_id ?? null,
        failureReason: body.failure_reason ?? null,
        note: body.note ?? null,
      });
      await ctx.respond(200, {
        success: true,
        transaction_id: out.transactionId,
        wallet_tx_no: out.walletTxNo,
        merchant_ref: out.merchantRef,
        external_tx_id: out.externalTxId,
      });
    } catch (err) {
      const { status, code } = appErrorToCode(err);
      await ctx.respond(status, { success: false, error_code: code }, code);
    }
  },
);

// child-upsert + cashout-callback get filled in Phase 10 with their external integrations.
