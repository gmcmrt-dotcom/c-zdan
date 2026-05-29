/**
 * Admin affiliate remediation RPCs (K5 / P0-32).
 * Payout queue + cost dashboard — feature gated by AFFILIATE_SYSTEM_ENABLED.
 */
import { eq, sql } from "drizzle-orm";
import { db, tx } from "../../db/client";
import {
  merchantAffiliateLedger,
  merchantAffiliatePayouts,
} from "../../db/schema";
import { env } from "../../lib/env";
import { BadRequestError, NotFoundError, UnprocessableError } from "../../lib/errors";
import { writeAudit } from "./audit";

function assertAffiliateEnabled() {
  if (!env.AFFILIATE_SYSTEM_ENABLED) {
    throw new UnprocessableError("AFFILIATE_SYSTEM_DISABLED");
  }
}

export async function affiliateCosts(opts: { since?: string }) {
  assertAffiliateEnabled();
  const since = opts.since ?? new Date(Date.now() - 30 * 86400000).toISOString();

  const [row] = await db.execute<{
    total_pending: string;
    total_paid: string;
    total_all: string;
  }>(sql`
    SELECT
      COALESCE((
        SELECT sum(amount)::numeric
        FROM merchant_affiliate_ledger
        WHERE direction = 'accrual'
          AND created_at >= ${since}::timestamptz
      ), 0)::text AS total_all,
      COALESCE((
        SELECT sum(amount)::numeric
        FROM merchant_affiliate_ledger
        WHERE direction = 'payout'
          AND created_at >= ${since}::timestamptz
      ), 0)::text AS total_paid,
      COALESCE((
        SELECT sum(p.amount)::numeric
        FROM merchant_affiliate_payouts p
        WHERE p.status IN ('pending', 'approved')
          AND p.created_at >= ${since}::timestamptz
      ), 0)::text AS total_pending
  `);
  const r = (row as unknown as Array<typeof row>)[0];
  return [
    {
      total_pending: Number(r?.total_pending ?? 0),
      total_paid: Number(r?.total_paid ?? 0),
      total_all: Number(r?.total_all ?? 0),
    },
  ];
}

export async function approveAffiliatePayout(opts: {
  actorId: string;
  payoutId: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  assertAffiliateEnabled();
  return tx(async (trx) => {
    const [p] = await trx
      .select()
      .from(merchantAffiliatePayouts)
      .where(eq(merchantAffiliatePayouts.id, opts.payoutId))
      .limit(1);
    if (!p) throw new NotFoundError("PAYOUT_NOT_FOUND");
    if (p.status !== "pending") throw new UnprocessableError("PAYOUT_NOT_PENDING");

    await trx
      .update(merchantAffiliatePayouts)
      .set({
        status: "approved",
        approvedBy: opts.actorId,
        approvedAt: new Date(),
      })
      .where(eq(merchantAffiliatePayouts.id, opts.payoutId));

    await writeAudit({
      actorId: opts.actorId,
      action: "affiliate.payout_approve",
      resourceType: "merchant_affiliate_payout",
      resourceId: opts.payoutId,
      before: { status: p.status },
      after: { status: "approved" },
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
      trx,
    });
    return { success: true };
  });
}

export async function rejectAffiliatePayout(opts: {
  actorId: string;
  payoutId: string;
  reason: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  assertAffiliateEnabled();
  return tx(async (trx) => {
    const [p] = await trx
      .select()
      .from(merchantAffiliatePayouts)
      .where(eq(merchantAffiliatePayouts.id, opts.payoutId))
      .limit(1);
    if (!p) throw new NotFoundError("PAYOUT_NOT_FOUND");
    if (p.status !== "pending" && p.status !== "approved") {
      throw new UnprocessableError("PAYOUT_NOT_REJECTABLE");
    }

    await trx
      .update(merchantAffiliatePayouts)
      .set({
        status: "rejected",
        rejectedReason: opts.reason,
        rejectedAt: new Date(),
      })
      .where(eq(merchantAffiliatePayouts.id, opts.payoutId));

    await writeAudit({
      actorId: opts.actorId,
      action: "affiliate.payout_reject",
      resourceType: "merchant_affiliate_payout",
      resourceId: opts.payoutId,
      before: { status: p.status },
      after: { status: "rejected", reason: opts.reason },
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
      trx,
    });
    return { success: true };
  });
}

export async function markAffiliatePayoutPaid(opts: {
  actorId: string;
  payoutId: string;
  transferRef?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}) {
  assertAffiliateEnabled();
  return tx(async (trx) => {
    const [p] = await trx
      .select()
      .from(merchantAffiliatePayouts)
      .where(eq(merchantAffiliatePayouts.id, opts.payoutId))
      .limit(1);
    if (!p) throw new NotFoundError("PAYOUT_NOT_FOUND");
    if (p.status !== "approved") throw new UnprocessableError("PAYOUT_NOT_APPROVED");

    const ref = opts.transferRef?.trim() || `internal:${opts.payoutId}`;
    const referenceId = `affiliate_payout:${opts.payoutId}`;

    await trx
      .insert(merchantAffiliateLedger)
      .values({
        affiliateId: p.affiliateId,
        direction: "payout",
        amount: p.amount,
        referenceId,
        description: `Payout ${opts.payoutId}`,
      })
      .onConflictDoNothing();

    await trx
      .update(merchantAffiliatePayouts)
      .set({
        status: "paid",
        paidAt: new Date(),
        transferRef: ref,
      })
      .where(eq(merchantAffiliatePayouts.id, opts.payoutId));

    await writeAudit({
      actorId: opts.actorId,
      action: "affiliate.payout_paid",
      resourceType: "merchant_affiliate_payout",
      resourceId: opts.payoutId,
      before: { status: p.status },
      after: { status: "paid", transfer_ref: ref },
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
      trx,
    });
    return { success: true };
  });
}
