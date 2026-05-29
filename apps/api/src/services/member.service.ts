/**
 * Member-facing reads (Phase 4).
 *
 * All queries are user-scoped by `userId` — never trust input IDs for the
 * authenticated user's data (replaces RLS guarantees).
 */
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, tx, type Database } from "../db/client";
import {
  accounts,
  loyaltyPointsLog,
  loyaltyTiers,
  notifications,
  paymentMethodTypes,
  profileChangeOtps as _profileChangeOtps, // unused but keeps import graph honest
  profiles,
  profitShareAllocations,
  profitShareCampaigns,
  referralConfig,
  referralRewardsLog,
  referrals,
  transactions,
  users,
} from "../db/schema";
import { ConflictError, NotFoundError, UnprocessableError } from "../lib/errors";
import { makeTxPublicNo } from "../lib/public-no";
import { queryLifetimeSpendTurnover } from "./loyalty-tier.service";
import {
  isInCooldown,
  queryMonthlySpendCount,
  queryStreakDays,
} from "./loyalty-scoring.service";

// ---------- transactions ----------
export interface ListTxParams {
  limit?: number;
  offset?: number;
  type?: string | null;
}

/**
 * Member transaction list.
 *
 * P0-7 — HARD_RULES #4: members must not see `description`, `merchant_ref`,
 * `fee`, `external_tx_id`, or any merchant identifying field. The frontend
 * shows only `txTypeLabel(tx.type)` + date + amount + `<TxIdBadge publicNo>`.
 * Server-side filtering is the authoritative gate; UI-only hiding leaks
 * fields to any scripted client.
 */
export async function myTransactions(userId: string, params: ListTxParams = {}) {
  const limit = Math.min(params.limit ?? 50, 200);
  const offset = Math.max(params.offset ?? 0, 0);
  const where = params.type
    ? and(eq(transactions.userId, userId), eq(transactions.type, params.type as never))
    : eq(transactions.userId, userId);
  const rows = await db
    .select({
      id: transactions.id,
      public_no: transactions.publicNo,
      type: transactions.type,
      status: transactions.status,
      amount: transactions.amount,
      balance_after: transactions.balanceAfter,
      created_at: transactions.createdAt,
    })
    .from(transactions)
    .where(where)
    .orderBy(desc(transactions.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(transactions)
    .where(where);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      public_no: r.public_no,
      type: r.type,
      status: r.status,
      amount: Number(r.amount),
      balance_after: r.balance_after === null ? null : Number(r.balance_after),
      created_at: r.created_at.toISOString(),
    })),
    total,
  };
}

// ---------- loyalty ----------
/**
 * Loyalty summary shape used by the legacy `my_loyalty_summary` SQL function.
 * Returned as an array (single row) for backwards-compatibility with the
 * frontend, which calls `rpc<LoyaltySummary[]>("my_loyalty_summary")` and
 * picks `[0]`.
 */
export interface LoyaltySummaryRow {
  user_id: string;
  balance: number;
  total_points: number;
  current_tier_id: number;
  tier_name: string;
  point_multiplier: number;
  cashback_pct: number;
  tier_min_points: number;
  tier_min_turnover: number;
  next_tier_id: number | null;
  next_tier_name: string | null;
  next_tier_min_points: number | null;
  next_tier_min_turnover: number | null;
  streak_days: number;
  monthly_spend_count: number;
  lifetime_turnover: number;
  in_cooldown: boolean;
  cooldown_until: string | null;
  cooldown_reason: string | null;
}

export async function myLoyaltySummary(userId: string): Promise<LoyaltySummaryRow[]> {
  const [acc] = await db
    .select({
      balance: accounts.balance,
      totalPoints: accounts.totalPoints,
      currentTierId: accounts.currentTierId,
      cooldownUntil: accounts.cooldownUntil,
      cooldownReason: accounts.cooldownReason,
    })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .limit(1);
  if (!acc) throw new NotFoundError("ACCOUNT_NOT_FOUND");

  const tiers = await db
    .select()
    .from(loyaltyTiers)
    .where(eq(loyaltyTiers.isArchived, false))
    .orderBy(loyaltyTiers.sortOrder);

  const currentTier = tiers.find((t) => t.id === acc.currentTierId) ?? tiers[0];
  if (!currentTier) throw new NotFoundError("LOYALTY_TIER_NOT_FOUND");
  const nextTier =
    tiers.find((t) => t.sortOrder > currentTier.sortOrder) ?? null;

  // Lifetime turnover = SUM of completed spend amounts (Akış A consumption).
  const lifetimeTurnover = await queryLifetimeSpendTurnover(userId);

  const [monthlySpendCount, streakDays] = await Promise.all([
    queryMonthlySpendCount(userId),
    queryStreakDays(userId),
  ]);

  const inCooldown = isInCooldown(acc.cooldownUntil);

  const row: LoyaltySummaryRow = {
    user_id: userId,
    balance: Number(acc.balance ?? 0),
    total_points: acc.totalPoints,
    current_tier_id: currentTier.id,
    tier_name: currentTier.displayName,
    point_multiplier: Number(currentTier.pointMultiplier),
    cashback_pct: Number(currentTier.cashbackPct),
    tier_min_points: currentTier.minPoints,
    tier_min_turnover: Number(currentTier.minTurnover),
    next_tier_id: nextTier?.id ?? null,
    next_tier_name: nextTier?.displayName ?? null,
    next_tier_min_points: nextTier?.minPoints ?? null,
    next_tier_min_turnover: nextTier ? Number(nextTier.minTurnover) : null,
    streak_days: streakDays,
    monthly_spend_count: monthlySpendCount,
    lifetime_turnover: lifetimeTurnover,
    in_cooldown: inCooldown,
    cooldown_until: inCooldown ? acc.cooldownUntil!.toISOString() : null,
    cooldown_reason: inCooldown ? acc.cooldownReason : null,
  };

  return [row];
}

/** LOYALTY_V3 — withdraw_penalty = -floor(amount / 10) × 2 */
export function computeWithdrawPenalty(withdrawAmount: number): number {
  if (!(withdrawAmount > 0)) return 0;
  const penalty = -Math.floor(withdrawAmount / 10) * 2;
  return penalty === 0 ? 0 : penalty;
}

/**
 * L1 Faz 1 — Deduct loyalty points on withdraw completion.
 * Idempotent via loyalty_points_log (user_id, reason, reference_id) unique index.
 */
export async function applyWithdrawPenalty(
  trx: Database,
  opts: { userId: string; withdrawAmount: number; transactionId: string },
): Promise<number> {
  const penalty = computeWithdrawPenalty(opts.withdrawAmount);
  if (penalty === 0) return 0;

  const existing = await trx.execute<{ id: string }>(sql`
    SELECT id FROM loyalty_points_log
    WHERE user_id = ${opts.userId}
      AND reason = 'withdraw_penalty'
      AND reference_id = ${opts.transactionId}
    LIMIT 1
  `);
  if ((existing as unknown as unknown[]).length > 0) return penalty;

  await trx
    .update(accounts)
    .set({
      totalPoints: sql`GREATEST(${accounts.totalPoints} + ${penalty}, 0)`,
      updatedAt: new Date(),
    })
    .where(eq(accounts.userId, opts.userId));

  await trx.insert(loyaltyPointsLog).values({
    userId: opts.userId,
    points: penalty,
    reason: "withdraw_penalty",
    referenceId: opts.transactionId,
    metadata: { withdraw_amount: opts.withdrawAmount },
  });

  return penalty;
}

// ---------- profit share ----------
export async function myProfitShareRewards(userId: string) {
  const rows = await db
    .select({
      id: profitShareAllocations.id,
      campaignId: profitShareAllocations.campaignId,
      rankNo: profitShareAllocations.rankNo,
      turnoverAmount: profitShareAllocations.turnoverAmount,
      sharePct: profitShareAllocations.sharePct,
      allocatedAmount: profitShareAllocations.allocatedAmount,
      status: profitShareAllocations.status,
      expiresAt: profitShareAllocations.expiresAt,
      claimedAt: profitShareAllocations.claimedAt,
      expiredAt: profitShareAllocations.expiredAt,
      claimTxPublicNo: transactions.publicNo,
      periodType: profitShareCampaigns.periodType,
      periodFrom: profitShareCampaigns.periodFrom,
      periodTo: profitShareCampaigns.periodTo,
    })
    .from(profitShareAllocations)
    .innerJoin(
      profitShareCampaigns,
      eq(profitShareAllocations.campaignId, profitShareCampaigns.id),
    )
    .leftJoin(transactions, eq(transactions.id, profitShareAllocations.claimTxId))
    .where(
      and(
        eq(profitShareAllocations.userId, userId),
        eq(profitShareCampaigns.status, "published"),
      ),
    )
    .orderBy(desc(profitShareAllocations.createdAt));

  return rows.map((r) => ({
    id: r.id,
    campaignId: r.campaignId,
    rankNo: r.rankNo,
    turnoverAmount: Number(r.turnoverAmount),
    sharePct: Number(r.sharePct),
    allocatedAmount: Number(r.allocatedAmount),
    status: r.status as "pending" | "claimed" | "expired",
    expiresAt: r.expiresAt.toISOString(),
    claimedAt: r.claimedAt?.toISOString() ?? null,
    expiredAt: r.expiredAt?.toISOString() ?? null,
    claimTxPublicNo: r.claimTxPublicNo ?? null,
    campaign: {
      periodType: r.periodType,
      periodFrom: r.periodFrom.toISOString(),
      periodTo: r.periodTo.toISOString(),
    },
  }));
}

/**
 * Member claims a pending profit-share allocation.
 *
 * Atomic flow (single Postgres transaction):
 *   1. SELECT FOR UPDATE the allocation (user-scoped)
 *   2. Reject if missing, not pending, or past expiry
 *   3. INSERT a `profit_share` transaction (with public_no)
 *   4. UPDATE accounts.balance += allocated_amount
 *   5. UPDATE allocation → status='claimed', claim_tx_id, claimed_at
 *
 * Returns the legacy-shaped envelope so the rpc dispatcher can pass through:
 *   { success: true, amount, claim_tx_public_no }   on success
 *   throws (NotFoundError / ConflictError) on failure
 */
export async function claimProfitShareReward(
  userId: string,
  allocationId: string,
): Promise<{ success: true; amount: number; claim_tx_public_no: string }> {
  return tx(async (trx) => {
    // Lock the allocation row to prevent double-claim races.
    // P0-24 — join campaigns and require status='published'. Previously a draft
    // campaign's pending allocations were already visible AND claimable from
    // the member side, so an admin who created a draft (to preview) would
    // accidentally pay out before publishing. Filtering at the WHERE level
    // also keeps `ALLOCATION_NOT_FOUND` ambiguous (no oracle on draft state).
    const [row] = await trx
      .select({
        id: profitShareAllocations.id,
        userId: profitShareAllocations.userId,
        campaignId: profitShareAllocations.campaignId,
        allocatedAmount: profitShareAllocations.allocatedAmount,
        status: profitShareAllocations.status,
        expiresAt: profitShareAllocations.expiresAt,
        campaignStatus: profitShareCampaigns.status,
      })
      .from(profitShareAllocations)
      .innerJoin(
        profitShareCampaigns,
        eq(profitShareCampaigns.id, profitShareAllocations.campaignId),
      )
      .where(eq(profitShareAllocations.id, allocationId))
      .for("update")
      .limit(1);

    if (!row) throw new NotFoundError("ALLOCATION_NOT_FOUND");
    // Reveal nothing about other users' allocations.
    if (row.userId !== userId) throw new NotFoundError("ALLOCATION_NOT_FOUND");
    // Draft / archived / closed campaign → allocation not yet (or no longer)
    // claimable. 404 keeps the campaign state opaque to the caller.
    if (row.campaignStatus !== "published") throw new NotFoundError("ALLOCATION_NOT_FOUND");
    if (row.status === "claimed") throw new ConflictError("ALREADY_CLAIMED");
    if (row.status === "expired") throw new ConflictError("EXPIRED");
    if (row.status !== "pending") throw new ConflictError("NOT_CLAIMABLE");
    if (row.expiresAt.getTime() < Date.now()) {
      // Mark expired in the same transaction so the UI stops showing it as pending.
      await trx
        .update(profitShareAllocations)
        .set({ status: "expired", expiredAt: new Date() })
        .where(eq(profitShareAllocations.id, row.id));
      throw new ConflictError("EXPIRED");
    }

    const amountStr = row.allocatedAmount; // numeric preserved as string
    const amount = Number(amountStr);
    if (!(amount > 0)) throw new UnprocessableError("AMOUNT_ZERO");

    // P0-40 — lock + read the account balance so balance_after is the actual
    // post-credit value. The lock also serialises with concurrent spend/topup
    // claims to keep the running-balance audit consistent.
    const [memAcc] = await trx.execute<{ balance: string }>(sql`
      SELECT balance FROM accounts WHERE user_id = ${userId} FOR UPDATE
    `);
    if (!memAcc) throw new NotFoundError("ACCOUNT_NOT_FOUND");

    const publicNo = await makeTxPublicNo(trx, "profit_share");
    const balanceAfter = (Number(memAcc.balance) + amount).toFixed(2);
    const [txn] = await trx
      .insert(transactions)
      .values({
        publicNo,
        userId,
        type: "profit_share",
        status: "completed",
        amount: amountStr,
        fee: "0",
        balanceAfter,
        description: "profit_share",
        referenceId: row.id,
        metadata: {
          campaign_id: row.campaignId,
          allocation_id: row.id,
        },
      })
      .returning({ id: transactions.id, publicNo: transactions.publicNo });
    if (!txn) throw new Error("transaction insert failed");

    await trx
      .update(accounts)
      .set({
        balance: sql`${accounts.balance} + ${amountStr}`,
        updatedAt: new Date(),
      })
      .where(eq(accounts.userId, userId));

    await trx
      .update(profitShareAllocations)
      .set({
        status: "claimed",
        claimedAt: new Date(),
        claimTxId: txn.id,
      })
      .where(eq(profitShareAllocations.id, row.id));

    return { success: true as const, amount, claim_tx_public_no: txn.publicNo ?? publicNo };
  });
}

// ---------- referrals ----------
export async function myReferralLink(userId: string) {
  const [p] = await db
    .select({ referralCode: profiles.referralCode })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  const code = p?.referralCode ?? null;
  return {
    referralCode: code,
    shareUrl: code ? `/auth?ref=${encodeURIComponent(code)}` : null,
  };
}

export async function myReferralStats(userId: string) {
  const [stats] = await db.execute(sql<{
    referred_count: number;
    qualified_count: number;
    rewarded_count: number;
    total_points: number;
    total_balance: string;
  }>`
    SELECT
      (SELECT count(*)::int FROM referrals WHERE referrer_user_id = ${userId}) AS referred_count,
      (SELECT count(*)::int FROM referrals WHERE referrer_user_id = ${userId} AND status IN ('qualified','rewarded')) AS qualified_count,
      (SELECT count(*)::int FROM referrals WHERE referrer_user_id = ${userId} AND status = 'rewarded') AS rewarded_count,
      COALESCE((SELECT sum(points_awarded)::int FROM referral_rewards_log WHERE recipient_user_id = ${userId}), 0) AS total_points,
      COALESCE((SELECT sum(balance_awarded)::text FROM referral_rewards_log WHERE recipient_user_id = ${userId}), '0') AS total_balance
  `);
  const row = stats as unknown as {
    referred_count: number;
    qualified_count: number;
    rewarded_count: number;
    total_points: number;
    total_balance: string;
  };
  return {
    referredCount: row.referred_count,
    qualifiedCount: row.qualified_count,
    rewardedCount: row.rewarded_count,
    totalPointsEarned: row.total_points,
    totalBalanceEarned: Number(row.total_balance ?? 0),
  };
}

function maskName(first: string, last: string): string {
  const f = first.charAt(0).toUpperCase() + (first.length > 1 ? "***" : "");
  const l = last.charAt(0).toUpperCase() + (last.length > 1 ? "***" : "");
  return `${f} ${l}`;
}

export async function myReferrals(userId: string) {
  const rows = await db
    .select({
      id: referrals.id,
      refereeUserId: referrals.refereeUserId,
      status: referrals.status,
      createdAt: referrals.createdAt,
      qualifiedAt: referrals.qualifiedAt,
      memberNo: profiles.memberNo,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
    })
    .from(referrals)
    .innerJoin(profiles, eq(profiles.id, referrals.refereeUserId))
    .where(eq(referrals.referrerUserId, userId))
    .orderBy(desc(referrals.createdAt));
  return rows.map((r) => ({
    id: r.id,
    refereeUserId: r.refereeUserId,
    refereeMemberNo: r.memberNo,
    refereeMaskedName: maskName(r.firstName, r.lastName),
    status: r.status as "pending" | "qualified" | "rewarded" | "expired" | "cancelled",
    createdAt: r.createdAt.toISOString(),
    qualifiedAt: r.qualifiedAt?.toISOString() ?? null,
  }));
}

// ---------- notifications ----------
export async function myNotifications(userId: string, limit = 50) {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(limit, 200));
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    titleTr: r.titleTr,
    bodyTr: r.bodyTr,
    titleEn: r.titleEn,
    bodyEn: r.bodyEn,
    linkUrl: r.linkUrl,
    readAt: r.readAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function myUnreadCount(userId: string) {
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return count;
}

export async function markAllNotificationsRead(userId: string) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

// ---------- payment method types ----------
export async function listMethodTypes(direction: "topup" | "withdraw" | "both") {
  const rows = await db
    .select()
    .from(paymentMethodTypes)
    .where(
      and(
        eq(paymentMethodTypes.isEnabled, true),
        sql`${paymentMethodTypes.availableFor} IN ('both', ${direction})`,
      ),
    )
    .orderBy(paymentMethodTypes.sortOrder);
  return rows.map((r) => ({
    code: r.code,
    labelTr: r.labelTr,
    labelEn: r.labelEn,
    availableFor: r.availableFor as "topup" | "withdraw" | "both",
    withdrawEtaMin: r.withdrawEtaMin,
    withdrawEtaMax: r.withdrawEtaMax,
    withdrawEtaUnit: r.withdrawEtaUnit as "minute" | "hour" | "business_day",
  }));
}

// ---------- profile self-view ----------
export async function myProfile(userId: string) {
  const [p] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  if (!p) return null;
  const [acc] = await db
    .select({ balance: accounts.balance, reserved: accounts.reservedBalance })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .limit(1);
  return {
    memberNo: p.memberNo,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    phone: p.phone,
    kycStatus: p.kycStatus,
    isFrozen: p.isFrozen,
    referralCode: p.referralCode,
    balance: Number(acc?.balance ?? 0),
    reservedBalance: Number(acc?.reserved ?? 0),
  };
}
