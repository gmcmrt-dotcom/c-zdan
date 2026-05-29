/**
 * L1 — Provider-ledger resolver + writer (P0-35 / Q4 Option B).
 *
 * `provider_ledger.provider_method_id` is NOT NULL with FK to
 * `payment_methods`. The C/D money flows finalize on a merchant whose
 * `integration_adapter` is a free-text string, not a `payment_method`
 * link. We resolve `(merchant_id, tx_type) → provider_method_id` via
 * `merchant_provider_method_map`. If the lookup returns no row, we
 * SKIP the ledger write (logged at warn) — finance reconciliation
 * degrades gracefully to the merchant_cash_pool_log path. The money
 * flow never breaks on a missing mapping.
 *
 * To populate the map, an admin BO page (or one-shot SQL) inserts:
 *   INSERT INTO merchant_provider_method_map
 *     (merchant_id, tx_type, provider_method_id)
 *     VALUES ($1, 'topup', $2);
 */
import { and, eq } from "drizzle-orm";
import { db, type Database } from "../db/client";
import {
  merchantProviderMethodMap,
  paymentMethods,
  providerLedger,
} from "../db/schema";
import { logger } from "../lib/logger";

export type ResolverTxType = "topup" | "withdraw" | "merchant_credit" | "spend";

export async function resolveProviderMethodId(
  merchantId: string,
  txType: ResolverTxType,
  trx: Database = db,
): Promise<{ providerMethodId: string; providerId: string } | null> {
  const [row] = await trx
    .select({
      providerMethodId: merchantProviderMethodMap.providerMethodId,
      providerId: paymentMethods.providerId,
    })
    .from(merchantProviderMethodMap)
    .innerJoin(
      paymentMethods,
      eq(paymentMethods.id, merchantProviderMethodMap.providerMethodId),
    )
    .where(
      and(
        eq(merchantProviderMethodMap.merchantId, merchantId),
        eq(merchantProviderMethodMap.txType, txType),
        eq(merchantProviderMethodMap.isActive, true),
      ),
    )
    .limit(1);
  if (!row) return null;
  return row;
}

export interface ProviderLedgerWrite {
  merchantId: string;
  txType: ResolverTxType;
  direction: "in" | "out";
  amountGross: string | number;
  providerCommission?: string | number;
  ourCommission?: string | number;
  amountNet: string | number;
  status: "pending" | "success" | "failed";
  transactionId?: string | null;
  topupRequestId?: string | null;
  externalRef?: string | null;
  internalRef?: string | null;
  rawResponse?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
  userId?: string | null;
  createdByUserId?: string | null;
}

/**
 * Write a `provider_ledger` row if we can resolve a `provider_method_id`
 * for this merchant + tx type. Returns the inserted id, or `null` if
 * resolution failed (in which case we logged a warn so finance can
 * notice and onboard the merchant in the map).
 *
 * Caller MUST pass a transaction handle so the ledger write is atomic
 * with the money mutation it describes.
 */
export async function writeProviderLedger(
  trx: Database,
  opts: ProviderLedgerWrite,
): Promise<string | null> {
  const resolved = await resolveProviderMethodId(opts.merchantId, opts.txType, trx);
  if (!resolved) {
    logger.warn(
      { merchantId: opts.merchantId, txType: opts.txType },
      "provider_ledger write SKIPPED — no merchant_provider_method_map entry; reconciliation falls back to cash_pool_log",
    );
    return null;
  }
  const [row] = await trx
    .insert(providerLedger)
    .values({
      providerId: resolved.providerId,
      providerMethodId: resolved.providerMethodId,
      direction: opts.direction,
      amountGross: String(opts.amountGross),
      providerCommission: String(opts.providerCommission ?? "0"),
      ourCommission: String(opts.ourCommission ?? "0"),
      amountNet: String(opts.amountNet),
      status: opts.status,
      userId: opts.userId ?? null,
      transactionId: opts.transactionId ?? null,
      topupRequestId: opts.topupRequestId ?? null,
      externalRef: opts.externalRef ?? null,
      internalRef: opts.internalRef ?? null,
      rawResponse: opts.rawResponse ?? null,
      errorCode: opts.errorCode ?? null,
      errorMessage: opts.errorMessage ?? null,
      createdByUserId: opts.createdByUserId ?? null,
      apiResponseAt: new Date(),
      finalizedAt: opts.status === "success" ? new Date() : null,
    })
    .returning({ id: providerLedger.id });
  return row?.id ?? null;
}
