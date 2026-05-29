import { sql } from "drizzle-orm";
import {
  date,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

/** Immutable admin action log. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    before: jsonb("before").$type<unknown>(),
    after: jsonb("after").$type<unknown>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: inet("ip"),
    // J1 — `user_agent` for forensic linking from `audit_log` back to
    // `user_login_ips`. Truncated to 512 chars at write time so a malicious
    // 200 KB UA header can't blow up the row.
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_actor_idx").on(t.actorId, t.createdAt.desc()),
    index("audit_log_resource_idx").on(t.resourceType, t.resourceId),
  ],
);

/** Legacy operational log. */
export const systemLogs = pgTable(
  "system_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    level: text("level").notNull().default("info"),
    source: text("source").notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("system_logs_created_idx").on(t.createdAt.desc())],
);

/** Key/value config jsonb. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  description: text("description"),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Frontend / edge error capture. */
export const errorDiagnostics = pgTable(
  "error_diagnostics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    surface: text("surface").notNull(), // frontend | api | edge
    pageKey: text("page_key"),
    functionName: text("function_name"),
    errorCode: text("error_code").notNull(),
    errorMessage: text("error_message").notNull(),
    stack: text("stack"),
    context: jsonb("context").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("error_diagnostics_created_idx").on(t.createdAt.desc())],
);

/** Idempotency guard for cron / worker jobs. */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobName: text("job_name").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull().default("running"),
    result: jsonb("result").$type<unknown>(),
    error: text("error"),
  },
  (t) => [
    index("job_runs_name_started_idx").on(t.jobName, t.startedAt.desc()),
    uniqueIndex("job_runs_running_unique").on(t.jobName).where(sql`${t.finishedAt} IS NULL`),
  ],
);

/** Per-day, per-prefix counter for public_no allocation (hard rule §14). */
export const publicNoCounters = pgTable(
  "public_no_counters",
  {
    prefix: text("prefix").notNull(),
    yyyymmdd: text("yyyymmdd").notNull(),
    next: integer("next").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("public_no_counters_pk").on(t.prefix, t.yyyymmdd)],
);

/**
 * Admin daily tx aggregates (was `mv_admin_tx_daily` materialized view).
 *
 * P0-36 — Columns corrected: `day` is `date` (not `timestamp`), money columns
 * are `numeric(14,2)` (not `jsonb`), and `(day, type)` is a primary key (the
 * hourly worker has always done `ON CONFLICT (day, type) DO UPDATE`). See
 * migration 0002_p0_hardening.sql for the data migration.
 */
/**
 * K6 — AI cost tracker (Q8). One row per Anthropic call. Daily-budget cron
 * sums today's `cost_cents` and emits a soft alert at 80% threshold.
 * No row deletion; same forever-retention policy as audit_log.
 */
export const aiCostLog = pgTable(
  "ai_cost_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    day: date("day").notNull().defaultNow(),
    provider: text("provider").notNull().default("anthropic"),
    model: text("model").notNull(),
    caller: text("caller"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    userId: uuid("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_cost_log_day_idx").on(t.day.desc()),
    index("ai_cost_log_caller_day_idx").on(t.caller, t.day.desc()),
  ],
);

export const adminTxDaily = pgTable("admin_tx_daily", {
  day: date("day").notNull(),
  type: text("type").notNull(),
  txCount: integer("tx_count").notNull().default(0),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  totalFee: numeric("total_fee", { precision: 14, scale: 2 }).notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ name: "admin_tx_daily_pkey", columns: [t.day, t.type] }),
]);
