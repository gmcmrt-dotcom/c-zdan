/**
 * Member-facing wallet endpoints (Akış A/C/D from the member side).
 * Public merchant API (HMAC) lives separately in merchant-public.routes.ts.
 */
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireUnfrozen, user } from "../middleware/auth";
import {
  cancelPaymentCode,
  createPaymentCode,
  previewSpend,
} from "../services/payment-code.service";
import {
  cancelTopupByMember,
  confirmTopupByMember,
  createTopupSession,
  getPendingTopup,
  getTopupSessionStatus,
  setTopupSessionPaymentInfo,
} from "../services/topup.service";
import {
  getWithdrawSessionStatus,
  requestWithdrawV3,
} from "../services/withdraw.service";
import { topupInit } from "../services/topup-init.service";
import { fetchAnindaSetWithdraw, fetchAnindaTokenList, parseAnindaAdapter } from "../integrations/aninda";
import { db } from "../db/client";
import { merchants, profiles, withdrawSessions } from "../db/schema";
import { and, eq, sql } from "drizzle-orm";
import { ConflictError, NotFoundError, UnprocessableError } from "../lib/errors";

export const walletRouter = Router();
// P1 — every wallet route requires a valid token AND the member must not be
// frozen for any state-changing call (POST/PUT/PATCH/DELETE). Reads still
// work so the member can see their balance + sessions even while frozen.
walletRouter.use(requireAuth, requireUnfrozen);

// ---------- Akış A: payment codes ----------
walletRouter.post("/payment-code/preview", async (req, res, next) => {
  try {
    const { amount } = z.object({ amount: z.coerce.number().positive() }).parse(req.body);
    res.json(await previewSpend(user(req).id, amount));
  } catch (e) { next(e); }
});

walletRouter.post("/payment-code", async (req, res, next) => {
  try {
    const input = z
      .object({
        amount: z.coerce.number().positive(),
        ttlSeconds: z.coerce.number().int().min(60).max(3600).default(300),
        // K5 — `customerName` is now mandatory (Q19). Stored as
        // `customer_name_snapshot` on payment_codes and verified at
        // consume time against the merchant-provided `customer_name`.
        // Length cap matches the schema column (`text` but practically
        // bounded to avoid PII bloat).
        customerName: z.string().min(2).max(80),
      })
      .parse(req.body);
    res.status(201).json(await createPaymentCode(user(req).id, input.amount, input.ttlSeconds, input.customerName));
  } catch (e) { next(e); }
});

walletRouter.post("/payment-code/:id/cancel", async (req, res, next) => {
  try {
    res.json(await cancelPaymentCode(user(req).id, req.params.id!));
  } catch (e) { next(e); }
});

// ---------- Akış C: topup sessions ----------
walletRouter.get("/topup/pending", async (req, res, next) => {
  try {
    res.json({ session: await getPendingTopup(user(req).id) });
  } catch (e) { next(e); }
});

walletRouter.post("/topup", async (req, res, next) => {
  try {
    const input = z
      .object({
        methodType: z.string(),
        amount: z.coerce.number().positive(),
        returnBase: z.string().optional(),
      })
      .parse(req.body);
    res.status(201).json(await createTopupSession({ userId: user(req).id, ...input }));
  } catch (e) { next(e); }
});

walletRouter.get("/topup/:id", async (req, res, next) => {
  try {
    res.json(await getTopupSessionStatus(user(req).id, req.params.id!));
  } catch (e) { next(e); }
});

walletRouter.post("/topup/:id/init", async (req, res, next) => {
  try {
    res.json(await topupInit({ userId: user(req).id, sessionId: req.params.id! }));
  } catch (e) { next(e); }
});

walletRouter.post("/topup/:id/payment-info", async (req, res, next) => {
  try {
    const input = z
      .object({
        iban: z.string(),
        accountHolder: z.string(),
        bankName: z.string().optional(),
        paymentReference: z.string().optional(),
      })
      .parse(req.body);
    res.json(
      await setTopupSessionPaymentInfo({
        userId: user(req).id,
        sessionId: req.params.id!,
        ...input,
      }),
    );
  } catch (e) { next(e); }
});

walletRouter.post("/topup/:id/confirm", async (req, res, next) => {
  try {
    res.json(await confirmTopupByMember(user(req).id, req.params.id!));
  } catch (e) { next(e); }
});

walletRouter.post("/topup/:id/cancel", async (req, res, next) => {
  try {
    res.json(await cancelTopupByMember(user(req).id, req.params.id!));
  } catch (e) { next(e); }
});

// ---------- Akış D: withdraw sessions ----------
walletRouter.post("/withdraw", async (req, res, next) => {
  try {
    const input = z
      .object({
        methodType: z.string(),
        amount: z.coerce.number().positive(),
        iban: z.string().optional(),
        ibanHolder: z.string().optional(),
        cryptoType: z.string().optional(),
        payoutAddress: z.string().optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);
    res.status(201).json(await requestWithdrawV3({ userId: user(req).id, ...input }));
  } catch (e) { next(e); }
});

walletRouter.get("/withdraw/:id", async (req, res, next) => {
  try {
    res.json(await getWithdrawSessionStatus(user(req).id, req.params.id!));
  } catch (e) { next(e); }
});

// Push pending Anında withdraw to provider (member-triggered)
walletRouter.post("/withdraw/:id/push", async (req, res, next) => {
  try {
    // Read context (no state change yet)
    const s = await getWithdrawSessionStatus(user(req).id, req.params.id!);
    if (s.status !== "pending") throw new UnprocessableError("WRONG_STATUS");
    const [m] = await db.select().from(merchants).where(eq(merchants.id, s.merchantId)).limit(1);
    if (!m || !parseAnindaAdapter(m.integrationAdapter)) {
      throw new UnprocessableError("PROVIDER_NOT_ANINDA");
    }
    const [p] = await db
      .select({ memberNo: profiles.memberNo, firstName: profiles.firstName, lastName: profiles.lastName })
      .from(profiles)
      .where(eq(profiles.id, s.userId))
      .limit(1);
    if (!p) throw new NotFoundError("PROFILE_NOT_FOUND");

    // P0-23 — atomically CLAIM the session BEFORE the outbound provider call.
    // Without this, two concurrent push requests (double-click, retry race,
    // dispatcher overlap) both read status='pending' and both hit Aninda →
    // double payout. The `UPDATE … WHERE status='pending' RETURNING` is the
    // actual lock; if 0 rows return, someone else already advanced the session
    // and we abort. On provider failure we do NOT revert to 'pending' because
    // we cannot know whether the provider received the request — admin must
    // manually reconcile (matching the "don't know if it landed" semantics
    // documented in HARD_RULES).
    const claimed = await db
      .update(withdrawSessions)
      .set({
        status: "sent_to_merchant",
        pushAttempts: sql`${withdrawSessions.pushAttempts} + 1`,
        lastAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(withdrawSessions.id, s.id),
          eq(withdrawSessions.status, "pending"),
        ),
      )
      .returning({ id: withdrawSessions.id });
    if (claimed.length === 0) throw new ConflictError("WITHDRAW_NOT_PUSHABLE");

    const resp = await fetchAnindaSetWithdraw({
      playerId: p.memberNo,
      playerFullName: `${p.firstName} ${p.lastName}`,
      traderTransactionId: s.id,
      paymentMethodId: m.integrationAdapter === "aninda_kripto" ? (process.env.ANINDA_PAYMENT_METHOD_ID ?? "") : "",
      amount: Number(s.amount),
      iban: s.iban ?? undefined,
      cryptoType: s.cryptoType ?? undefined,
      payoutAddress: s.payoutAddress ?? undefined,
    });
    if (!resp || resp.HasError) throw new UnprocessableError("PROVIDER_PUSH_FAILED");
    res.json({ success: true, status: "sent_to_merchant" });
  } catch (e) { next(e); }
});

// Crypto token list for withdraw UI
walletRouter.get("/aninda/tokens", async (_req, res, next) => {
  try {
    const tokens = await fetchAnindaTokenList();
    res.json({
      tokens: tokens.length > 0 ? tokens : [
        { CryptoType: "USDT-TRC20", Name: "Tether (TRC20)" },
        { CryptoType: "BTC", Name: "Bitcoin" },
        { CryptoType: "ETH", Name: "Ethereum" },
      ],
      source: tokens.length > 0 ? "aninda" : "fallback",
    });
  } catch (e) { next(e); }
});
