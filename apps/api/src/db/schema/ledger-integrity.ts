import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

/** Append-only ledger integrity / cross-check run history. */
export const ledgerIntegrityRuns = pgTable(
  "ledger_integrity_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    triggeredBy: text("triggered_by").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull().default("running"),
    ok: boolean("ok").notNull().default(false),
    checkCount: integer("check_count").notNull().default(0),
    findingCount: integer("finding_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0),
    criticalCount: integer("critical_count").notNull().default(0),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    findings: jsonb("findings").$type<unknown[]>().notNull().default([]),
    durationMs: integer("duration_ms"),
    error: text("error"),
  },
  (t) => [
    index("ledger_integrity_runs_started_idx").on(t.startedAt.desc()),
    index("ledger_integrity_runs_status_idx").on(t.status, t.startedAt.desc()),
  ],
);
