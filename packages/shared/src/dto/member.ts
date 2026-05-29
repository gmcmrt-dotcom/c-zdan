import { z } from "zod";
import { IsoDate, Money, Pagination, Uuid } from "./common";

// ---------- Transactions ----------
export const TxTypeEnum = z.enum([
  "topup",
  "spend",
  "refund",
  "adjustment",
  "bonus",
  "merchant_deposit",
  "merchant_withdraw",
  "merchant_credit",
  "referral_bonus",
  "affiliate_commission",
  "affiliate_payout",
  "profit_share",
]);
export type TxType = z.infer<typeof TxTypeEnum>;

export const TxStatusEnum = z.enum(["pending", "completed", "failed", "reversed"]);
export type TxStatus = z.infer<typeof TxStatusEnum>;

export const TransactionRow = z.object({
  id: Uuid,
  public_no: z.string(),
  type: TxTypeEnum,
  status: TxStatusEnum,
  amount: Money,
  fee: Money,
  balance_after: Money.nullable(),
  description: z.string().nullable(),
  merchant_ref: z.string().nullable(),
  external_tx_id: z.string().nullable(),
  created_at: IsoDate,
});
export type TransactionRow = z.infer<typeof TransactionRow>;

export const MyTransactionsRequest = Pagination.extend({
  type: TxTypeEnum.optional(),
});
export type MyTransactionsRequest = z.infer<typeof MyTransactionsRequest>;

export const MyTransactionsResponse = z.object({
  rows: z.array(TransactionRow),
  total: z.number().int().nonnegative(),
});
export type MyTransactionsResponse = z.infer<typeof MyTransactionsResponse>;

// ---------- Loyalty ----------
export const LoyaltySummary = z.object({
  totalPoints: z.number().int(),
  tier: z.object({
    id: z.number().int(),
    levelName: z.string(),
    displayName: z.string(),
    sortOrder: z.number().int(),
    minPoints: z.number().int(),
    cashbackPct: Money,
    commissionDiscountPct: Money,
    pointMultiplier: Money,
  }),
  nextTier: z
    .object({
      id: z.number().int(),
      displayName: z.string(),
      minPoints: z.number().int(),
      pointsToReach: z.number().int(),
    })
    .nullable(),
  recentEarnings: z.array(
    z.object({
      id: Uuid,
      points: z.number().int(),
      reason: z.string(),
      createdAt: IsoDate,
    }),
  ),
});
export type LoyaltySummary = z.infer<typeof LoyaltySummary>;

// ---------- Profit share ----------
export const ProfitShareReward = z.object({
  id: Uuid,
  campaignId: Uuid,
  rankNo: z.number().int(),
  turnoverAmount: Money,
  sharePct: Money,
  allocatedAmount: Money,
  status: z.enum(["pending", "claimed", "expired"]),
  expiresAt: IsoDate,
  claimedAt: IsoDate.nullable(),
  expiredAt: IsoDate.nullable(),
  claimTxPublicNo: z.string().nullable(),
  campaign: z.object({
    periodType: z.string(),
    periodFrom: IsoDate,
    periodTo: IsoDate,
  }),
});
export type ProfitShareReward = z.infer<typeof ProfitShareReward>;

// ---------- Referrals ----------
export const ReferralLinkResponse = z.object({
  referralCode: z.string().nullable(),
  shareUrl: z.string().nullable(),
});
export type ReferralLinkResponse = z.infer<typeof ReferralLinkResponse>;

export const ReferralStats = z.object({
  referredCount: z.number().int(),
  qualifiedCount: z.number().int(),
  rewardedCount: z.number().int(),
  totalPointsEarned: z.number().int(),
  totalBalanceEarned: Money,
});
export type ReferralStats = z.infer<typeof ReferralStats>;

export const ReferralRow = z.object({
  id: Uuid,
  refereeUserId: Uuid,
  refereeMemberNo: z.string(),
  refereeMaskedName: z.string(),
  status: z.enum(["pending", "qualified", "rewarded", "expired", "cancelled"]),
  createdAt: IsoDate,
  qualifiedAt: IsoDate.nullable(),
});
export type ReferralRow = z.infer<typeof ReferralRow>;

// ---------- Notifications ----------
export const NotificationRow = z.object({
  id: Uuid,
  category: z.string(),
  titleTr: z.string(),
  bodyTr: z.string(),
  titleEn: z.string().nullable(),
  bodyEn: z.string().nullable(),
  linkUrl: z.string().nullable(),
  readAt: IsoDate.nullable(),
  createdAt: IsoDate,
});
export type NotificationRow = z.infer<typeof NotificationRow>;

// ---------- Method types ----------
export const PaymentMethodType = z.object({
  code: z.string(),
  labelTr: z.string(),
  labelEn: z.string(),
  availableFor: z.enum(["topup", "withdraw", "both"]),
  withdrawEtaMin: z.number().int(),
  withdrawEtaMax: z.number().int(),
  withdrawEtaUnit: z.enum(["minute", "hour", "business_day"]),
});
export type PaymentMethodType = z.infer<typeof PaymentMethodType>;
