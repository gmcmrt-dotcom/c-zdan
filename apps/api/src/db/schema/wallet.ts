import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { codeStatus } from "./_enums";
import { loyaltyTiers } from "./loyalty";

/** Member wallet balance + reservation + tier snapshot. */
export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    balance: numeric("balance", { precision: 14, scale: 2 }).notNull().default("0"),
    reservedBalance: numeric("reserved_balance", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    totalPoints: integer("total_points").notNull().default(0),
    currentTierId: integer("current_tier_id").references(() => loyaltyTiers.id),
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
    cooldownReason: text("cooldown_reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("accounts_balance_nonneg", sql`${t.balance} >= 0`),
    check("accounts_reserved_nonneg", sql`${t.reservedBalance} >= 0`),
    index("accounts_cooldown_idx").on(t.cooldownUntil).where(sql`${t.cooldownUntil} IS NOT NULL`),
  ],
);

/** Single-use spend codes (Akış A) with balance + tier reservation. */
export const paymentCodes = pgTable(
  "payment_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    status: codeStatus("status").notNull().default("active"),
    customerNameSnapshot: text("customer_name_snapshot"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    consumedByMerchant: uuid("consumed_by_merchant"),
    reservedSpendPoints: integer("reserved_spend_points").notNull().default(0),
    reservedCashbackPoints: integer("reserved_cashback_points").notNull().default(0),
    reservedAtTierId: integer("reserved_at_tier_id").references(() => loyaltyTiers.id),
    reservedAtTurnover: integer("reserved_at_turnover").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_codes_code_active_unique")
      .on(t.code)
      .where(sql`${t.status} = 'active'`),
    uniqueIndex("payment_codes_code_global_unique").on(t.code),
    index("payment_codes_user_status_exp_idx").on(t.userId, t.status, t.expiresAt),
  ],
);
