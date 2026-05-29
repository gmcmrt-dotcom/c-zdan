import { sql } from "drizzle-orm";
import { db, sql as pgClient } from "./client";
import * as s from "./schema";
import { logger } from "../lib/logger";

/**
 * Idempotent seed. Re-runs safely; uses ON CONFLICT and exists-guards.
 *
 * Populates:
 *   - loyalty_tiers (6 levels × 3 barems — L6)
 *   - payment_method_types (member-facing topup/withdraw categories)
 *   - merchant_cashout_methods (USDT/ETH/BTC/TRX)
 *   - bo_permissions matrix (admin / accounting / support)
 *   - referral_config singleton
 *   - settings defaults
 */

const LOYALTY_TIERS = [
  // id, level, display, sub, min_points, min_turnover, discount_pct, multiplier, cashback_pct
  [1, "rookie", "Rookie I", 0, 0, "0", "0", "1", "0"],
  [2, "rookie", "Rookie II", 1, 50, "1000", "0", "1.02", "0"],
  [3, "rookie", "Rookie III", 2, 150, "3000", "0", "1.05", "0"],
  [4, "silver", "Silver I", 0, 400, "10000", "0", "1.08", "0"],
  [5, "silver", "Silver II", 1, 700, "25000", "0", "1.10", "0"],
  [6, "silver", "Silver III", 2, 1_000, "50000", "0", "1.12", "0"],
  [7, "gold", "Gold I", 0, 2_500, "100000", "1", "1.18", "0"],
  [8, "gold", "Gold II", 1, 4_000, "250000", "1", "1.22", "0"],
  [9, "gold", "Gold III", 2, 5_000, "500000", "1", "1.25", "0"],
  [10, "platinum", "Platinum I", 0, 15_000, "750000", "2", "1.32", "0"],
  [11, "platinum", "Platinum II", 1, 20_000, "1500000", "2", "1.40", "0"],
  [12, "platinum", "Platinum III", 2, 25_000, "2000000", "2", "1.50", "0"],
  [13, "diamond", "Diamond I", 0, 60_000, "4000000", "3", "1.58", "0"],
  [14, "diamond", "Diamond II", 1, 80_000, "7000000", "3", "1.66", "0"],
  [15, "diamond", "Diamond III", 2, 100_000, "10000000", "3", "1.75", "0"],
  [16, "elite", "Elite I", 0, 300_000, "20000000", "5", "1.85", "0"],
  [17, "elite", "Elite II", 1, 400_000, "35000000", "5", "1.92", "0"],
  [18, "elite", "Elite III", 2, 500_000, "50000000", "5", "2.00", "0"],
] as const;

const PAYMENT_METHOD_TYPES = [
  // code, label_tr, label_en, available_for, sort_order, eta_min, eta_max, eta_unit
  ["havale", "Havale / EFT", "Bank Transfer", "both", 10, 5, 30, "minute"],
  ["kart", "Kredi Kartı", "Credit Card", "topup", 20, 0, 5, "minute"],
  ["papara", "Papara", "Papara", "both", 30, 0, 15, "minute"],
  ["kripto", "Kripto", "Cryptocurrency", "both", 40, 5, 60, "minute"],
] as const;

const CASHOUT_METHODS = [
  ["USDT_TRC20", "USDT (TRC20)", "tron", 10, "50", "100000"],
  ["USDT_ERC20", "USDT (ERC20)", "ethereum", 20, "100", "100000"],
  ["BTC", "Bitcoin", "bitcoin", 30, "0.001", "1"],
  ["ETH", "Ethereum", "ethereum", 40, "0.05", "10"],
  ["TRX", "TRON", "tron", 50, "500", "1000000"],
] as const;

const BO_PERMISSIONS: Array<[role: "admin" | "accounting" | "support", resource: string, action: string]> = [
  // ---- admin ----
  // mutations
  ["admin", "members", "view_full"],
  ["admin", "members", "view_masked"],
  ["admin", "members", "freeze"],
  ["admin", "members", "kyc"],
  ["admin", "members.balance", "adjust"],
  ["admin", "members.balance", "view_full"],
  ["admin", "merchants", "view_full"],
  ["admin", "merchants", "view_masked"],
  ["admin", "merchants", "create"],
  ["admin", "merchants", "update"],
  ["admin", "merchants", "approve"],
  ["admin", "merchants", "credit_limit"],
  // Q3 — `merchants:view` + `merchants:manage` enforced by the L1 provider-
  // method-map RPCs (`admin_set_provider_method_map`,
  // `admin_list_provider_method_map`, `admin_disable_provider_method_map` in
  // `rpc.routes.ts::adminRpcPerms`). Shipped without seed entries in batch L
  // so the feature failed closed for every admin. Adding here matches the
  // existing `merchants:update` privilege level (admin only).
  ["admin", "merchants", "manage"],
  ["admin", "merchants", "view"],
  ["admin", "merchants.cash_pool", "adjust"],
  ["admin", "merchants.cash_pool", "view_full"],
  ["admin", "merchant_children", "view"],
  ["admin", "transactions", "view_full"],
  ["admin", "settings", "manage"],
  ["admin", "bo_users", "manage_roles"],
  ["admin", "bo_users", "view"],
  ["admin", "permissions", "manage_overrides"],
  ["admin", "chat", "view_all"],
  ["admin", "chat", "claim"],
  ["admin", "chat", "reply"],
  ["admin", "chat", "approve_pcr"],
  ["admin", "templates", "manage"],
  ["admin", "method_types", "manage"],
  ["admin", "method_types", "edit"],
  ["admin", "onboarding", "review"],
  ["admin", "loyalty", "manage"],
  ["admin", "referrals", "manage"],
  ["admin", "affiliates", "view"],
  ["admin", "affiliates", "manage"],
  ["admin", "profit_share", "manage"],
  ["admin", "finance_integrations", "view"],
  ["admin", "finance_integrations", "test"],
  ["admin", "reconciliation", "view"],
  ["admin", "ledger_integrity", "run"],
  ["admin", "system_logs", "view"],
  ["admin", "audit_log", "view"],
  ["admin", "exports", "merchants:view_full"],
  // page-gate :view actions consumed by <AdminLayout requireAny={...}>
  ["admin", "dashboard", "view"],
  ["admin", "commissions", "view"],
  ["admin", "referrals", "view"],
  ["admin", "templates", "view"],
  ["admin", "permissions", "view"],
  ["admin", "method_types", "view"],
  ["admin", "profit_share", "view"],
  ["admin", "loyalty", "view"],
  ["admin", "settings", "view"],
  ["admin", "chat", "view"],

  // ---- accounting ----
  ["accounting", "members", "view_masked"],
  ["accounting", "members", "view_full"],
  ["accounting", "merchants", "view_full"],
  ["accounting", "merchants", "view_masked"],
  ["accounting", "merchants.cash_pool", "view_full"],
  ["accounting", "transactions", "view_full"],
  ["accounting", "transactions", "view_masked"],
  ["accounting", "reconciliation", "view"],
  ["accounting", "ledger_integrity", "run"],
  ["accounting", "exports", "merchants:view_full"],
  ["accounting", "loyalty", "view"],
  ["accounting", "profit_share", "view"],
  ["accounting", "system_logs", "view"],
  ["accounting", "audit_log", "view"],
  ["accounting", "chat", "view_all"],
  ["accounting", "chat", "claim"],
  ["accounting", "chat", "reply"],
  ["accounting", "chat", "view"],
  ["accounting", "dashboard", "view"],
  ["accounting", "commissions", "view"],
  ["accounting", "templates", "view"],
  ["accounting", "settings", "view"],

  // ---- support ----
  ["support", "members", "view_masked"],
  ["support", "members", "view_full"],
  ["support", "members", "freeze"],
  ["support", "members", "kyc"],
  ["support", "transactions", "view_full"],
  ["support", "transactions", "view_masked"],
  ["support", "chat", "view_all"],
  ["support", "chat", "claim"],
  ["support", "chat", "reply"],
  ["support", "chat", "approve_pcr"],
  ["support", "chat", "view"],
  ["support", "dashboard", "view"],

  // ---- members.pii view (P1) — admin sees full PII; accounting+support see masked.
  ["admin", "members.pii", "view_full"],
  ["admin", "members.pii", "view_masked"],
  ["accounting", "members.pii", "view_masked"],
  ["support", "members.pii", "view_masked"],

  // ---- sensitive ops require dedicated permissions ----
  ["admin", "merchants", "api_credentials"],
  ["admin", "merchants", "rotate_secret"],
  ["admin", "audit_log", "view_payload"],
  ["admin", "withdrawals", "view_destination"],
  ["accounting", "withdrawals", "view_destination"],

  // Q3 — INTENTIONALLY NOT SEEDED:
  // - `bo_users:manage` is the secondary gate added in P0-45 ("admin-to-
  //   admin email takeover guard") inside `members.service.ts::
  //   updateMemberProfile`. The default policy is that **no admin can
  //   modify another staff member's profile**; granting this perm
  //   manually (via `user_permission_overrides` or a custom seed for a
  //   specific super-admin user) is the documented break-glass path.
  //   Adding it to the role-wide admin seed would re-open the exact
  //   takeover chain P0-45 closed. Do not add here.
  //
  // - FE-only sensitive items that the BE does NOT yet enforce
  //   (`members:view_login_ips`, `members:update`, `members:manual_adjust`,
  //   `members.kyc:approve`, `transactions:view`, `transactions:export`,
  //   `transactions:manual_adjust`, `merchants:network_config`,
  //   `merchants:integration_urls`, `merchants:cash_collection_fee`,
  //   `permissions:update`, `templates:edit`, `loyalty:update`,
  //   `loyalty:manual_grant`, `referrals:edit_config`, `affiliates:contact`,
  //   `commissions:export`) live in `apps/web/src/lib/admin-bo-registry.ts`
  //   `sensitiveItems`. They render in the BO permission matrix UI but no
  //   `requirePerm(...)` call enforces them server-side. Seeding them now
  //   would be inert. Either wire BE enforcement first (then add seed) or
  //   leave them as forward-looking FE descriptors.
];

async function seedLoyaltyTiers() {
  for (const [
    id,
    levelName,
    displayName,
    subRank,
    minPoints,
    minTurnover,
    discountPct,
    multiplier,
    cashbackPct,
  ] of LOYALTY_TIERS) {
    await db
      .insert(s.loyaltyTiers)
      .values({
        id,
        levelName,
        displayName,
        subRank,
        sortOrder: id,
        minPoints,
        minTurnover,
        commissionDiscountPct: discountPct,
        pointMultiplier: multiplier,
        cashbackPct,
        isArchived: false,
      })
      .onConflictDoUpdate({
        target: s.loyaltyTiers.id,
        set: {
          levelName: sql`excluded.level_name`,
          displayName: sql`excluded.display_name`,
          subRank: sql`excluded.sub_rank`,
          sortOrder: sql`excluded.sort_order`,
          minPoints: sql`excluded.min_points`,
          minTurnover: sql`excluded.min_turnover`,
          commissionDiscountPct: sql`excluded.commission_discount_pct`,
          pointMultiplier: sql`excluded.point_multiplier`,
          cashbackPct: sql`excluded.cashback_pct`,
          isArchived: sql`excluded.is_archived`,
        },
      });
  }
  // Bump the sequence past our hard-coded IDs.
  await pgClient`SELECT setval(pg_get_serial_sequence('loyalty_tiers','id'), GREATEST((SELECT MAX(id) FROM loyalty_tiers), 1))`;
}

async function seedPaymentMethodTypes() {
  for (const [code, labelTr, labelEn, availableFor, sortOrder, etaMin, etaMax, etaUnit] of PAYMENT_METHOD_TYPES) {
    await db
      .insert(s.paymentMethodTypes)
      .values({
        code,
        labelTr,
        labelEn,
        availableFor,
        sortOrder,
        isEnabled: true,
        withdrawEtaMin: etaMin,
        withdrawEtaMax: etaMax,
        withdrawEtaUnit: etaUnit,
      })
      .onConflictDoNothing();
  }
}

async function seedCashoutMethods() {
  for (const [code, label, network, sortOrder, minAmount, maxAmount] of CASHOUT_METHODS) {
    await db
      .insert(s.merchantCashoutMethods)
      .values({ code, label, network, sortOrder, minAmount, maxAmount, isActive: true })
      .onConflictDoNothing();
  }
}

async function seedBoPermissions() {
  for (const [role, resource, action] of BO_PERMISSIONS) {
    await db
      .insert(s.boPermissions)
      .values({ role, resource, action, granted: true })
      .onConflictDoNothing();
  }
}

async function seedReferralConfig() {
  await db
    .insert(s.referralConfig)
    .values({
      id: true,
      referrerPoints: 100,
      referrerBalance: "0",
      refereePoints: 50,
      refereeBalance: "0",
      qualifyingSpendMin: "100",
      expireAfterDays: 90,
      monthlyCapPerReferrer: 50,
      ipCapPerDay: 5,
      isEnabled: true,
    })
    .onConflictDoNothing();
}

async function seedSettings() {
  const defaults: Array<{ key: string; value: unknown; description: string }> = [
    { key: "affiliate_system_enabled", value: false, description: "Master switch for Akış F" },
    { key: "topup_session_ttl_seconds", value: 1200, description: "20 minutes" },
    { key: "withdraw_session_ttl_seconds", value: 1800, description: "30 minutes" },
    { key: "payment_code_default_ttl_seconds", value: 300, description: "5 minutes" },
    { key: "merchant_idempotency_ttl_days", value: 7, description: "7 day idempotency window" },
  ];
  for (const { key, value, description } of defaults) {
    await db
      .insert(s.settings)
      .values({ key, value: value as never, description })
      .onConflictDoNothing();
  }
}

async function main() {
  // P3 — refuse to run seeders in production unless explicitly allowed. The
  // seed sets default settings, BO permissions, etc.; rerunning it on a real
  // DB is generally idempotent but can surprise operators who relied on
  // manual config drift.
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED !== "true") {
    throw new Error(
      "Refusing to run seed in production. Set ALLOW_SEED=true to override.",
    );
  }
  logger.info("seeding…");
  await db.transaction(async () => {
    await seedLoyaltyTiers();
    await seedPaymentMethodTypes();
    await seedCashoutMethods();
    await seedBoPermissions();
    await seedReferralConfig();
    await seedSettings();
  });

  const counts = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM loyalty_tiers) AS tiers,
      (SELECT count(*) FROM payment_method_types) AS method_types,
      (SELECT count(*) FROM merchant_cashout_methods) AS cashout_methods,
      (SELECT count(*) FROM bo_permissions) AS bo_perms,
      (SELECT count(*) FROM referral_config) AS referral_config,
      (SELECT count(*) FROM settings) AS settings
  `);
  logger.info({ counts: counts[0] }, "seed complete");
  await pgClient.end();
}

main().catch((err) => {
  logger.error({ err }, "seed failed");
  process.exit(1);
});
