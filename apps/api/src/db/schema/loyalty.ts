import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

export const loyaltyTiers = pgTable(
  "loyalty_tiers",
  {
    id: serial("id").primaryKey(),
    levelName: text("level_name").notNull(),
    displayName: text("display_name").notNull(),
    subRank: integer("sub_rank").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    minPoints: integer("min_points").notNull().default(0),
    minTurnover: numeric("min_turnover", { precision: 14, scale: 2 }).notNull().default("0"),
    commissionDiscountPct: numeric("commission_discount_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    pointMultiplier: numeric("point_multiplier", { precision: 5, scale: 2 }).notNull().default("1"),
    cashbackPct: numeric("cashback_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("loyalty_tiers_level_sub_unique")
      .on(t.levelName, t.subRank)
      .where(sql`NOT ${t.isArchived}`),
  ],
);

export const loyaltyPointsLog = pgTable(
  "loyalty_points_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    points: integer("points").notNull(),
    reason: text("reason").notNull(),
    referenceId: uuid("reference_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("loyalty_points_log_user_idx").on(t.userId, t.createdAt.desc()),
    // Batch P — partial UNIQUE added in mig 0014_safe_additive.sql
    // (p1-third-sweep idempotency item). Defensive: current writers either
    // omit reference_id (NULL → not in the predicate) or pass a freshly
    // generated transactions.id, so today the constraint cannot collide.
    // Rolling back = drop this entry + drop the migration index.
    uniqueIndex("loyalty_points_log_idempotency_unique")
      .on(t.userId, t.reason, t.referenceId)
      .where(sql`${t.referenceId} IS NOT NULL`),
  ],
);

export const loyaltyRules = pgTable(
  "loyalty_rules",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("loyalty_rules_key_unique").on(t.key)],
);
