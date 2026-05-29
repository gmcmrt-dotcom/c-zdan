import { z } from "zod";
import { IsoDate, Money, Uuid } from "./common";

// --------- Payment code (Akış A) ---------
export const PreviewSpendRequest = z.object({ amount: Money });
export const PreviewSpendResponse = z.object({
  amount: Money,
  fee: Money,
  reservedPoints: z.number().int(),
  newBalance: Money,
  tierSnapshot: z.object({
    id: z.number().int(),
    displayName: z.string(),
    pointMultiplier: Money,
  }),
});
export type PreviewSpendRequest = z.infer<typeof PreviewSpendRequest>;
export type PreviewSpendResponse = z.infer<typeof PreviewSpendResponse>;

export const CreatePaymentCodeRequest = z.object({
  amount: Money,
  ttlSeconds: z.number().int().min(60).max(3600).default(300),
});
export const PaymentCodeResponse = z.object({
  id: Uuid,
  code: z.string(),
  amount: Money,
  expiresAt: IsoDate,
  status: z.enum(["active", "consumed", "expired", "cancelled"]),
});
export type CreatePaymentCodeRequest = z.infer<typeof CreatePaymentCodeRequest>;
export type PaymentCodeResponse = z.infer<typeof PaymentCodeResponse>;

export const CancelPaymentCodeRequest = z.object({ codeId: Uuid });

// --------- Topup (Akış C) ---------
export const TopupStatusEnum = z.enum([
  "pending",
  "awaiting_member_action",
  "member_confirmed",
  "redirected",
  "success",
  "failed",
  "expired",
  "cancelled",
]);
export type TopupStatusEnum = z.infer<typeof TopupStatusEnum>;

export const CreateTopupSessionRequest = z.object({
  methodType: z.string(),
  amount: Money,
  returnBase: z.string().optional(),
});
export const TopupSession = z.object({
  id: Uuid,
  publicNo: z.string(),
  methodType: z.string(),
  amount: Money,
  status: TopupStatusEnum,
  redirectUrl: z.string().nullable(),
  iban: z.string().nullable(),
  accountHolder: z.string().nullable(),
  bankName: z.string().nullable(),
  paymentReference: z.string().nullable(),
  expiresAt: IsoDate,
  createdAt: IsoDate,
});
export type TopupSession = z.infer<typeof TopupSession>;
export type CreateTopupSessionRequest = z.infer<typeof CreateTopupSessionRequest>;

export const SetTopupPaymentInfoRequest = z.object({
  sessionId: Uuid,
  iban: z.string(),
  accountHolder: z.string(),
  bankName: z.string().optional(),
  paymentReference: z.string().optional(),
});

// --------- Withdraw (Akış D) ---------
export const WithdrawStatusEnum = z.enum([
  "pending",
  "sent_to_merchant",
  "success",
  "failed",
  "timeout",
  "expired",
  "cancelled",
]);

export const RequestWithdrawRequest = z.object({
  methodType: z.string(),
  amount: Money,
  iban: z.string().optional(),
  ibanHolder: z.string().optional(),
  cryptoType: z.string().optional(),
  payoutAddress: z.string().optional(),
  notes: z.string().optional(),
});
export const WithdrawSession = z.object({
  id: Uuid,
  publicNo: z.string(),
  methodType: z.string(),
  amount: Money,
  fee: Money,
  status: WithdrawStatusEnum,
  iban: z.string().nullable(),
  ibanHolder: z.string().nullable(),
  cryptoType: z.string().nullable(),
  payoutAddress: z.string().nullable(),
  externalTxId: z.string().nullable(),
  failureReason: z.string().nullable(),
  expiresAt: IsoDate,
  createdAt: IsoDate,
});
export type WithdrawSession = z.infer<typeof WithdrawSession>;
export type RequestWithdrawRequest = z.infer<typeof RequestWithdrawRequest>;
