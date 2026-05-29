/**
 * LOYALTY_V3 spend scoring — turnover, streak, tier multiplier, cooldown.
 *
 * spend_pts = floor(amount / 10) × turnover_factor × streak_factor × tier_mul × cooldown_factor
 */
import { eq, sql } from "drizzle-orm";
import { db, type Database } from "../db/client";
import { accounts } from "../db/schema";

export const ROLLING_WINDOW_DAYS = 30;
export const WITHDRAW_COOLDOWN_THRESHOLD = 3;
export const COOLDOWN_REASON_WITHDRAW = "withdraw_frequency";

export interface LoyaltySpendContext {
  monthlySpendCount: number;
  streakDays: number;
  inCooldown: boolean;
}

/** turnover_factor = 1 + log2(min(monthly_spend_count, 32) + 1) — current spend included via +1 */
export function computeTurnoverFactor(monthlySpendCount: number): number {
  const n = Math.min(Math.max(0, monthlySpendCount), 32) + 1;
  return 1 + Math.log2(n);
}

/** streak_factor = 1 + min(streak_days × 0.05, 0.5) */
export function computeStreakFactor(streakDays: number): number {
  return 1 + Math.min(Math.max(0, streakDays) * 0.05, 0.5);
}

export function computeCooldownFactor(inCooldown: boolean): number {
  return inCooldown ? 0.5 : 1;
}

/** LOYALTY_V3 spend point award (integer, floored). */
export function computeSpendPoints(input: {
  amount: number;
  tierMultiplier: number;
  monthlySpendCount: number;
  streakDays: number;
  inCooldown: boolean;
}): number {
  if (!(input.amount > 0) || !(input.tierMultiplier > 0)) return 0;
  const base = Math.floor(input.amount / 10);
  if (base <= 0) return 0;

  const raw =
    base *
    computeTurnoverFactor(input.monthlySpendCount) *
    computeStreakFactor(input.streakDays) *
    input.tierMultiplier *
    computeCooldownFactor(input.inCooldown);

  return Math.floor(raw);
}

export function isInCooldown(cooldownUntil: Date | string | null | undefined): boolean {
  if (!cooldownUntil) return false;
  return new Date(cooldownUntil).getTime() > Date.now();
}

function rollingSinceIso(): string {
  return new Date(Date.now() - ROLLING_WINDOW_DAYS * 86_400_000).toISOString();
}

/** Completed spend txs in the rolling 30-day window (excludes in-flight code). */
export async function queryMonthlySpendCount(
  userId: string,
  trx: Database = db,
): Promise<number> {
  const since = rollingSinceIso();
  const rows = await trx.execute<{ n: string }>(sql`
    SELECT count(*)::text AS n
    FROM transactions
    WHERE user_id = ${userId}
      AND type = 'spend'
      AND status = 'completed'
      AND created_at >= ${since}::timestamptz
  `);
  return Number((rows as unknown as Array<{ n: string }>)[0]?.n ?? 0);
}

/** Consecutive UTC calendar days (back from today) with ≥1 completed spend. */
export async function queryStreakDays(userId: string, trx: Database = db): Promise<number> {
  const rows = await trx.execute<{ d: string }>(sql`
    SELECT DISTINCT date_trunc('day', created_at AT TIME ZONE 'UTC')::date::text AS d
    FROM transactions
    WHERE user_id = ${userId} AND type = 'spend' AND status = 'completed'
    ORDER BY d DESC
    LIMIT 365
  `);
  const dayList = (rows as unknown as Array<{ d: string }>).map((r) => r.d);
  const today = new Date();
  const toUtcYmd = (d: Date) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };
  let streak = 0;
  for (let i = 0; i < dayList.length; i++) {
    const expected = new Date(today);
    expected.setUTCDate(today.getUTCDate() - i);
    if (dayList[i] === toUtcYmd(expected)) streak += 1;
    else break;
  }
  return streak;
}

export async function loadLoyaltySpendContext(
  userId: string,
  opts?: { cooldownUntil?: Date | string | null; trx?: Database },
): Promise<LoyaltySpendContext> {
  const trx = opts?.trx ?? db;
  let cooldownUntil = opts?.cooldownUntil;
  if (cooldownUntil === undefined) {
    const [acc] = await trx
      .select({ cooldownUntil: accounts.cooldownUntil })
      .from(accounts)
      .where(eq(accounts.userId, userId))
      .limit(1);
    cooldownUntil = acc?.cooldownUntil ?? null;
  }

  const [monthlySpendCount, streakDays] = await Promise.all([
    queryMonthlySpendCount(userId, trx),
    queryStreakDays(userId, trx),
  ]);

  return {
    monthlySpendCount,
    streakDays,
    inCooldown: isInCooldown(cooldownUntil),
  };
}

/**
 * L1 Faz 2 — 30 günde ≥3 withdraw → accounts.cooldown_until (+30 gün).
 * Call after the withdraw transaction row is committed inside the same trx.
 */
export async function maybeSetWithdrawCooldown(
  trx: Database,
  userId: string,
): Promise<{ applied: boolean; withdrawCount: number }> {
  const since = rollingSinceIso();
  const rows = await trx.execute<{ n: string }>(sql`
    SELECT count(*)::text AS n
    FROM transactions
    WHERE user_id = ${userId}
      AND type = 'merchant_withdraw'
      AND status = 'completed'
      AND created_at >= ${since}::timestamptz
  `);
  const withdrawCount = Number((rows as unknown as Array<{ n: string }>)[0]?.n ?? 0);
  if (withdrawCount < WITHDRAW_COOLDOWN_THRESHOLD) {
    return { applied: false, withdrawCount };
  }

  const until = new Date(Date.now() + ROLLING_WINDOW_DAYS * 86_400_000);
  await trx
    .update(accounts)
    .set({
      cooldownUntil: until,
      cooldownReason: COOLDOWN_REASON_WITHDRAW,
      updatedAt: new Date(),
    })
    .where(eq(accounts.userId, userId));

  return { applied: true, withdrawCount };
}
