import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { transactions } from "./transactions";

export const profitShareCampaigns = pgTable(
  "profit_share_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    periodType: text("period_type").notNull(), // weekly | monthly | quarterly | custom
    periodFrom: timestamp("period_from", { withTimezone: true }).notNull(),
    periodTo: timestamp("period_to", { withTimezone: true }).notNull(),
    distributionPct: numeric("distribution_pct", { precision: 5, scale: 2 }).notNull(),
    platformRevenue: numeric("platform_revenue", { precision: 14, scale: 2 }).notNull(),
    platformCost: numeric("platform_cost", { precision: 14, scale: 2 }).notNull(),
    affiliateCost: numeric("affiliate_cost", { precision: 14, scale: 2 }).notNull().default("0"),
    carriedOverhead: numeric("carried_overhead", { precision: 14, scale: 2 }).notNull().default("0"),
    netProfit: numeric("net_profit", { precision: 14, scale: 2 }).notNull(),
    poolAmount: numeric("pool_amount", { precision: 14, scale: 2 }).notNull(),
    topTurnoverTotal: numeric("top_turnover_total", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    eligibleCount: integer("eligible_count").notNull().default(0),
    maxRecipients: integer("max_recipients").notNull(),
    claimExpiresHours: integer("claim_expires_hours").notNull().default(168),
    status: text("status").notNull().default("draft"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    publishedBy: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("ps_status_chk", sql`${t.status} IN ('draft','published','closed','cancelled')`),
    index("ps_status_idx").on(t.status),
  ],
);

export const profitShareAllocations = pgTable(
  "profit_share_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => profitShareCampaigns.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rankNo: integer("rank_no").notNull(),
    turnoverAmount: numeric("turnover_amount", { precision: 14, scale: 2 }).notNull(),
    sharePct: numeric("share_pct", { precision: 8, scale: 5 }).notNull(),
    allocatedAmount: numeric("allocated_amount", { precision: 14, scale: 2 }).notNull(),
    status: text("status").notNull().default("pending"),
    claimTxId: uuid("claim_tx_id").references(() => transactions.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ps_alloc_campaign_user_unique").on(t.campaignId, t.userId),
    check("ps_alloc_status_chk", sql`${t.status} IN ('pending','claimed','expired')`),
    index("ps_alloc_user_idx").on(t.userId, t.createdAt.desc()),
  ],
);
