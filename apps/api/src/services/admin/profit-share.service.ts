/**
 * Admin profit-share campaigns: list, preview, create, publish, list allocations.
 *
 * Period turnover is sourced from `transactions` of type `spend`. Pool amount
 * is `net_profit * distribution_pct / 100`. The top `max_recipients` members
 * by turnover get pro-rata allocations.
 */
import { addHours } from "date-fns";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db, tx } from "../../db/client";
import {
  profiles,
  profitShareAllocations,
  profitShareCampaigns,
  transactions,
} from "../../db/schema";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors";
import { writeAudit } from "./audit";

type PeriodType = "daily" | "weekly" | "monthly";
type CampaignStatus = "draft" | "published" | "closed" | "cancelled";

export interface CampaignRow {
  id: string;
  period_type: PeriodType;
  period_from: string;
  period_to: string;
  distribution_pct: number;
  max_recipients: number;
  claim_expires_hours: number;
  net_profit: number;
  pool_amount: number;
  eligible_count: number;
  status: CampaignStatus;
  created_at: string;
  published_at: string | null;
  claim_expires_at: string | null;
  claimed_count: number;
  claimed_amount: number;
  pending_count: number;
  pending_amount: number;
  expired_count: number;
  expired_amount: number;
}

export interface AllocationRow {
  allocation_id: string;
  user_id: string;
  member_no: string | null;
  first_name: string | null;
  last_name: string | null;
  rank_no: number;
  turnover_amount: number;
  share_pct: number;
  allocated_amount: number;
  status: "pending" | "claimed" | "expired";
  expires_at: string | null;
  claimed_at: string | null;
  expired_at: string | null;
  claim_tx_public_no: string | null;
}

export interface PreviewInput {
  periodType: PeriodType;
  periodFrom: string;
  periodTo: string;
  distributionPct: number;
  maxRecipients: number;
  claimExpiresHours: number;
}

export interface PreviewResult {
  period_type: PeriodType;
  period_from: string;
  period_to: string;
  distribution_pct: number;
  max_recipients: number;
  claim_expires_hours: number;
  platform_revenue: number;
  platform_cost: number;
  affiliate_cost: number;
  net_profit: number;
  pool_amount: number;
  top_turnover_total: number;
  eligible_count: number;
  rows: Array<{
    user_id: string;
    member_no: string | null;
    full_name: string;
    turnover_amount: number;
    share_pct: number;
    allocated_amount: number;
    rank_no: number;
  }>;
}

async function computePreview(input: PreviewInput): Promise<PreviewResult> {
  if (!(input.distributionPct > 0 && input.distributionPct <= 100))
    throw new BadRequestError("DISTRIBUTION_PCT_OUT_OF_RANGE");
  if (!(input.maxRecipients > 0)) throw new BadRequestError("MAX_RECIPIENTS_INVALID");

  // Platform revenue = sum(fee) over spend in the period.
  // Platform cost = sum(provider_commission) — but provider_ledger may be sparse;
  // fall back to 0 if no rows. Affiliate cost = 0 until affiliate feature is live.
  const [rev] = await db.execute<{ revenue: string; cost: string }>(sql`
    SELECT
      COALESCE(sum(fee), 0)::text AS revenue,
      0::text AS cost
    FROM transactions
    WHERE type IN ('spend','merchant_credit')
      AND status = 'completed'
      AND created_at >= ${input.periodFrom}::timestamptz
      AND created_at <  ${input.periodTo}::timestamptz
  `);
  const platformRevenue = Number((rev as unknown as Array<{ revenue: string }>)[0]?.revenue ?? 0);
  const platformCost = 0;
  const affiliateCost = 0;
  const netProfit = Math.max(0, platformRevenue - platformCost - affiliateCost);
  const poolAmount = Math.round(((netProfit * input.distributionPct) / 100) * 100) / 100;

  // Top members by spend turnover in the period
  const turnoverRows = await db.execute<{
    user_id: string;
    member_no: string | null;
    first_name: string | null;
    last_name: string | null;
    turnover: string;
  }>(sql`
    SELECT
      tx.user_id,
      p.member_no,
      p.first_name,
      p.last_name,
      COALESCE(sum(tx.amount), 0)::text AS turnover
    FROM transactions tx
    LEFT JOIN profiles p ON p.id = tx.user_id
    WHERE tx.type = 'spend'
      AND tx.status = 'completed'
      AND tx.created_at >= ${input.periodFrom}::timestamptz
      AND tx.created_at <  ${input.periodTo}::timestamptz
    GROUP BY tx.user_id, p.member_no, p.first_name, p.last_name
    HAVING sum(tx.amount) > 0
    ORDER BY sum(tx.amount) DESC
    LIMIT ${input.maxRecipients}
  `);

  const top = turnoverRows as unknown as Array<{
    user_id: string;
    member_no: string | null;
    first_name: string | null;
    last_name: string | null;
    turnover: string;
  }>;
  const topTurnoverTotal = top.reduce((s, r) => s + Number(r.turnover), 0);

  const rows = top.map((r, i) => {
    const t = Number(r.turnover);
    const sharePct = topTurnoverTotal > 0 ? Number(((t / topTurnoverTotal) * 100).toFixed(5)) : 0;
    const allocated = topTurnoverTotal > 0 ? Math.round(((t / topTurnoverTotal) * poolAmount) * 100) / 100 : 0;
    return {
      user_id: r.user_id,
      member_no: r.member_no,
      full_name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "—",
      turnover_amount: t,
      share_pct: sharePct,
      allocated_amount: allocated,
      rank_no: i + 1,
    };
  });

  return {
    period_type: input.periodType,
    period_from: input.periodFrom,
    period_to: input.periodTo,
    distribution_pct: input.distributionPct,
    max_recipients: input.maxRecipients,
    claim_expires_hours: input.claimExpiresHours,
    platform_revenue: platformRevenue,
    platform_cost: platformCost,
    affiliate_cost: affiliateCost,
    net_profit: netProfit,
    pool_amount: poolAmount,
    top_turnover_total: topTurnoverTotal,
    eligible_count: rows.length,
    rows,
  };
}

export async function preview(input: PreviewInput): Promise<PreviewResult> {
  return computePreview(input);
}

export async function createCampaign(input: PreviewInput & { actorId: string; notes?: string | null }) {
  const preview = await computePreview(input);
  return tx(async (trx) => {
    const [c] = await trx
      .insert(profitShareCampaigns)
      .values({
        periodType: input.periodType,
        periodFrom: new Date(input.periodFrom),
        periodTo: new Date(input.periodTo),
        distributionPct: String(input.distributionPct),
        platformRevenue: String(preview.platform_revenue),
        platformCost: String(preview.platform_cost),
        affiliateCost: String(preview.affiliate_cost),
        netProfit: String(preview.net_profit),
        poolAmount: String(preview.pool_amount),
        topTurnoverTotal: String(preview.top_turnover_total),
        eligibleCount: preview.eligible_count,
        maxRecipients: input.maxRecipients,
        claimExpiresHours: input.claimExpiresHours,
        status: "draft",
        notes: input.notes ?? null,
        createdBy: input.actorId,
      })
      .returning({ id: profitShareCampaigns.id });
    if (!c) throw new Error("campaign insert failed");

    if (preview.rows.length > 0) {
      const expiresAt = addHours(new Date(), input.claimExpiresHours);
      await trx.insert(profitShareAllocations).values(
        preview.rows.map((r) => ({
          campaignId: c.id,
          userId: r.user_id,
          rankNo: r.rank_no,
          turnoverAmount: String(r.turnover_amount),
          sharePct: String(r.share_pct),
          allocatedAmount: String(r.allocated_amount),
          status: "pending",
          expiresAt,
        })),
      );
    }

    await writeAudit({
      actorId: input.actorId,
      action: "profit_share.create",
      resourceType: "profit_share_campaign",
      resourceId: c.id,
      metadata: {
        period_from: input.periodFrom,
        period_to: input.periodTo,
        pool_amount: preview.pool_amount,
        eligible_count: preview.eligible_count,
      },
    });

    return { success: true, campaign_id: c.id };
  });
}

export async function publishCampaign(opts: { actorId: string; campaignId: string; ip?: string | null }) {
  return tx(async (trx) => {
    const [c] = await trx
      .select()
      .from(profitShareCampaigns)
      .where(eq(profitShareCampaigns.id, opts.campaignId))
      .limit(1);
    if (!c) throw new NotFoundError("CAMPAIGN_NOT_FOUND");
    if (c.status !== "draft") throw new ConflictError("WRONG_STATUS");
    const publishedAt = new Date();
    const expiresAt = addHours(publishedAt, c.claimExpiresHours);
    await trx
      .update(profitShareCampaigns)
      .set({ status: "published", publishedAt, publishedBy: opts.actorId })
      .where(eq(profitShareCampaigns.id, c.id));
    // Roll the expires_at forward for allocations not yet finalised
    await trx
      .update(profitShareAllocations)
      .set({ expiresAt })
      .where(
        and(
          eq(profitShareAllocations.campaignId, c.id),
          eq(profitShareAllocations.status, "pending"),
        ),
      );
    await writeAudit({
      actorId: opts.actorId,
      action: "profit_share.publish",
      resourceType: "profit_share_campaign",
      resourceId: c.id,
      metadata: { published_at: publishedAt.toISOString(), expires_at: expiresAt.toISOString() },
      // I3 — Include actor IP in the audit row so the publish trail can be
      // forensically linked to a specific operator session (other admin
      // mutations already pass `ip`).
      ip: opts.ip ?? null,
    });
    return { success: true };
  });
}

export async function listCampaigns(): Promise<CampaignRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT
      c.id,
      c.period_type,
      c.period_from,
      c.period_to,
      c.distribution_pct,
      c.max_recipients,
      c.claim_expires_hours,
      c.net_profit,
      c.pool_amount,
      c.eligible_count,
      c.status,
      c.created_at,
      c.published_at,
      (CASE WHEN c.published_at IS NULL THEN NULL
            ELSE c.published_at + (c.claim_expires_hours || ' hours')::interval END) AS claim_expires_at,
      COALESCE(sum(CASE WHEN a.status = 'claimed' THEN 1 ELSE 0 END), 0)::int AS claimed_count,
      COALESCE(sum(CASE WHEN a.status = 'claimed' THEN a.allocated_amount ELSE 0 END), 0)::text AS claimed_amount,
      COALESCE(sum(CASE WHEN a.status = 'pending' THEN 1 ELSE 0 END), 0)::int AS pending_count,
      COALESCE(sum(CASE WHEN a.status = 'pending' THEN a.allocated_amount ELSE 0 END), 0)::text AS pending_amount,
      COALESCE(sum(CASE WHEN a.status = 'expired' THEN 1 ELSE 0 END), 0)::int AS expired_count,
      COALESCE(sum(CASE WHEN a.status = 'expired' THEN a.allocated_amount ELSE 0 END), 0)::text AS expired_amount
    FROM profit_share_campaigns c
    LEFT JOIN profit_share_allocations a ON a.campaign_id = c.id
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `);
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    period_type: r.period_type as PeriodType,
    period_from: new Date(r.period_from as string).toISOString(),
    period_to: new Date(r.period_to as string).toISOString(),
    distribution_pct: Number(r.distribution_pct),
    max_recipients: Number(r.max_recipients),
    claim_expires_hours: Number(r.claim_expires_hours),
    net_profit: Number(r.net_profit),
    pool_amount: Number(r.pool_amount),
    eligible_count: Number(r.eligible_count),
    status: r.status as CampaignStatus,
    created_at: new Date(r.created_at as string).toISOString(),
    published_at: r.published_at ? new Date(r.published_at as string).toISOString() : null,
    claim_expires_at: r.claim_expires_at ? new Date(r.claim_expires_at as string).toISOString() : null,
    claimed_count: Number(r.claimed_count),
    claimed_amount: Number(r.claimed_amount),
    pending_count: Number(r.pending_count),
    pending_amount: Number(r.pending_amount),
    expired_count: Number(r.expired_count),
    expired_amount: Number(r.expired_amount),
  }));
}

export async function listAllocations(campaignId: string): Promise<AllocationRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT
      a.id            AS allocation_id,
      a.user_id,
      p.member_no,
      p.first_name,
      p.last_name,
      a.rank_no,
      a.turnover_amount,
      a.share_pct,
      a.allocated_amount,
      a.status,
      a.expires_at,
      a.claimed_at,
      a.expired_at,
      t.public_no     AS claim_tx_public_no
    FROM profit_share_allocations a
    LEFT JOIN profiles p ON p.id = a.user_id
    LEFT JOIN transactions t ON t.id = a.claim_tx_id
    WHERE a.campaign_id = ${campaignId}
    ORDER BY a.rank_no ASC
  `);
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    allocation_id: String(r.allocation_id),
    user_id: String(r.user_id),
    member_no: (r.member_no as string | null) ?? null,
    first_name: (r.first_name as string | null) ?? null,
    last_name: (r.last_name as string | null) ?? null,
    rank_no: Number(r.rank_no),
    turnover_amount: Number(r.turnover_amount),
    share_pct: Number(r.share_pct),
    allocated_amount: Number(r.allocated_amount),
    status: r.status as "pending" | "claimed" | "expired",
    expires_at: r.expires_at ? new Date(r.expires_at as string).toISOString() : null,
    claimed_at: r.claimed_at ? new Date(r.claimed_at as string).toISOString() : null,
    expired_at: r.expired_at ? new Date(r.expired_at as string).toISOString() : null,
    claim_tx_public_no: (r.claim_tx_public_no as string | null) ?? null,
  }));
}
