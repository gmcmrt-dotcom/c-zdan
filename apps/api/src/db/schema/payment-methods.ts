import { sql } from "drizzle-orm";
import {
  bigserial,
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

/** Top-level provider config. */
export const paymentProviders = pgTable("payment_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  commissionPct: numeric("commission_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  fixedFee: numeric("fixed_fee", { precision: 10, scale: 2 }).notNull().default("0"),
  perTxLimit: numeric("per_tx_limit", { precision: 14, scale: 2 }),
  dailyLimit: numeric("daily_limit", { precision: 14, scale: 2 }),
  minAmount: numeric("min_amount", { precision: 14, scale: 2 }),
  sortOrder: integer("sort_order").notNull().default(0),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("payment_providers_code_unique").on(t.code)]);

/** Provider sub-methods (havale/card/crypto). */
export const paymentMethods = pgTable(
  "payment_methods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => paymentProviders.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    commissionPct: numeric("commission_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    fixedFee: numeric("fixed_fee", { precision: 10, scale: 2 }).notNull().default("0"),
    minAmount: numeric("min_amount", { precision: 14, scale: 2 }),
    maxAmount: numeric("max_amount", { precision: 14, scale: 2 }),
    dailyLimit: numeric("daily_limit", { precision: 14, scale: 2 }),
    perTxLimit: numeric("per_tx_limit", { precision: 14, scale: 2 }),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("payment_methods_provider_code_unique").on(t.providerId, t.code),
    check("payment_methods_kind_chk", sql`${t.kind} IN ('topup','withdraw','both')`),
  ],
);

/** Central catalog of method types (member-facing labels, ETA). */
export const paymentMethodTypes = pgTable(
  "payment_method_types",
  {
    code: text("code").primaryKey(),
    labelTr: text("label_tr").notNull(),
    labelEn: text("label_en").notNull(),
    availableFor: text("available_for").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    descriptionTr: text("description_tr"),
    descriptionEn: text("description_en"),
    withdrawEtaMin: integer("withdraw_eta_min").notNull().default(5),
    withdrawEtaMax: integer("withdraw_eta_max").notNull().default(30),
    withdrawEtaUnit: text("withdraw_eta_unit").notNull().default("minute"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("pmt_avail_chk", sql`${t.availableFor} IN ('topup','withdraw','both')`),
    check("pmt_eta_unit_chk", sql`${t.withdrawEtaUnit} IN ('minute','hour','business_day')`),
  ],
);

/** Rolling SLA / latency aggregates per provider method. */
export const providerMethodHealth = pgTable(
  "provider_method_health",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    providerMethodId: uuid("provider_method_id")
      .notNull()
      .references(() => paymentMethods.id, { onDelete: "cascade" }),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    totalCount: integer("total_count").notNull().default(0),
    successCount: integer("success_count").notNull().default(0),
    cancelledCount: integer("cancelled_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    timeoutCount: integer("timeout_count").notNull().default(0),
    pendingCount: integer("pending_count").notNull().default(0),
    avgDurationMs: integer("avg_duration_ms"),
    p95DurationMs: integer("p95_duration_ms"),
    successRate: numeric("success_rate", { precision: 5, scale: 4 }),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("provider_method_health_window_unique").on(
      t.providerMethodId,
      t.windowStart,
      t.windowEnd,
    ),
    index("provider_method_health_method_idx").on(t.providerMethodId, t.windowStart.desc()),
  ],
);
