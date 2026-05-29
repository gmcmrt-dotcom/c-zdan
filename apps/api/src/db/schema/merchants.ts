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
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { merchantType } from "./_enums";

/**
 * Commerce + finance merchants. Encodes settlement balance, cash-pool,
 * commission, child/parent hierarchy, and integration metadata.
 * See docs/ARCHITECTURE_FLOWS.md and docs/HARD_RULES.md.
 */
export const merchants = pgTable(
  "merchants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    apiKey: text("api_key").notNull(),
    apiSecretHash: text("api_secret_hash").notNull(),
    ipWhitelist: text("ip_whitelist").array().notNull().default(sql`'{}'::text[]`),
    isActive: boolean("is_active").notNull().default(true),
    merchantType: merchantType("merchant_type").notNull(),

    // commission + fees
    commissionPct: numeric("commission_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    fixedFee: numeric("fixed_fee", { precision: 10, scale: 2 }).notNull().default("0"),
    commissionDirection: text("commission_direction").notNull().default("merchant"),
    depositCommissionPct: numeric("deposit_commission_pct", { precision: 5, scale: 2 }),
    depositFixedFee: numeric("deposit_fixed_fee", { precision: 10, scale: 2 }),
    withdrawCommissionPct: numeric("withdraw_commission_pct", { precision: 5, scale: 2 }),
    withdrawFixedFee: numeric("withdraw_fixed_fee", { precision: 10, scale: 2 }),

    // tx + finance limits
    dailyLimit: numeric("daily_limit", { precision: 14, scale: 2 }),
    perTxLimit: numeric("per_tx_limit", { precision: 14, scale: 2 }),
    depositMinAmount: numeric("deposit_min_amount", { precision: 14, scale: 2 }),
    depositMaxAmount: numeric("deposit_max_amount", { precision: 14, scale: 2 }),
    withdrawMinAmount: numeric("withdraw_min_amount", { precision: 14, scale: 2 }),
    withdrawMaxAmount: numeric("withdraw_max_amount", { precision: 14, scale: 2 }),

    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    // settlement
    balance: numeric("balance", { precision: 14, scale: 2 }).notNull().default("0"),
    creditLimit: numeric("credit_limit", { precision: 14, scale: 2 }).notNull().default("0"),
    cashPool: numeric("cash_pool", { precision: 14, scale: 2 }).notNull().default("0"),
    cashPoolUpdatedAt: timestamp("cash_pool_updated_at", { withTimezone: true }),
    cashPoolApiUrl: text("cash_pool_api_url"),
    cashPoolApiMethod: text("cash_pool_api_method"),
    cashPoolJqPath: text("cash_pool_jq_path"),
    overdraftEnabled: boolean("overdraft_enabled").notNull().default(false),
    overdraftLimit: numeric("overdraft_limit", { precision: 14, scale: 2 }).notNull().default("0"),
    avgWithdrawSeconds: integer("avg_withdraw_seconds"),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    failureRatePct: numeric("failure_rate_pct", { precision: 5, scale: 2 }),

    // hierarchy
    parentMerchantId: uuid("parent_merchant_id").references((): AnyPgColumn => merchants.id),
    merchantScope: text("merchant_scope").notNull().default("standalone"),
    externalSubMerchantRef: text("external_sub_merchant_ref"),
    organizationId: uuid("organization_id"),

    // security / API
    // P0-12 — signing secret is stored encrypted-at-rest in the
    // `signing_secret_encrypted` column (AES-256-GCM via lib/crypto.ts).
    // The plaintext `signing_secret` column is preserved during the staged
    // migration; readers prefer the encrypted form when present. Once every
    // active merchant has been re-saved (backfill), the plaintext column can
    // be dropped in a follow-up migration.
    signingSecret: text("signing_secret"),
    signingSecretEncrypted: text("signing_secret_encrypted"),
    signingSecretSetAt: timestamp("signing_secret_set_at", { withTimezone: true }),
    webhookUrl: text("webhook_url"),
    webhookUrlSetAt: timestamp("webhook_url_set_at", { withTimezone: true }),
    topupInitUrl: text("topup_init_url"),
    integrationAdapter: text("integration_adapter"),

    // commerce cashout
    cashoutCommissionPct: numeric("cashout_commission_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    cashoutFixedFee: numeric("cashout_fixed_fee", { precision: 10, scale: 2 }).notNull().default("0"),
    cashoutReservedAmount: numeric("cashout_reserved_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),

    // finance ops
    financeCollectionFeePct: numeric("finance_collection_fee_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    financeCollectionFixedFee: numeric("finance_collection_fixed_fee", {
      precision: 10,
      scale: 2,
    })
      .notNull()
      .default("0"),
  },
  (t) => [
    uniqueIndex("merchants_api_key_unique").on(t.apiKey),
    check("merchants_balance_within_credit", sql`${t.balance} >= -${t.creditLimit}`),
    check(
      "merchants_scope_chk",
      sql`${t.merchantScope} IN ('standalone','parent','child')`,
    ),
    check(
      "merchants_commission_direction_chk",
      sql`${t.commissionDirection} IN ('merchant','member','split')`,
    ),
    index("merchants_parent_idx").on(t.parentMerchantId),
  ],
);

/** Per-finance-merchant payment method breakdown. */
export const merchantMethods = pgTable(
  "merchant_methods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    depositCommissionPct: numeric("deposit_commission_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    depositFixedFee: numeric("deposit_fixed_fee", { precision: 10, scale: 2 }).notNull().default("0"),
    withdrawCommissionPct: numeric("withdraw_commission_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    withdrawFixedFee: numeric("withdraw_fixed_fee", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
    minAmount: numeric("min_amount", { precision: 14, scale: 2 }),
    maxAmount: numeric("max_amount", { precision: 14, scale: 2 }),
    perTxLimit: numeric("per_tx_limit", { precision: 14, scale: 2 }),
    dailyLimit: numeric("daily_limit", { precision: 14, scale: 2 }),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("merchant_methods_merchant_code_unique").on(t.merchantId, t.code),
    check("merchant_methods_kind_chk", sql`${t.kind} IN ('deposit','withdraw','both')`),
  ],
);

/** Merchant portal users. */
export const merchantUsers = pgTable(
  "merchant_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    fullName: text("full_name"),
    phone: text("phone"),
    role: text("role").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("merchant_users_user_merchant_unique").on(t.userId, t.merchantId),
    uniqueIndex("merchant_users_email_unique_lower").on(sql`lower(${t.email})`),
    check("merchant_users_role_chk", sql`${t.role} IN ('owner','accountant','read_only')`),
    index("merchant_users_merchant_idx").on(t.merchantId),
  ],
);

/** Per-merchant-user permission overrides (e.g. merchant_cashout:create). */
export const merchantUserPermissionOverrides = pgTable(
  "merchant_user_permission_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantUserId: uuid("merchant_user_id")
      .notNull()
      .references(() => merchantUsers.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key").notNull(),
    isAllowed: boolean("is_allowed").notNull(),
    reason: text("reason"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("muperm_user_key_unique").on(t.merchantUserId, t.permissionKey)],
);

/** KYB onboarding pipeline. */
export const merchantApplications = pgTable(
  "merchant_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyName: text("company_name").notNull(),
    tradeName: text("trade_name"),
    taxNo: text("tax_no").notNull(),
    taxOffice: text("tax_office"),
    addressLine: text("address_line"),
    city: text("city"),
    country: text("country"),
    contactEmail: text("contact_email").notNull(),
    contactName: text("contact_name").notNull(),
    contactPhone: text("contact_phone"),
    requestedType: text("requested_type").notNull(),
    requestedMethods: text("requested_methods").array(),
    iban: text("iban"),
    ibanHolder: text("iban_holder"),
    documents: jsonb("documents").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("pending"),
    notes: text("notes"),
    approvedMerchantId: uuid("approved_merchant_id").references(() => merchants.id, {
      onDelete: "set null",
    }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    applicantUserId: uuid("applicant_user_id").references(() => users.id, { onDelete: "set null" }),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("merchant_apps_email_pending_unique")
      .on(sql`lower(${t.contactEmail})`)
      .where(sql`${t.status} IN ('pending','reviewing','info_requested')`),
  ],
);

/**
 * P0-12 — append-only history of signing-secret rotations. Every rotate
 * writes a row here so we can investigate suspected key compromise.
 */
export const merchantSecretRotations = pgTable("merchant_secret_rotations", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  rotatedBy: uuid("rotated_by").references(() => users.id, { onDelete: "set null" }),
  reason: text("reason"),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only signed balance ledger. */
export const merchantSettlementLog = pgTable("merchant_settlement_log", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  changeAmount: numeric("change_amount", { precision: 14, scale: 2 }).notNull(),
  balanceBefore: numeric("balance_before", { precision: 14, scale: 2 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 14, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  referenceType: text("reference_type"),
  referenceId: uuid("reference_id"),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const merchantCashPoolLog = pgTable("merchant_cash_pool_log", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  changeAmount: numeric("change_amount", { precision: 14, scale: 2 }).notNull(),
  balanceBefore: numeric("balance_before", { precision: 14, scale: 2 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 14, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  referenceType: text("reference_type"),
  referenceId: uuid("reference_id"),
  notes: text("notes"),
  collectionFeePct: numeric("collection_fee_pct", { precision: 5, scale: 2 }),
  collectionFixedFee: numeric("collection_fixed_fee", { precision: 10, scale: 2 }),
  collectionFeeAmount: numeric("collection_fee_amount", { precision: 14, scale: 2 }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** HMAC API idempotency cache (7-day TTL). */
export const merchantIdempotency = pgTable(
  "merchant_idempotency",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    merchantRef: text("merchant_ref").notNull(),
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code").notNull(),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("merchant_idempotency_unique").on(t.merchantId, t.endpoint, t.merchantRef),
    index("merchant_idempotency_expiry_idx").on(t.expiresAt),
  ],
);

/** Merchant API request/response audit log. */
export const merchantApiCalls = pgTable(
  "merchant_api_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id").references(() => merchants.id, { onDelete: "set null" }),
    endpoint: text("endpoint").notNull(),
    method: text("method").notNull(),
    ip: text("ip"),
    requestBody: jsonb("request_body").$type<unknown>(),
    responseBody: jsonb("response_body").$type<unknown>(),
    statusCode: integer("status_code"),
    errorCode: text("error_code"),
    latencyMs: integer("latency_ms"),
    merchantRef: text("merchant_ref"),
    requestHash: text("request_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("merchant_api_calls_merchant_idx").on(t.merchantId, t.createdAt.desc()),
    index("merchant_api_calls_created_idx").on(t.createdAt.desc()),
  ],
);

/** Commerce settlement crypto cashout catalog. */
export const merchantCashoutMethods = pgTable(
  "merchant_cashout_methods",
  {
    code: text("code").primaryKey(),
    label: text("label").notNull(),
    network: text("network").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    minAmount: numeric("min_amount", { precision: 14, scale: 2 }),
    maxAmount: numeric("max_amount", { precision: 14, scale: 2 }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

/** Commerce merchant cashout request sessions (MC-* public_no). */
export const merchantCashoutSessions = pgTable(
  "merchant_cashout_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicNo: text("public_no").notNull(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    methodCode: text("method_code").notNull().references(() => merchantCashoutMethods.code),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    fee: numeric("fee", { precision: 14, scale: 2 }).notNull().default("0"),
    payoutAddress: text("payout_address").notNull(),
    status: text("status").notNull().default("pending"),
    providerRef: text("provider_ref"),
    externalTxId: text("external_tx_id"),
    failureReason: text("failure_reason"),
    callbackPayload: jsonb("callback_payload").$type<unknown>(),
    callbackReceivedAt: timestamp("callback_received_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("merchant_cashout_sessions_public_no_unique").on(t.publicNo),
    index("merchant_cashout_sessions_merchant_idx").on(t.merchantId, t.createdAt.desc()),
  ],
);
