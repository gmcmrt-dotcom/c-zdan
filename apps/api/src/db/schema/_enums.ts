import { pgEnum } from "drizzle-orm/pg-core";

// Mirrors the 13 enums in the Supabase schema. Add new values via Drizzle
// migrations; do not delete legacy values without a data migration.

export const appRole = pgEnum("app_role", ["admin", "accounting", "support"]);

export const txType = pgEnum("tx_type", [
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

export const txStatus = pgEnum("tx_status", ["pending", "completed", "failed", "reversed"]);

export const codeStatus = pgEnum("code_status", ["active", "consumed", "expired", "cancelled"]);

export const topupStatus = pgEnum("topup_status", [
  "pending",
  "completed",
  "failed",
  "cancelled",
]);

export const kycStatus = pgEnum("kyc_status", ["none", "pending", "verified", "rejected"]);

export const merchantType = pgEnum("merchant_type", ["finance", "commerce"]);

export const chatCategory = pgEnum("chat_category", [
  "topup_issue",
  "withdraw_issue",
  "profile_update",
  "general",
]);

export const chatThreadStatus = pgEnum("chat_thread_status", [
  "open",
  "pending_staff",
  "pending_user",
  "resolved",
  "closed",
]);

export const chatSenderRole = pgEnum("chat_sender_role", ["member", "bot", "staff"]);

export const chatAttachmentStatus = pgEnum("chat_attachment_status", [
  "uploaded",
  "scanning",
  "clean",
  "infected",
  "rejected",
]);

export const chatPcrStatus = pgEnum("chat_pcr_status", [
  "pending",
  "approved",
  "rejected",
  "applied",
]);

export const chatPcrField = pgEnum("chat_pcr_field", [
  "first_name",
  "last_name",
  "email",
  "phone",
]);
