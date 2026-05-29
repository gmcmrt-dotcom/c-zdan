import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import { appRole } from "./_enums";

/** Role × resource × action matrix. */
export const boPermissions = pgTable(
  "bo_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    role: appRole("role").notNull(),
    resource: text("resource").notNull(),
    action: text("action").notNull(),
    granted: boolean("granted").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("bo_permissions_unique").on(t.role, t.resource, t.action)],
);

/** Per-user BO permission exceptions. */
export const userPermissionOverrides = pgTable(
  "user_permission_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resource: text("resource").notNull(),
    action: text("action").notNull(),
    granted: boolean("granted").notNull(),
    reason: text("reason"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("user_permission_overrides_unique").on(t.userId, t.resource, t.action)],
);

/**
 * H4 — Admin BO idempotency table. Admin mutations that move money
 * (`adjustBalance`, `recordManualSettlement`, `adjustCashPool`,
 * `setCashPool`) accept an optional `idempotency_key` from the client. The
 * service inserts `(actor_id, action, key)` BEFORE the money write — if
 * the unique index trips, the prior cached `result` is returned instead
 * of re-applying. Closes the admin-double-click double-debit window.
 *
 * Rows auto-expire after `expires_at` (7-day default); a cron will sweep
 * expired rows.
 */
export const adminIdempotency = pgTable(
  "admin_idempotency",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    key: text("key").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`(now() + interval '7 days')`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("admin_idempotency_actor_action_key_unique").on(t.actorId, t.action, t.key),
    index("admin_idempotency_expires_at_idx").on(t.expiresAt),
  ],
);
