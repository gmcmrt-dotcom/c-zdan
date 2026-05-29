/**
 * Admin profit-share campaigns: list, preview, create, publish, list allocations.
 *
 * Period turnover is sourced from `transactions` of type `spend`. Pool amount
 * is `net_profit * distribution_pct / 100`. The top `max_recipients` members
 * by turnover get pro-rata allocations.
 *
 * PS1 — net_profit = platform_revenue − platform_cost − affiliate_cost − carried_overhead.
 * Publish adds pool_amount to `settings.profit_share_cumulative_overhead`.
 */
import { addHours } from "date-fns";
import { and, eq, sql } from "drizzle-orm";
import { db, tx, type Database } from "../../db/client";
import {
  profitShareAllocations,
  profitShareCampaigns,
  settings,
} from "../../db/schema";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors";
import { env } from "../../lib/env";
import { writeAudit } from "./audit";
import { scheduleProfitSharePublishNotifications } from "./profit-share-notify.service";

type PeriodType = "daily" | "weekly" | "monthly";
type CampaignStatus = "draft" | "published" | "closed" | "cancelled";

const CUMULATIVE_OVERHEAD_KEY = "profit_share_cumulative_overhead";

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
  closed_at: string | null;
  closed_by: string | null;
}

export interface CloseCampaignSummary {
  campaign_id: string;
  claimed_count: number;
  claimed_amount: number;
  pending_count: number;
  pending_amount: number;
  expired_count: number;
  expired_amount: number;
  closed_at: string;
  closed_by: string;
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

export interface PreviewSummary {
  period_type: PeriodType;
  period_from: string;
  period_to: string;
  distribution_pct: number;
  max_recipients: number;
  claim_expires_hours: number;
  platform_revenue: number;
  platform_cost: number;
  affiliate_cost: number;
  carried_overhead: number;
  net_profit: number;
  pool_amount: number;
  top_turnover_total: number;
  eligible_count: number;
}

export interface PreviewAllocationRow {
  rank_no: number;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  member_no: string | null;
  turnover_amount: number;
  share_pct: number;
  allocated_amount: number;
}

export interface PreviewApiResponse {
  summary: PreviewSummary;
  allocations: PreviewAllocationRow[];
}

interface PreviewRowInternal extends PreviewAllocationRow {}

interface PlatformEconomics {
  platformRevenue: number;
  platformCost: number;
  affiliateCost: number;
}

/** PS1 net profit after all deductions; floored at zero. */
export function computeProfitShareNetProfit(opts: {
  platformRevenue: number;
  platformCost: number;
  affiliateCost: number;
  carriedOverhead: number;
}): number {
  return Math.max(
    0,
    opts.platformRevenue - opts.platformCost - opts.affiliateCost - opts.carriedOverhead,
  );
}

/** Pool amount from net profit and distribution percentage (2 dp). */
export function computePoolAmount(netProfit: number, distributionPct: number): number {
  return Math.round(((netProfit * distributionPct) / 100) * 100) / 100;
}

/**
 * PS10 — Pro-rata by turnover with floor cents; distribute remainder to top
 * recipients (rank 1 first) so allocations sum exactly to poolAmount.
 */
export function distributeProRataAllocations(
  turnovers: number[],
  poolAmount: number,
): number[] {
  if (turnovers.length === 0 || poolAmount <= 0) return turnovers.map(() => 0);

  const poolCents = Math.round(poolAmount * 100);
  const totalTurnover = turnovers.reduce((s, t) => s + t, 0);
  if (totalTurnover <= 0) return turnovers.map(() => 0);

  const cents = turnovers.map((t) => Math.floor((t / totalTurnover) * poolCents));
  let remainder = poolCents - cents.reduce((s, c) => s + c, 0);
  for (let i = 0; remainder > 0; i++) {
    cents[i % cents.length]! += 1;
    remainder--;
  }

  return cents.map((c) => c / 100);
}

function parseSettingNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function getCumulativeOverhead(trx: Database = db): Promise<number> {
  const [row] = await trx
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, CUMULATIVE_OVERHEAD_KEY))
    .limit(1);
  return row ? parseSettingNumber(row.value) : 0;
}

async function addCumulativeOverhead(
  trx: Database,
  delta: number,
  audit: { actorId: string; campaignId: string; ip?: string | null },
): Promise<number> {
  const before = await getCumulativeOverhead(trx);
  const after = Math.round((before + delta) * 100) / 100;
  await trx
    .insert(settings)
    .values({
      key: CUMULATIVE_OVERHEAD_KEY,
      value: after,
      description:
        "PS1 carry-forward: cumulative pool_amount from published profit-share campaigns",
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: after, updatedAt: new Date() },
    });
  await writeAudit({
    trx,
    actorId: audit.actorId,
    action: "profit_share.overhead_carry_forward",
    resourceType: "settings",
    resourceId: CUMULATIVE_OVERHEAD_KEY,
    metadata: {
      campaign_id: audit.campaignId,
      delta,
      before,
      after,
    },
    ip: audit.ip ?? null,
  });
  return after;
}

/**
 * PS7 — platform economics for a period.
 *
 * Revenue: spend + merchant_withdraw fees, merchant_credit metadata fees,
 *          provider_ledger our_commission (finance flows).
 * Cost: provider_ledger provider_commission.
 * Affiliate: accrual ledger rows when AFFILIATE_SYSTEM_ENABLED.
 *
 * Gaps (documented):
 * - provider_ledger may be empty when merchant_provider_method_map is missing.
 * - topup margin is not in transaction.fee (member gross); only provider side.
 * - referral_bonus / loyalty costs are excluded (separate programs).
 */
async function fetchPlatformEconomics(
  periodFrom: string,
  periodTo: string,
): Promise<PlatformEconomics> {
  const [econ] = await db.execute<{ revenue: string; cost: string }>(sql`
    SELECT
      (
        COALESCE((
          SELECT sum(fee)::numeric
          FROM transactions
          WHERE type IN ('spend', 'merchant_withdraw')
            AND status = 'completed'
            AND created_at >= ${periodFrom}::timestamptz
            AND created_at <  ${periodTo}::timestamptz
        ), 0)
        + COALESCE((
          SELECT sum((metadata->>'merchant_fee')::numeric)
          FROM transactions
          WHERE type = 'merchant_credit'
            AND status = 'completed'
            AND created_at >= ${periodFrom}::timestamptz
            AND created_at <  ${periodTo}::timestamptz
            AND metadata ? 'merchant_fee'
        ), 0)
        + COALESCE((
          SELECT sum(fee)::numeric
          FROM merchant_cashout_sessions
          WHERE status = 'success'
            AND finalized_at >= ${periodFrom}::timestamptz
            AND finalized_at <  ${periodTo}::timestamptz
        ), 0)
        + COALESCE((
          SELECT sum(our_commission)::numeric
          FROM provider_ledger
          WHERE status = 'success'
            AND created_at >= ${periodFrom}::timestamptz
            AND created_at <  ${periodTo}::timestamptz
        ), 0)
      )::text AS revenue,
      COALESCE((
        SELECT sum(provider_commission)::numeric
        FROM provider_ledger
        WHERE status = 'success'
          AND created_at >= ${periodFrom}::timestamptz
          AND created_at <  ${periodTo}::timestamptz
      ), 0)::text AS cost
  `);
  const row = (econ as unknown as Array<{ revenue: string; cost: string }>)[0];
  const platformRevenue = Number(row?.revenue ?? 0);
  const platformCost = Number(row?.cost ?? 0);

  let affiliateCost = 0;
  if (env.AFFILIATE_SYSTEM_ENABLED) {
    const [aff] = await db.execute<{ total: string }>(sql`
      SELECT COALESCE(sum(amount), 0)::text AS total
      FROM merchant_affiliate_ledger
      WHERE direction = 'accrual'
        AND created_at >= ${periodFrom}::timestamptz
        AND created_at <  ${periodTo}::timestamptz
    `);
    affiliateCost = Number((aff as unknown as Array<{ total: string }>)[0]?.total ?? 0);
  }

  return { platformRevenue, platformCost, affiliateCost };
}

async function computePreview(input: PreviewInput): Promise<{
  summary: PreviewSummary;
  rows: PreviewRowInternal[];
}> {
  if (!(input.distributionPct > 0 && input.distributionPct <= 100))
    throw new BadRequestError("DISTRIBUTION_PCT_OUT_OF_RANGE");
  if (!(input.maxRecipients > 0)) throw new BadRequestError("MAX_RECIPIENTS_INVALID");

  const { platformRevenue, platformCost, affiliateCost } = await fetchPlatformEconomics(
    input.periodFrom,
    input.periodTo,
  );
  const carriedOverhead = await getCumulativeOverhead();
  const netProfit = computeProfitShareNetProfit({
    platformRevenue,
    platformCost,
    affiliateCost,
    carriedOverhead,
  });
  const poolAmount = computePoolAmount(netProfit, input.distributionPct);

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
  const turnoverValues = top.map((r) => Number(r.turnover));
  const allocatedAmounts = distributeProRataAllocations(turnoverValues, poolAmount);

  const rows: PreviewRowInternal[] = top.map((r, i) => {
    const t = Number(r.turnover);
    const sharePct = topTurnoverTotal > 0 ? Number(((t / topTurnoverTotal) * 100).toFixed(5)) : 0;
    return {
      user_id: r.user_id,
      member_no: r.member_no,
      first_name: r.first_name,
      last_name: r.last_name,
      turnover_amount: t,
      share_pct: sharePct,
      allocated_amount: allocatedAmounts[i] ?? 0,
      rank_no: i + 1,
    };
  });

  return {
    summary: {
      period_type: input.periodType,
      period_from: input.periodFrom,
      period_to: input.periodTo,
      distribution_pct: input.distributionPct,
      max_recipients: input.maxRecipients,
      claim_expires_hours: input.claimExpiresHours,
      platform_revenue: platformRevenue,
      platform_cost: platformCost,
      affiliate_cost: affiliateCost,
      carried_overhead: carriedOverhead,
      net_profit: netProfit,
      pool_amount: poolAmount,
      top_turnover_total: topTurnoverTotal,
      eligible_count: rows.length,
    },
    rows,
  };
}

export async function preview(input: PreviewInput): Promise<PreviewApiResponse> {
  const { summary, rows } = await computePreview(input);
  return { summary, allocations: rows };
}

export async function createCampaign(input: PreviewInput & { actorId: string; notes?: string | null }) {
  const { summary, rows } = await computePreview(input);
  return tx(async (trx) => {
    const [c] = await trx
      .insert(profitShareCampaigns)
      .values({
        periodType: input.periodType,
        periodFrom: new Date(input.periodFrom),
        periodTo: new Date(input.periodTo),
        distributionPct: String(input.distributionPct),
        platformRevenue: String(summary.platform_revenue),
        platformCost: String(summary.platform_cost),
        affiliateCost: String(summary.affiliate_cost),
        carriedOverhead: String(summary.carried_overhead),
        netProfit: String(summary.net_profit),
        poolAmount: String(summary.pool_amount),
        topTurnoverTotal: String(summary.top_turnover_total),
        eligibleCount: summary.eligible_count,
        maxRecipients: input.maxRecipients,
        claimExpiresHours: input.claimExpiresHours,
        status: "draft",
        notes: input.notes ?? null,
        createdBy: input.actorId,
      })
      .returning({ id: profitShareCampaigns.id });
    if (!c) throw new Error("campaign insert failed");

    if (rows.length > 0) {
      const expiresAt = addHours(new Date(), input.claimExpiresHours);
      await trx.insert(profitShareAllocations).values(
        rows.map((r) => ({
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
        pool_amount: summary.pool_amount,
        carried_overhead: summary.carried_overhead,
        eligible_count: summary.eligible_count,
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
    await trx
      .update(profitShareAllocations)
      .set({ expiresAt })
      .where(
        and(
          eq(profitShareAllocations.campaignId, c.id),
          eq(profitShareAllocations.status, "pending"),
        ),
      );

    const poolAmount = Number(c.poolAmount);
    if (poolAmount > 0) {
      await addCumulativeOverhead(trx, poolAmount, {
        actorId: opts.actorId,
        campaignId: c.id,
        ip: opts.ip ?? null,
      });
    }

    await writeAudit({
      actorId: opts.actorId,
      action: "profit_share.publish",
      resourceType: "profit_share_campaign",
      resourceId: c.id,
      metadata: {
        published_at: publishedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        pool_amount: poolAmount,
      },
      ip: opts.ip ?? null,
    });

    scheduleProfitSharePublishNotifications({ campaignId: c.id, expiresAt });

    return { success: true };
  });
}

export async function closeCampaign(opts: {
  actorId: string;
  campaignId: string;
  ip?: string | null;
}): Promise<{ success: true; summary: CloseCampaignSummary }> {
  return tx(async (trx) => {
    const [c] = await trx
      .select()
      .from(profitShareCampaigns)
      .where(eq(profitShareCampaigns.id, opts.campaignId))
      .limit(1);
    if (!c) throw new NotFoundError("CAMPAIGN_NOT_FOUND");
    if (c.status !== "published") throw new ConflictError("WRONG_STATUS");

    const closedAt = new Date();
    await trx
      .update(profitShareCampaigns)
      .set({ status: "closed", closedAt, closedBy: opts.actorId })
      .where(eq(profitShareCampaigns.id, c.id));

    await trx
      .update(profitShareAllocations)
      .set({ status: "expired", expiredAt: closedAt })
      .where(
        and(
          eq(profitShareAllocations.campaignId, c.id),
          eq(profitShareAllocations.status, "pending"),
        ),
      );

    const [totals] = await trx.execute<{
      claimed_count: number;
      claimed_amount: string;
      pending_count: number;
      pending_amount: string;
      expired_count: number;
      expired_amount: string;
    }>(sql`
      SELECT
        COALESCE(sum(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END), 0)::int AS claimed_count,
        COALESCE(sum(CASE WHEN status = 'claimed' THEN allocated_amount ELSE 0 END), 0)::text AS claimed_amount,
        COALESCE(sum(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0)::int AS pending_count,
        COALESCE(sum(CASE WHEN status = 'pending' THEN allocated_amount ELSE 0 END), 0)::text AS pending_amount,
        COALESCE(sum(CASE WHEN status = 'expired' THEN 1 ELSE 0 END), 0)::int AS expired_count,
        COALESCE(sum(CASE WHEN status = 'expired' THEN allocated_amount ELSE 0 END), 0)::text AS expired_amount
      FROM profit_share_allocations
      WHERE campaign_id = ${c.id}
    `);
    const row = (totals as unknown as Array<Record<string, unknown>>)[0] ?? {};

    const summary: CloseCampaignSummary = {
      campaign_id: c.id,
      claimed_count: Number(row.claimed_count ?? 0),
      claimed_amount: Number(row.claimed_amount ?? 0),
      pending_count: Number(row.pending_count ?? 0),
      pending_amount: Number(row.pending_amount ?? 0),
      expired_count: Number(row.expired_count ?? 0),
      expired_amount: Number(row.expired_amount ?? 0),
      closed_at: closedAt.toISOString(),
      closed_by: opts.actorId,
    };

    await writeAudit({
      trx,
      actorId: opts.actorId,
      action: "profit_share.close",
      resourceType: "profit_share_campaign",
      resourceId: c.id,
      metadata: { ...summary },
      ip: opts.ip ?? null,
    });

    return { success: true as const, summary };
  });
}

export async function cancelCampaign(opts: {
  actorId: string;
  campaignId: string;
  ip?: string | null;
}): Promise<{ success: true }> {
  return tx(async (trx) => {
    const [c] = await trx
      .select()
      .from(profitShareCampaigns)
      .where(eq(profitShareCampaigns.id, opts.campaignId))
      .limit(1);
    if (!c) throw new NotFoundError("CAMPAIGN_NOT_FOUND");
    if (c.status !== "draft") throw new ConflictError("WRONG_STATUS");

    const cancelledAt = new Date();
    await trx
      .update(profitShareCampaigns)
      .set({ status: "cancelled", cancelledAt, cancelledBy: opts.actorId })
      .where(eq(profitShareCampaigns.id, c.id));

    await writeAudit({
      trx,
      actorId: opts.actorId,
      action: "profit_share.cancel",
      resourceType: "profit_share_campaign",
      resourceId: c.id,
      metadata: {
        cancelled_at: cancelledAt.toISOString(),
        pool_amount: Number(c.poolAmount),
      },
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
      c.closed_at,
      c.closed_by,
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
    closed_at: r.closed_at ? new Date(r.closed_at as string).toISOString() : null,
    closed_by: r.closed_by ? String(r.closed_by) : null,
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
