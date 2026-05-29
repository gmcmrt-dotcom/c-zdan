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
import { transactions } from "./transactions";

export const referrals = pgTable(
  "referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referrerUserId: uuid("referrer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    refereeUserId: uuid("referee_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    qualifyingEvent: text("qualifying_event"),
    qualifyingAmount: numeric("qualifying_amount", { precision: 14, scale: 2 }),
    qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
    rewardedAt: timestamp("rewarded_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("referrals_referee_unique").on(t.refereeUserId),
    check("referrals_no_self_chk", sql`${t.referrerUserId} <> ${t.refereeUserId}`),
    check(
      "referrals_status_chk",
      sql`${t.status} IN ('pending','qualified','rewarded','expired','cancelled')`,
    ),
    index("referrals_referrer_idx").on(t.referrerUserId, t.createdAt.desc()),
  ],
);

export const referralRewardsLog = pgTable(
  "referral_rewards_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referralId: uuid("referral_id")
      .notNull()
      .references(() => referrals.id, { onDelete: "cascade" }),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // referrer | referee
    pointsAwarded: integer("points_awarded").notNull().default(0),
    balanceAwarded: numeric("balance_awarded", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    transactionId: uuid("transaction_id").references(() => transactions.id),
    referenceId: text("reference_id").notNull(), // idempotency key
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("referral_rewards_log_reference_unique").on(t.referenceId),
    index("referral_rewards_log_recipient_idx").on(t.recipientUserId, t.createdAt.desc()),
  ],
);

/** Singleton — id boolean DEFAULT true PK. */
export const referralConfig = pgTable("referral_config", {
  id: boolean("id").primaryKey().default(true),
  referrerPoints: integer("referrer_points").notNull().default(0),
  referrerBalance: numeric("referrer_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  refereePoints: integer("referee_points").notNull().default(0),
  refereeBalance: numeric("referee_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  qualifyingSpendMin: numeric("qualifying_spend_min", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  expireAfterDays: integer("expire_after_days").notNull().default(90),
  monthlyCapPerReferrer: integer("monthly_cap_per_referrer").notNull().default(0),
  ipCapPerDay: integer("ip_cap_per_day").notNull().default(0),
  isEnabled: boolean("is_enabled").notNull().default(true),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
