/**
 * L2 — Otomatik tier yükseltme, manuel düşürme (admin).
 *
 * Upgrade: BOTH total_points >= tier.min_points AND lifetime spend turnover
 *          >= tier.min_turnover. Only moves up (sort_order); never auto-downgrades.
 * Downgrade: admin-only via `setMemberTier` (loyalty:manage).
 * Audit: loyalty_points_log (tier_upgrade / tier_downgrade) + writeAudit on admin set.
 */
import { asc, eq, sql } from "drizzle-orm";
import { db, tx, type Database } from "../db/client";
import { accounts, loyaltyPointsLog, loyaltyTiers } from "../db/schema";
import { BadRequestError, NotFoundError } from "../lib/errors";
import { writeAudit } from "./admin/audit";

export interface TierThreshold {
  id: number;
  sortOrder: number;
  minPoints: number;
  minTurnover: number;
  displayName?: string;
}

/** Pure eligibility — highest sort_order tier where both thresholds are met. */
export function pickHighestEligibleTier(
  tiers: readonly TierThreshold[],
  totalPoints: number,
  lifetimeTurnover: number,
): TierThreshold {
  if (tiers.length === 0) {
    throw new Error("LOYALTY_TIERS_EMPTY");
  }
  const sorted = [...tiers].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      a.minPoints - b.minPoints ||
      a.minTurnover - b.minTurnover,
  );
  let best = sorted[0]!;
  for (const t of sorted) {
    if (totalPoints >= t.minPoints && lifetimeTurnover >= t.minTurnover) {
      best = t;
    }
  }
  return best;
}

async function loadActiveTiers(trx: Database) {
  return trx
    .select()
    .from(loyaltyTiers)
    .where(eq(loyaltyTiers.isArchived, false))
    .orderBy(asc(loyaltyTiers.sortOrder));
}

/** Lifetime commerce spend turnover (completed `spend` txs). */
export async function queryLifetimeSpendTurnover(
  userId: string,
  trx: Database = db,
): Promise<number> {
  const [row] = await trx.execute<{ sum: string | null }>(sql`
    SELECT COALESCE(SUM(amount), 0)::text AS sum
    FROM transactions
    WHERE user_id = ${userId} AND type = 'spend' AND status = 'completed'
  `);
  return Number((row as unknown as Array<{ sum: string | null }>)[0]?.sum ?? 0);
}

function toThresholds(
  tiers: Awaited<ReturnType<typeof loadActiveTiers>>,
): TierThreshold[] {
  return tiers.map((t) => ({
    id: t.id,
    sortOrder: t.sortOrder,
    minPoints: t.minPoints,
    minTurnover: Number(t.minTurnover),
    displayName: t.displayName,
  }));
}

/** Resolve the tier a member qualifies for right now (no mutation). */
export async function resolveEligibleTier(
  userId: string,
  trx: Database = db,
): Promise<TierThreshold> {
  const [acc] = await trx
    .select({ totalPoints: accounts.totalPoints })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .limit(1);
  if (!acc) throw new NotFoundError("ACCOUNT_NOT_FOUND");

  const tiers = await loadActiveTiers(trx);
  const lifetimeTurnover = await queryLifetimeSpendTurnover(userId, trx);
  return pickHighestEligibleTier(toThresholds(tiers), acc.totalPoints, lifetimeTurnover);
}

export interface MaybeUpgradeResult {
  upgraded: boolean;
  fromTierId?: number;
  toTierId?: number;
}

/**
 * Auto-upgrade when eligible tier rank exceeds current. Idempotent — repeated
 * calls are no-ops once the account sits on the highest qualifying tier.
 */
export async function maybeUpgradeTier(
  userId: string,
  trx: Database = db,
): Promise<MaybeUpgradeResult> {
  const [acc] = await trx
    .select({
      totalPoints: accounts.totalPoints,
      currentTierId: accounts.currentTierId,
    })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .limit(1);
  if (!acc) throw new NotFoundError("ACCOUNT_NOT_FOUND");

  const tiers = await loadActiveTiers(trx);
  if (tiers.length === 0) throw new NotFoundError("LOYALTY_TIER_NOT_FOUND");

  const thresholds = toThresholds(tiers);
  const lifetimeTurnover = await queryLifetimeSpendTurnover(userId, trx);
  const eligible = pickHighestEligibleTier(thresholds, acc.totalPoints, lifetimeTurnover);

  const current = tiers.find((t) => t.id === acc.currentTierId) ?? tiers[0]!;
  if (eligible.sortOrder <= current.sortOrder) {
    return { upgraded: false };
  }

  const eligibleRow = tiers.find((t) => t.id === eligible.id)!;

  await trx
    .update(accounts)
    .set({ currentTierId: eligible.id, updatedAt: new Date() })
    .where(eq(accounts.userId, userId));

  await trx.insert(loyaltyPointsLog).values({
    userId,
    points: 0,
    reason: "tier_upgrade",
    metadata: {
      from_tier_id: current.id,
      from_tier_name: current.displayName,
      to_tier_id: eligibleRow.id,
      to_tier_name: eligibleRow.displayName,
      total_points: acc.totalPoints,
      lifetime_turnover: lifetimeTurnover,
      automatic: true,
    },
  });

  return { upgraded: true, fromTierId: current.id, toTierId: eligibleRow.id };
}

/** Admin manual tier change (upgrade or downgrade). L2: downgrades are admin-only. */
export async function setMemberTier(opts: {
  actorId: string;
  userId: string;
  tierId: number;
  reason: string;
  ip?: string | null;
}) {
  if (!opts.reason?.trim()) throw new BadRequestError("REASON_REQUIRED");

  return tx(async (trx) => {
    await trx.execute(sql`SELECT 1 FROM accounts WHERE user_id = ${opts.userId} FOR UPDATE`);

    const [acc] = await trx
      .select({
        totalPoints: accounts.totalPoints,
        currentTierId: accounts.currentTierId,
      })
      .from(accounts)
      .where(eq(accounts.userId, opts.userId))
      .limit(1);
    if (!acc) throw new NotFoundError("ACCOUNT_NOT_FOUND");

    const tiers = await loadActiveTiers(trx);
    const newTier = tiers.find((t) => t.id === opts.tierId);
    if (!newTier) throw new NotFoundError("LOYALTY_TIER_NOT_FOUND");

    const current = tiers.find((t) => t.id === acc.currentTierId) ?? tiers[0]!;
    if (newTier.id === current.id) {
      return { success: true as const, unchanged: true as const };
    }

    const isDowngrade = newTier.sortOrder < current.sortOrder;
    const logReason = isDowngrade ? "tier_downgrade" : "tier_upgrade";

    await trx
      .update(accounts)
      .set({ currentTierId: newTier.id, updatedAt: new Date() })
      .where(eq(accounts.userId, opts.userId));

    await trx.insert(loyaltyPointsLog).values({
      userId: opts.userId,
      points: 0,
      reason: logReason,
      metadata: {
        from_tier_id: current.id,
        from_tier_name: current.displayName,
        to_tier_id: newTier.id,
        to_tier_name: newTier.displayName,
        total_points: acc.totalPoints,
        lifetime_turnover: await queryLifetimeSpendTurnover(opts.userId, trx),
        automatic: false,
        admin_reason: opts.reason.trim(),
        actor_id: opts.actorId,
      },
    });

    await writeAudit({
      actorId: opts.actorId,
      action: isDowngrade ? "member.tier_downgrade" : "member.tier_set",
      resourceType: "profile",
      resourceId: opts.userId,
      before: { current_tier_id: current.id, tier_name: current.displayName },
      after: { current_tier_id: newTier.id, tier_name: newTier.displayName },
      metadata: { reason: opts.reason.trim() },
      ip: opts.ip ?? null,
      trx,
    });

    return {
      success: true as const,
      unchanged: false as const,
      fromTierId: current.id,
      toTierId: newTier.id,
    };
  });
}
