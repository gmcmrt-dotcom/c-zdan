import { describe, it, expect } from "vitest";
import { computeWithdrawPenalty } from "../services/member.service";
import {
  pickHighestEligibleTier,
  type TierThreshold,
} from "../services/loyalty-tier.service";

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
