import { z } from "zod";
import { MoneyAmount } from "./common";

export const AdminQualifyReferralManual = z.object({
  _referral_id: z.string().uuid(),
  _reason: z.string().trim().min(3).max(500),
});
export type AdminQualifyReferralManual = z.infer<typeof AdminQualifyReferralManual>;

export const AdminCancelReferral = z.object({
  _referral_id: z.string().uuid(),
  _reason: z.string().trim().min(3).max(500),
});
export type AdminCancelReferral = z.infer<typeof AdminCancelReferral>;

export const AdminSetReferralConfig = z.object({
  _payload: z.object({
    referrer_points: z.coerce.number().int().min(0),
    referrer_balance: MoneyAmount,
    referee_points: z.coerce.number().int().min(0),
    referee_balance: MoneyAmount,
    min_spend_to_qualify: MoneyAmount,
    monthly_referral_cap: z.coerce.number().int().min(0),
    monthly_reward_cap: MoneyAmount.optional(),
    ip_rate_limit_per_24h: z.coerce.number().int().min(0),
    expire_after_days: z.coerce.number().int().min(1).max(3650),
    is_active: z.boolean(),
  }),
});
export type AdminSetReferralConfig = z.infer<typeof AdminSetReferralConfig>;

export const AdminSetUserOverride = z.object({
  _user_id: z.string().uuid(),
  _resource: z.string().trim().min(1).max(80),
  _action: z.string().trim().min(1).max(80),
  _granted: z.boolean(),
  _reason: z.string().trim().max(500).nullable().optional(),
});
export type AdminSetUserOverride = z.infer<typeof AdminSetUserOverride>;

export const AdminRemoveUserOverride = z.object({
  _user_id: z.string().uuid(),
  _resource: z.string().trim().min(1).max(80),
  _action: z.string().trim().min(1).max(80),
});
export type AdminRemoveUserOverride = z.infer<typeof AdminRemoveUserOverride>;

export const AdminAffiliateCosts = z.object({
  _since: z.string().datetime().optional(),
});
export type AdminAffiliateCosts = z.infer<typeof AdminAffiliateCosts>;

export const AdminApproveAffiliatePayout = z.object({
  _payout_id: z.string().uuid(),
});
export type AdminApproveAffiliatePayout = z.infer<typeof AdminApproveAffiliatePayout>;

export const AdminRejectAffiliatePayout = z.object({
  _payout_id: z.string().uuid(),
  _reason: z.string().trim().min(3).max(500),
});
export type AdminRejectAffiliatePayout = z.infer<typeof AdminRejectAffiliatePayout>;

export const AdminMarkAffiliatePayoutPaid = z.object({
  _payout_id: z.string().uuid(),
  _transfer_ref: z.string().trim().max(200).nullable().optional(),
});
export type AdminMarkAffiliatePayoutPaid = z.infer<typeof AdminMarkAffiliatePayoutPaid>;

export const MerchantCashoutRequest = z.object({
  merchant_id: z.string().uuid(),
  method_code: z.string().trim().min(1).max(40),
  amount: MoneyAmount.refine((n) => n > 0, "amount must be positive"),
  payout_address: z.string().trim().min(8).max(256),
  /** Required for USDT methods — platform revenue (fee). */
  commission: MoneyAmount.optional(),
});
export type MerchantCashoutRequest = z.infer<typeof MerchantCashoutRequest>;
