import { describe, it, expect } from "vitest";
import { computeWithdrawPenalty } from "../services/member.service";
import {
  pickHighestEligibleTier,
  type TierThreshold,
} from "../services/loyalty-tier.service";
import {
  computeCooldownFactor,
  computeSpendPoints,
  computeStreakFactor,
  computeTurnoverFactor,
  isInCooldown,
  WITHDRAW_COOLDOWN_THRESHOLD,
} from "../services/loyalty-scoring.service";
import {
  computePoolAmount,
  computeProfitShareNetProfit,
  distributeProRataAllocations,
} from "../services/admin/profit-share.service";

/** Seed-aligned 18 barem thresholds (LOYALTY_TIERS — L6). */
const SEED_TIERS: TierThreshold[] = [
  { id: 1, sortOrder: 1, minPoints: 0, minTurnover: 0 },
  { id: 2, sortOrder: 2, minPoints: 50, minTurnover: 1_000 },
  { id: 3, sortOrder: 3, minPoints: 150, minTurnover: 3_000 },
  { id: 4, sortOrder: 4, minPoints: 400, minTurnover: 10_000 },
  { id: 5, sortOrder: 5, minPoints: 700, minTurnover: 25_000 },
  { id: 6, sortOrder: 6, minPoints: 1_000, minTurnover: 50_000 },
  { id: 7, sortOrder: 7, minPoints: 2_500, minTurnover: 100_000 },
  { id: 8, sortOrder: 8, minPoints: 4_000, minTurnover: 250_000 },
  { id: 9, sortOrder: 9, minPoints: 5_000, minTurnover: 500_000 },
  { id: 10, sortOrder: 10, minPoints: 15_000, minTurnover: 750_000 },
  { id: 11, sortOrder: 11, minPoints: 20_000, minTurnover: 1_500_000 },
  { id: 12, sortOrder: 12, minPoints: 25_000, minTurnover: 2_000_000 },
  { id: 13, sortOrder: 13, minPoints: 60_000, minTurnover: 4_000_000 },
  { id: 14, sortOrder: 14, minPoints: 80_000, minTurnover: 7_000_000 },
  { id: 15, sortOrder: 15, minPoints: 100_000, minTurnover: 10_000_000 },
  { id: 16, sortOrder: 16, minPoints: 300_000, minTurnover: 20_000_000 },
  { id: 17, sortOrder: 17, minPoints: 400_000, minTurnover: 35_000_000 },
  { id: 18, sortOrder: 18, minPoints: 500_000, minTurnover: 50_000_000 },
];

describe("L1 — withdraw penalty formula", () => {
  it("returns 0 for non-positive amounts", () => {
    expect(computeWithdrawPenalty(0)).toBe(0);
    expect(computeWithdrawPenalty(-10)).toBe(0);
  });

  it("applies -2 pts per ₺10 block", () => {
    expect(computeWithdrawPenalty(9)).toBe(0);
    expect(computeWithdrawPenalty(10)).toBe(-2);
    expect(computeWithdrawPenalty(25)).toBe(-4);
    expect(computeWithdrawPenalty(100)).toBe(-20);
  });
});

describe("L2 — tier eligibility (points AND turnover)", () => {
  it("stays rookie I with zero stats", () => {
    expect(pickHighestEligibleTier(SEED_TIERS, 0, 0).id).toBe(1);
  });

  it("does not upgrade on points alone", () => {
    expect(pickHighestEligibleTier(SEED_TIERS, 10_000, 0).id).toBe(1);
    expect(pickHighestEligibleTier(SEED_TIERS, 500_000, 0).id).toBe(1);
  });

  it("does not upgrade on turnover alone", () => {
    expect(pickHighestEligibleTier(SEED_TIERS, 0, 100_000).id).toBe(1);
    expect(pickHighestEligibleTier(SEED_TIERS, 0, 50_000_000).id).toBe(1);
  });

  it("requires both thresholds for silver I", () => {
    expect(pickHighestEligibleTier(SEED_TIERS, 400, 10_000).id).toBe(4);
    expect(pickHighestEligibleTier(SEED_TIERS, 399, 10_000).id).toBe(3);
    expect(pickHighestEligibleTier(SEED_TIERS, 400, 9_999).id).toBe(3);
  });

  it("progresses through rookie barems quickly", () => {
    expect(pickHighestEligibleTier(SEED_TIERS, 50, 1_000).id).toBe(2);
    expect(pickHighestEligibleTier(SEED_TIERS, 150, 3_000).id).toBe(3);
  });

  it("picks the highest tier when both stats exceed multiple thresholds", () => {
    expect(pickHighestEligibleTier(SEED_TIERS, 30_000, 2_500_000).id).toBe(12);
    expect(pickHighestEligibleTier(SEED_TIERS, 600_000, 60_000_000).id).toBe(18);
  });
});

describe("L1 Faz 2 — LOYALTY_V3 spend scoring", () => {
  it("turnover_factor uses log2(min(count,32)+1) capped growth", () => {
    expect(computeTurnoverFactor(0)).toBeCloseTo(1);
    expect(computeTurnoverFactor(1)).toBeCloseTo(2);
    expect(computeTurnoverFactor(31)).toBeCloseTo(1 + Math.log2(32));
    expect(computeTurnoverFactor(100)).toBeCloseTo(1 + Math.log2(33));
  });

  it("streak_factor caps at 1.5×", () => {
    expect(computeStreakFactor(0)).toBe(1);
    expect(computeStreakFactor(4)).toBeCloseTo(1.2);
    expect(computeStreakFactor(10)).toBe(1.5);
    expect(computeStreakFactor(30)).toBe(1.5);
  });

  it("cooldown_factor halves multiplier", () => {
    expect(computeCooldownFactor(false)).toBe(1);
    expect(computeCooldownFactor(true)).toBe(0.5);
  });

  it("isInCooldown respects cooldown_until timestamp", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isInCooldown(future)).toBe(true);
    expect(isInCooldown(past)).toBe(false);
    expect(isInCooldown(null)).toBe(false);
  });

  it("computeSpendPoints applies full formula on ₺10 blocks", () => {
    // ₺100 → base 10; rookie 1.0×, no streak/cooldown, first monthly spend (+1 in factor)
    expect(
      computeSpendPoints({
        amount: 100,
        tierMultiplier: 1,
        monthlySpendCount: 0,
        streakDays: 0,
        inCooldown: false,
      }),
    ).toBe(10);

    // ₺25 → base 2; turnover only (2nd spend this month)
    expect(
      computeSpendPoints({
        amount: 25,
        tierMultiplier: 1,
        monthlySpendCount: 1,
        streakDays: 0,
        inCooldown: false,
      }),
    ).toBe(Math.floor(2 * computeTurnoverFactor(1)));

    // cooldown halves output
    expect(
      computeSpendPoints({
        amount: 100,
        tierMultiplier: 2,
        monthlySpendCount: 0,
        streakDays: 4,
        inCooldown: true,
      }),
    ).toBe(
      Math.floor(
        10 *
          computeTurnoverFactor(0) *
          computeStreakFactor(4) *
          2 *
          computeCooldownFactor(true),
      ),
    );
  });

  it("documents withdraw cooldown threshold", () => {
    expect(WITHDRAW_COOLDOWN_THRESHOLD).toBe(3);
  });
});

describe("PS1 — profit share net profit + carry-forward", () => {
  it("subtracts platform cost, affiliate cost, and carried overhead", () => {
    expect(
      computeProfitShareNetProfit({
        platformRevenue: 10_000,
        platformCost: 2_000,
        affiliateCost: 500,
        carriedOverhead: 1_500,
      }),
    ).toBe(6_000);
  });

  it("floors net profit at zero", () => {
    expect(
      computeProfitShareNetProfit({
        platformRevenue: 100,
        platformCost: 50,
        affiliateCost: 30,
        carriedOverhead: 200,
      }),
    ).toBe(0);
  });

  it("computePoolAmount rounds to 2 decimal places", () => {
    expect(computePoolAmount(1_234.567, 33.33)).toBe(411.48);
    expect(computePoolAmount(0, 50)).toBe(0);
  });
});

describe("PS10 — profit share pool remainder distribution", () => {
  it("allocations sum exactly to pool amount", () => {
    const pool = 100;
    const turnovers = [50, 30, 20];
    const amounts = distributeProRataAllocations(turnovers, pool);
    expect(amounts.reduce((s, a) => s + a, 0)).toBeCloseTo(pool, 2);
    expect(amounts[0]).toBeGreaterThanOrEqual(amounts[1]!);
    expect(amounts[1]).toBeGreaterThanOrEqual(amounts[2]!);
  });

  it("gives remainder cents to top recipients first", () => {
    const pool = 1;
    const amounts = distributeProRataAllocations([1, 1, 1], pool);
    expect(amounts).toEqual([0.34, 0.33, 0.33]);
    expect(amounts.reduce((s, a) => s + a, 0)).toBe(1);
  });

  it("returns zeros for empty or zero pool", () => {
    expect(distributeProRataAllocations([], 100)).toEqual([]);
    expect(distributeProRataAllocations([10, 20], 0)).toEqual([0, 0]);
  });
});
