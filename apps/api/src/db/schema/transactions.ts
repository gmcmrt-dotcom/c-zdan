import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { paymentMethods, paymentProviders } from "./payment-methods";
import { merchants, merchantMethods } from "./merchants";
import { topupStatus, txStatus, txType } from "./_enums";

/** Immutable member financial ledger (all tx types). */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicNo: text("public_no").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: txType("type").notNull(),
    status: txStatus("status").notNull().default("completed"),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    fee: numeric("fee", { precision: 14, scale: 2 }).notNull().default("0"),
    balanceAfter: numeric("balance_after", { precision: 14, scale: 2 }),
    description: text("description"),
    referenceId: uuid("reference_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    providerMethodId: uuid("provider_method_id").references(() => paymentMethods.id),
    merchantMethodId: uuid("merchant_method_id").references(() => merchantMethods.id),
    merchantRef: text("merchant_ref"),
    externalTxId: text("external_tx_id"),
    merchantNote: text("merchant_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("transactions_public_no_unique").on(t.publicNo),
    index("transactions_user_created_idx").on(t.userId, t.createdAt.desc()),
    index("transactions_type_created_idx").on(t.type, t.createdAt.desc()),
    index("transactions_metadata_merchant_idx").on(sql`(${t.metadata}->>'merchant_id')`),
    // Q2 — partial UNIQUE on external_tx_id (NULL stays unconstrained).
    // Mig 0015. See `db/migrations/0015_batch_q.sql` for the audit note.
    uniqueIndex("transactions_external_tx_id_unique")
      .on(t.externalTxId)
      .where(sql`${t.externalTxId} IS NOT NULL`),
  ],
);

/** Legacy direct provider topup records. */
export const topupRequests = pgTable(
  "topup_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerId: uuid("provider_id").notNull(),
    providerMethodId: uuid("provider_method_id").references(() => paymentMethods.id),
    merchantId: uuid("merchant_id").references(() => merchants.id, { onDelete: "set null" }),
    grossAmount: numeric("gross_amount", { precision: 14, scale: 2 }).notNull(),
    providerCost: numeric("provider_cost", { precision: 14, scale: 2 }).notNull().default("0"),
    netAmount: numeric("net_amount", { precision: 14, scale: 2 }).notNull(),
    status: topupStatus("status").notNull().default("pending"),
    providerRef: text("provider_ref"),
    callbackLog: jsonb("callback_log").$type<unknown[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("topup_requests_merchant_ref_unique")
      .on(t.merchantId, t.providerRef)
      .where(sql`${t.merchantId} IS NOT NULL AND ${t.providerRef} IS NOT NULL`),
  ],
);

/** Legacy member → finance-merchant withdraw (superseded by sessions). */
export const withdrawRequests = pgTable("withdraw_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  fee: numeric("fee", { precision: 14, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("pending"),
  externalRef: text("external_ref"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/**
 * L1 — Resolver map (P0-35 / Q4 Option B).
 *
 * Maps a merchant + transaction type to the `payment_method` we should
 * stamp on `provider_ledger`. NULL lookup → skip the ledger write
 * (logged at warn). One active row per `(merchant_id, tx_type)`;
 * historical rows are kept with `is_active=false` for the audit trail.
 */
export const merchantProviderMethodMap = pgTable(
  "merchant_provider_method_map",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id").notNull().references(() => merchants.id, { onDelete: "cascade" }),
    txType: text("tx_type").notNull(),
    providerMethodId: uuid("provider_method_id").notNull().references(() => paymentMethods.id, { onDelete: "restrict" }),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("merchant_provider_method_map_unique").on(t.merchantId, t.txType).where(sql`${t.isActive} = true`),
    index("merchant_provider_method_map_lookup").on(t.merchantId, t.txType, t.isActive),
  ],
);

/** External payment provider API call ledger. */
export const providerLedger = pgTable(
  "provider_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Batch P — FK added in mig 0014_safe_additive.sql (p1-third-sweep
    // missing-FK item). ON DELETE RESTRICT mirrors the policy used by
    // every other settlement-pointing FK; the column was already notNull
    // so no current writer is affected. Table is empty in dev; orphan
    // audit returned zero rows before adding the constraint.
    providerId: uuid("provider_id")
      .notNull()
      .references(() => paymentProviders.id, { onDelete: "restrict" }),
    providerMethodId: uuid("provider_method_id").notNull().references(() => paymentMethods.id),
    merchantMethodId: uuid("merchant_method_id").references(() => merchantMethods.id),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    transactionId: uuid("transaction_id").references(() => transactions.id),
    topupRequestId: uuid("topup_request_id").references(() => topupRequests.id),
    direction: text("direction").notNull(),
    amountGross: numeric("amount_gross", { precision: 14, scale: 2 }).notNull(),
    providerCommission: numeric("provider_commission", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    ourCommission: numeric("our_commission", { precision: 14, scale: 2 }).notNull().default("0"),
    amountNet: numeric("amount_net", { precision: 14, scale: 2 }).notNull(),
    status: text("status").notNull().default("pending"),
    externalRef: text("external_ref"),
    internalRef: text("internal_ref"),
    apiRequestAt: timestamp("api_request_at", { withTimezone: true }),
    apiResponseAt: timestamp("api_response_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    rawResponse: jsonb("raw_response").$type<unknown>(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("provider_ledger_provider_created_idx").on(t.providerId, t.createdAt.desc()),
    index("provider_ledger_tx_idx").on(t.transactionId),
  ],
);
