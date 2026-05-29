import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { merchants } from "./merchants";
import { topupRequests, transactions, withdrawRequests } from "./transactions";

/** Server-side topup routing — inline IBAN or redirect flow. */
export const topupSessions = pgTable(
  "topup_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicNo: text("public_no").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id),
    methodType: text("method_type").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    status: text("status").notNull().default("pending"),
    merchantRef: text("merchant_ref"),
    redirectUrl: text("redirect_url"),
    returnUrl: text("return_url"),
    iban: text("iban"),
    accountHolder: text("account_holder"),
    bankName: text("bank_name"),
    paymentReference: text("payment_reference"),
    memberConfirmedAt: timestamp("member_confirmed_at", { withTimezone: true }),
    callbackReceivedAt: timestamp("callback_received_at", { withTimezone: true }),
    callbackPayload: jsonb("callback_payload").$type<unknown>(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    topupRequestId: uuid("topup_request_id").references(() => topupRequests.id, {
      onDelete: "set null",
    }),
    merchantNote: text("merchant_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("topup_sessions_public_no_unique").on(t.publicNo),
    uniqueIndex("topup_sessions_one_open_per_user_unique")
      .on(t.userId)
      .where(
        sql`${t.status} IN ('pending','awaiting_member_action','member_confirmed','redirected')`,
      ),
    index("topup_sessions_status_exp_idx").on(t.status, t.expiresAt),
    index("topup_sessions_merchant_idx").on(t.merchantId, t.createdAt.desc()),
    check(
      "topup_sessions_status_chk",
      sql`${t.status} IN ('pending','awaiting_member_action','member_confirmed','redirected','success','failed','expired','cancelled')`,
    ),
  ],
);

/** Cash-pool-priority withdraw routing with reservation. */
export const withdrawSessions = pgTable(
  "withdraw_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicNo: text("public_no").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id),
    methodType: text("method_type").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    fee: numeric("fee", { precision: 14, scale: 2 }).notNull().default("0"),
    status: text("status").notNull().default("pending"),
    iban: text("iban"),
    ibanHolder: text("iban_holder"),
    cryptoType: text("crypto_type"),
    payoutAddress: text("payout_address"),
    reservedAt: timestamp("reserved_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    withdrawRequestId: uuid("withdraw_request_id").references(() => withdrawRequests.id),
    transactionId: uuid("transaction_id").references(() => transactions.id),
    merchantRef: text("merchant_ref"),
    externalTxId: text("external_tx_id"),
    pushRequestPayload: jsonb("push_request_payload").$type<unknown>(),
    callbackPayload: jsonb("callback_payload").$type<unknown>(),
    callbackReceivedAt: timestamp("callback_received_at", { withTimezone: true }),
    pushAttempts: integer("push_attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    beneficiaryMasked: text("beneficiary_masked"),
    merchantNote: text("merchant_note"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("withdraw_sessions_public_no_unique").on(t.publicNo),
    index("withdraw_sessions_status_exp_idx").on(t.status, t.expiresAt),
    index("withdraw_sessions_merchant_idx").on(t.merchantId, t.createdAt.desc()),
    // P0-16 — one open withdraw session per user. Mirrors the topup partial
    // unique index. Without this, two parallel `requestWithdrawV3` calls
    // could both pass the app-level open-session check and both reserve the
    // member's balance for the same withdraw amount.
    uniqueIndex("withdraw_sessions_one_open_per_user_unique")
      .on(t.userId)
      .where(sql`${t.status} IN ('pending','sent_to_merchant')`),
    check(
      "withdraw_sessions_status_chk",
      sql`${t.status} IN ('pending','sent_to_merchant','success','failed','timeout','expired','cancelled')`,
    ),
  ],
);

/** Weighted load-balancing matrix for topup/withdraw routing. */
export const paymentRoutingRules = pgTable(
  "payment_routing_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    methodType: text("method_type").notNull(),
    direction: text("direction").notNull(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    weightPct: numeric("weight_pct", { precision: 5, scale: 2 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("payment_routing_rules_unique").on(t.methodType, t.direction, t.merchantId),
    check("payment_routing_direction_chk", sql`${t.direction} IN ('topup','withdraw')`),
    index("payment_routing_lookup_idx").on(t.methodType, t.direction, t.isActive),
  ],
);
