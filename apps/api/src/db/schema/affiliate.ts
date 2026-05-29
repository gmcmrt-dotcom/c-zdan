import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
import { merchants } from "./merchants";
import { transactions } from "./transactions";

/** External or internal-member affiliates. Currently feature-flagged off. */
export const merchantAffiliates = pgTable(
  "merchant_affiliates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(), // external | internal_member
    code: text("code").notNull(),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    linkedUserId: uuid("linked_user_id").references(() => users.id, { onDelete: "set null" }),
    authUserId: uuid("auth_user_id").references(() => users.id, { onDelete: "set null" }),
    taxId: text("tax_id"),
    iban: text("iban"),
    status: text("status").notNull().default("active"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("merchant_affiliates_code_unique").on(t.code),
    check("merchant_affiliates_kind_chk", sql`${t.kind} IN ('external','internal_member')`),
    check(
      "merchant_affiliates_status_chk",
      sql`${t.status} IN ('active','paused','terminated')`,
    ),
  ],
);

export const merchantAffiliateLinks = pgTable(
  "merchant_affiliate_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    affiliateId: uuid("affiliate_id")
      .notNull()
      .references(() => merchantAffiliates.id, { onDelete: "cascade" }),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    commissionBasis: text("commission_basis").notNull(), // pct | fixed | mixed
    commissionPct: numeric("commission_pct", { precision: 5, scale: 2 }),
    fixedAmountPerTx: numeric("fixed_amount_per_tx", { precision: 14, scale: 2 }),
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("affiliate_links_aff_merch_idx").on(t.affiliateId, t.merchantId)],
);

export const merchantAffiliatePayouts = pgTable("merchant_affiliate_payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  affiliateId: uuid("affiliate_id")
    .notNull()
    .references(() => merchantAffiliates.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"),
  approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedReason: text("rejected_reason"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  transferRef: text("transfer_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const merchantAffiliateLedger = pgTable(
  "merchant_affiliate_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    affiliateId: uuid("affiliate_id")
      .notNull()
      .references(() => merchantAffiliates.id, { onDelete: "cascade" }),
    linkId: uuid("link_id").references(() => merchantAffiliateLinks.id),
    transactionId: uuid("transaction_id").references(() => transactions.id),
    direction: text("direction").notNull(), // accrual | payout
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    referenceId: text("reference_id").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("merchant_affiliate_ledger_reference_unique").on(t.referenceId),
    index("merchant_affiliate_ledger_aff_idx").on(t.affiliateId, t.createdAt.desc()),
  ],
);
