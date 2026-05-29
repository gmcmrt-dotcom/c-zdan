/**
 * L1 — Admin maintenance of `merchant_provider_method_map` (P0-35 / Q4
 * Option B). Maps a merchant + tx type to the `payment_method` that the
 * `provider_ledger` writer (`services/provider-ledger.service.ts`) stamps
 * on every row.
 *
 * One active row per (merchant_id, tx_type). Re-setting deactivates the
 * old row and inserts a fresh one for the audit trail. Audited.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, tx } from "../../db/client";
import {
  merchantProviderMethodMap,
  merchants,
  paymentMethods,
} from "../../db/schema";
import { BadRequestError, NotFoundError } from "../../lib/errors";
import { writeAudit } from "./audit";

type TxType = "topup" | "withdraw" | "merchant_credit" | "spend";
const ALLOWED_TX_TYPES: readonly TxType[] = ["topup", "withdraw", "merchant_credit", "spend"];

export async function setProviderMethodMap(opts: {
  actorId: string;
  merchantId: string;
  txType: TxType;
  providerMethodId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ id: string; deactivated: number }> {
  if (!ALLOWED_TX_TYPES.includes(opts.txType)) {
    throw new BadRequestError("BAD_TX_TYPE");
  }
  return tx(async (trx) => {
    const [merchant] = await trx
      .select({ id: merchants.id })
      .from(merchants)
      .where(eq(merchants.id, opts.merchantId))
      .limit(1);
    if (!merchant) throw new NotFoundError("MERCHANT_NOT_FOUND");

    const [pm] = await trx
      .select({ id: paymentMethods.id, providerId: paymentMethods.providerId })
      .from(paymentMethods)
      .where(eq(paymentMethods.id, opts.providerMethodId))
      .limit(1);
    if (!pm) throw new NotFoundError("PAYMENT_METHOD_NOT_FOUND");

    // Deactivate any current active row for the same (merchant, txType).
    const deactivated = await trx
      .update(merchantProviderMethodMap)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(merchantProviderMethodMap.merchantId, opts.merchantId),
          eq(merchantProviderMethodMap.txType, opts.txType),
          eq(merchantProviderMethodMap.isActive, true),
        ),
      )
      .returning({ id: merchantProviderMethodMap.id });

    const [row] = await trx
      .insert(merchantProviderMethodMap)
      .values({
        merchantId: opts.merchantId,
        txType: opts.txType,
        providerMethodId: opts.providerMethodId,
        isActive: true,
        createdBy: opts.actorId,
      })
      .returning({ id: merchantProviderMethodMap.id });
    if (!row) throw new Error("insert failed");

    await writeAudit({
      actorId: opts.actorId,
      action: "provider_method_map.set",
      resourceType: "merchant_provider_method_map",
      resourceId: row.id,
      before: deactivated.length ? { deactivated_ids: deactivated.map((d) => d.id) } : null,
      after: {
        merchant_id: opts.merchantId,
        tx_type: opts.txType,
        provider_method_id: opts.providerMethodId,
        provider_id: pm.providerId,
      },
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
      trx,
    });

    return { id: row.id, deactivated: deactivated.length };
  });
}

export async function disableProviderMethodMap(opts: {
  actorId: string;
  mappingId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ success: true }> {
  return tx(async (trx) => {
    const [existing] = await trx
      .select()
      .from(merchantProviderMethodMap)
      .where(eq(merchantProviderMethodMap.id, opts.mappingId))
      .limit(1);
    if (!existing) throw new NotFoundError("MAPPING_NOT_FOUND");
    await trx
      .update(merchantProviderMethodMap)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(merchantProviderMethodMap.id, opts.mappingId));
    await writeAudit({
      actorId: opts.actorId,
      action: "provider_method_map.disable",
      resourceType: "merchant_provider_method_map",
      resourceId: opts.mappingId,
      before: { is_active: existing.isActive },
      after: { is_active: false },
      metadata: { merchant_id: existing.merchantId, tx_type: existing.txType },
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
      trx,
    });
    return { success: true };
  });
}

export async function listProviderMethodMap(merchantId?: string) {
  const where = merchantId
    ? eq(merchantProviderMethodMap.merchantId, merchantId)
    : undefined;
  const rows = await db
    .select({
      id: merchantProviderMethodMap.id,
      merchant_id: merchantProviderMethodMap.merchantId,
      merchant_name: merchants.name,
      tx_type: merchantProviderMethodMap.txType,
      provider_method_id: merchantProviderMethodMap.providerMethodId,
      provider_method_name: paymentMethods.name,
      provider_id: paymentMethods.providerId,
      is_active: merchantProviderMethodMap.isActive,
      created_at: merchantProviderMethodMap.createdAt,
      updated_at: merchantProviderMethodMap.updatedAt,
    })
    .from(merchantProviderMethodMap)
    .innerJoin(merchants, eq(merchants.id, merchantProviderMethodMap.merchantId))
    .innerJoin(paymentMethods, eq(paymentMethods.id, merchantProviderMethodMap.providerMethodId))
    .where(where)
    .orderBy(merchants.name, merchantProviderMethodMap.txType, desc(merchantProviderMethodMap.createdAt));
  return rows;
}
