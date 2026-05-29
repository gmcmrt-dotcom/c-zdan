/**
 * Member calls POST /api/wallet/topup/:id/init after creating a session.
 *
 * Branches:
 *   - merchant.integration_adapter starts with "aninda" → call Aninda
 *     get-deposit-link, store redirect_url, set status='redirected'
 *   - else (legacy / direct integration) → call merchant.topup_init_url via
 *     outbound HMAC; expect { iban, account_holder, bank_name, payment_reference }
 *     populate inline fields, set status='awaiting_member_action'
 *   - if MOCK_FNS_ENABLED and no integration_adapter / topup_init_url → fake
 *     inline IBAN (dev only)
 */
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { merchants, profiles, topupSessions } from "../db/schema";
import { env, isProd } from "../lib/env";
import { BadRequestError, NotFoundError, UnprocessableError } from "../lib/errors";
import { logger } from "../lib/logger";
import {
  anindaBankaPaymentMethodId,
  anindaDefaultBankId,
  anindaPaparaPaymentMethodId,
  anindaPaymentMethodId,
  fetchAnindaDepositLink,
  parseAnindaAdapter,
} from "../integrations/aninda";
import { postMerchantHmac } from "../integrations/merchant-outbound";

export interface InitInput {
  userId: string;
  sessionId: string;
}

export type InitFlow = "inline_iban" | "iframe" | "mock";

export interface InitResult {
  success: boolean;
  flow: InitFlow;
  iban?: string;
  accountHolder?: string;
  bankName?: string;
  paymentReference?: string;
  redirectUrl?: string;
}

function methodTypePaymentId(methodType: string): string {
  if (methodType === "papara") return anindaPaparaPaymentMethodId();
  if (methodType === "kripto") return anindaPaymentMethodId();
  return anindaBankaPaymentMethodId();
}

export async function topupInit(input: InitInput): Promise<InitResult> {
  const [s] = await db.select().from(topupSessions).where(eq(topupSessions.id, input.sessionId)).limit(1);
  if (!s) throw new NotFoundError("SESSION_NOT_FOUND");
  if (s.userId !== input.userId) throw new BadRequestError("WRONG_SESSION");
  if (s.status !== "pending") {
    return {
      success: true,
      flow: s.redirectUrl ? "iframe" : "inline_iban",
      iban: s.iban ?? undefined,
      accountHolder: s.accountHolder ?? undefined,
      bankName: s.bankName ?? undefined,
      paymentReference: s.paymentReference ?? undefined,
      redirectUrl: s.redirectUrl ?? undefined,
    };
  }

  const [m] = await db.select().from(merchants).where(eq(merchants.id, s.merchantId)).limit(1);
  if (!m) throw new NotFoundError("MERCHANT_NOT_FOUND");

  const [p] = await db
    .select({ firstName: profiles.firstName, lastName: profiles.lastName, email: profiles.email, memberNo: profiles.memberNo })
    .from(profiles)
    .where(eq(profiles.id, input.userId))
    .limit(1);
  if (!p) throw new NotFoundError("PROFILE_NOT_FOUND");

  const playerFullName = `${p.firstName} ${p.lastName}`.trim();

  const anindaAdapter = parseAnindaAdapter(m.integrationAdapter);
  if (anindaAdapter) {
    const out = await fetchAnindaDepositLink({
      playerId: p.memberNo,
      playerFullName,
      playerUserName: p.email,
      traderTransactionId: s.id,
      paymentMethodId: methodTypePaymentId(s.methodType),
      amount: Number(s.amount),
      bankId: anindaAdapter === "aninda_banka" ? anindaDefaultBankId() : undefined,
      playerEmail: p.email,
    });
    if (!out.url) throw new UnprocessableError("PROVIDER_INIT_FAILED");
    await db
      .update(topupSessions)
      .set({
        redirectUrl: out.url,
        status: "redirected",
        updatedAt: new Date(),
      })
      .where(eq(topupSessions.id, s.id));
    return { success: true, flow: "iframe", redirectUrl: out.url };
  }

  // Generic finance merchant with topup_init_url
  if (m.topupInitUrl && m.signingSecret) {
    const resp = await postMerchantHmac<{
      iban?: string;
      account_holder?: string;
      bank_name?: string;
      payment_reference?: string;
      redirect_url?: string;
    }>({
      url: m.topupInitUrl,
      signingSecret: m.signingSecret,
      body: {
        internal_ref: s.id,
        amount: Number(s.amount),
        method_type: s.methodType,
        customer_name: playerFullName,
        return_url: s.returnUrl,
      },
    });
    if (!resp.ok || !resp.json) throw new UnprocessableError("PROVIDER_INIT_FAILED");
    const j = resp.json;
    if (j.redirect_url) {
      await db
        .update(topupSessions)
        .set({ redirectUrl: j.redirect_url, status: "redirected", updatedAt: new Date() })
        .where(eq(topupSessions.id, s.id));
      return { success: true, flow: "iframe", redirectUrl: j.redirect_url };
    }
    if (j.iban && j.account_holder) {
      await db
        .update(topupSessions)
        .set({
          iban: j.iban,
          accountHolder: j.account_holder,
          bankName: j.bank_name ?? null,
          paymentReference: j.payment_reference ?? null,
          status: "awaiting_member_action",
          updatedAt: new Date(),
        })
        .where(eq(topupSessions.id, s.id));
      return {
        success: true,
        flow: "inline_iban",
        iban: j.iban,
        accountHolder: j.account_holder,
        bankName: j.bank_name,
        paymentReference: j.payment_reference,
      };
    }
    throw new UnprocessableError("PROVIDER_INVALID_RESPONSE");
  }

  // P0-11 — mock IBAN branch is gated to non-production. env.ts also refuses
  // to boot when MOCK_FNS_ENABLED=true in production, so this is defence-in-
  // depth: even if the flag is set in a misconfigured staging environment,
  // mock instructions are never returned from a NODE_ENV=production process.
  if (env.MOCK_FNS_ENABLED && !isProd) {
    const fake = {
      iban: "TR12 0006 4000 0011 2345 6789 01",
      account_holder: "Test Provider A.S.",
      bank_name: "İş Bankası",
      payment_reference: `WALLET-${s.publicNo}`,
    };
    await db
      .update(topupSessions)
      .set({
        iban: fake.iban,
        accountHolder: fake.account_holder,
        bankName: fake.bank_name,
        paymentReference: fake.payment_reference,
        status: "awaiting_member_action",
        updatedAt: new Date(),
      })
      .where(eq(topupSessions.id, s.id));
    logger.warn({ sessionId: s.id }, "topup-init: returning MOCK IBAN (MOCK_FNS_ENABLED)");
    return {
      success: true,
      flow: "mock",
      iban: fake.iban,
      accountHolder: fake.account_holder,
      bankName: fake.bank_name,
      paymentReference: fake.payment_reference,
    };
  }

  throw new UnprocessableError("PROVIDER_NOT_CONFIGURED");
}
