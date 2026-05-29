#!/usr/bin/env node
/**
 * Idempotent test-fixture seeder for local / CI databases.
 *
 * Prerequisites: `npm run db:migrate` + `npm run db:seed` (base catalog rows).
 *
 * Run:  npm run test:seed
 *       ALLOW_TEST_SEED=true npm run test:seed   (production override)
 *
 * Reads DATABASE_URL (+ crypto peppers) from apps/api/.env.
 */
import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ENV_PATH = join(ROOT, "apps/api/.env");

dotenv.config({ path: ENV_PATH });

const PASSWORD = process.env.TEST_FIXTURE_PASSWORD ?? "Test1234!";
const BCRYPT_COST = 12;
const FIXTURE_TAG = "seed-test-fixtures-v1";

/** Stable UUIDs — first insert only; re-runs resolve by email / api_key. */
const FIX = {
  staffAccounting: "a1000001-0000-4000-8000-000000000001",
  staffSupport: "a1000001-0000-4000-8000-000000000002",
  memberBase: "b2000001-0000-4000-8000-000000000001",
  memberFunded: "b2000001-0000-4000-8000-000000000002",
  memberFrozen: "b2000001-0000-4000-8000-000000000003",
  memberKycPending: "b2000001-0000-4000-8000-000000000004",
  memberReferrer: "b2000001-0000-4000-8000-000000000005",
  memberReferee: "b2000001-0000-4000-8000-000000000006",
  memberPendingTopup: "b2000001-0000-4000-8000-000000000007",
  memberLoyalty: "b2000001-0000-4000-8000-000000000008",
  memberChat: "b2000001-0000-4000-8000-000000000009",
  merchantUserOwner: "c3000001-0000-4000-8000-000000000001",
  merchantUserAccountant: "c3000001-0000-4000-8000-000000000002",
  merchantUserReadonly: "c3000001-0000-4000-8000-000000000003",
  merchantUserParent: "c3000001-0000-4000-8000-000000000004",
  merchantUserFinance: "c3000001-0000-4000-8000-000000000005",
  affiliateUser: "d4000001-0000-4000-8000-000000000001",
  commerceStandalone: "e5000001-0000-4000-8000-000000000001",
  commerceParent: "e5000001-0000-4000-8000-000000000002",
  commerceChild: "e5000001-0000-4000-8000-000000000003",
  financeHavale: "e5000001-0000-4000-8000-000000000004",
  financePapara: "e5000001-0000-4000-8000-000000000005",
  providerTest: "f6000001-0000-4000-8000-000000000001",
  pmHavale: "f6000001-0000-4000-8000-000000000002",
  pmPapara: "f6000001-0000-4000-8000-000000000003",
  referralRow: "a9000001-0000-4000-8000-000000000001",
  txTopup: "a9000001-0000-4000-8000-000000000010",
  txSpend: "a9000001-0000-4000-8000-000000000011",
  txBonus: "a9000001-0000-4000-8000-000000000012",
  chatThread: "a9000001-0000-4000-8000-000000000020",
  chatMsgMember: "a9000001-0000-4000-8000-000000000021",
  chatMsgStaff: "a9000001-0000-4000-8000-000000000022",
  notifWelcome: "a9000001-0000-4000-8000-000000000030",
  notifTopup: "a9000001-0000-4000-8000-000000000031",
  loyaltyLog: "a9000001-0000-4000-8000-000000000040",
  topupSession: "a9000001-0000-4000-8000-000000000050",
  topupSessionCompleted: "a9000001-0000-4000-8000-000000000051",
  psCampaign: "a9000001-0000-4000-8000-000000000060",
  psAllocation: "a9000001-0000-4000-8000-000000000061",
  affiliateRow: "a9000001-0000-4000-8000-000000000070",
  affiliateLink: "a9000001-0000-4000-8000-000000000071",
  apiCallFinance: "a9000001-0000-4000-8000-000000000090",
};

const MERCHANT_KEYS = {
  commerceStandalone: "tk_fixture0000000000000000000001",
  commerceParent: "tk_fixture0000000000000000000002",
  commerceChild: "tk_child00000000000000000000001",
  financeHavale: "tk_fixture0000000000000000000003",
  financePapara: "tk_fixture0000000000000000000004",
};

const MERCHANT_SECRETS = {
  commerceStandalone: {
    signing: "fixture_commerce_sa_signing_secret_32b",
    api: "fixture_commerce_sa_api_secret____32b",
  },
  commerceParent: {
    signing: "fixture_commerce_parent_signing_sec32",
    api: "fixture_commerce_parent_api_secret_32",
  },
  commerceChild: {
    signing: "fixture_commerce_child_signing_sec_32",
    api: "fixture_commerce_child_api_secret__32",
  },
  financeHavale: {
    signing: "fixture_finance_havale_signing_sec32",
    api: "fixture_finance_havale_api_secret_32",
  },
  financePapara: {
    signing: "fixture_finance_papara_signing_sec32",
    api: "fixture_finance_papara_api_secret_32",
  },
};

function assertEnv() {
  if (!process.env.DATABASE_URL) {
    throw new Error(`DATABASE_URL missing — expected in ${ENV_PATH}`);
  }
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_TEST_SEED !== "true") {
    throw new Error(
      "Refusing to seed test fixtures in production. Set ALLOW_TEST_SEED=true to override.",
    );
  }
  if (!process.env.MFA_ENCRYPTION_KEY?.match(/^[0-9a-fA-F]{64}$/)) {
    throw new Error("MFA_ENCRYPTION_KEY must be 64 hex chars (apps/api/.env)");
  }
  if (!process.env.MERCHANT_HMAC_PEPPER || process.env.MERCHANT_HMAC_PEPPER.length < 16) {
    throw new Error("MERCHANT_HMAC_PEPPER must be set (apps/api/.env)");
  }
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_COST);
}

function pepperedHash(secret) {
  return createHmac("sha256", process.env.MERCHANT_HMAC_PEPPER).update(secret).digest("hex");
}

function encryptString(plain) {
  const key = Buffer.from(process.env.MFA_ENCRYPTION_KEY, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

function genMemberNo(seed) {
  const n = 10_000_000 + (seed % 89_999_999);
  return String(n);
}

function genReferralCode(seed) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += alphabet[(seed + i * 7) % alphabet.length];
  }
  return `R-${s}`;
}

function log(msg) {
  process.stderr.write(`${msg}\n`);
}

/** Integer-cent fee math — mirrors apps/api/src/lib/fees.ts for seed coherence. */
function computeFee(amount, commissionPct = 0, fixedFee = 0) {
  const toMinor = (n) => BigInt(Math.round(Number(n) * 100));
  const amountMinor = toMinor(amount);
  const pctBps = toMinor(commissionPct);
  const flatMinor = toMinor(fixedFee);
  const product = amountMinor * pctBps;
  const quot = product / 10000n;
  const rem = product % 10000n;
  let pctMinor;
  const halfWay = rem * 2n;
  if (halfWay === 10000n) {
    pctMinor = quot % 2n === 0n ? quot : quot + (product < 0n ? -1n : 1n);
  } else if (halfWay > 10000n) {
    pctMinor = quot + (product < 0n ? -1n : 1n);
  } else if (halfWay < -10000n) {
    pctMinor = quot - 1n;
  } else {
    pctMinor = quot;
  }
  const feeMinor = pctMinor + flatMinor;
  const sign = feeMinor < 0n ? "-" : "";
  const abs = feeMinor < 0n ? -feeMinor : feeMinor;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return Number(`${sign}${whole}.${frac.toString().padStart(2, "0")}`);
}

function fmtMoney(n) {
  return Number(n).toFixed(2);
}

function fixtureMeta(extra = {}) {
  return JSON.stringify({ fixture: FIXTURE_TAG, ...extra });
}

async function upsertUser(client, {
  id,
  email,
  firstName,
  lastName,
  memberNo,
  referralCode,
  profile = {},
  account = {},
  roles = [],
}) {
  const normalized = email.toLowerCase();
  const passwordHash = await hashPassword(PASSWORD);

  const existing = await client.query(
    `SELECT id FROM users WHERE lower(email) = $1 LIMIT 1`,
    [normalized],
  );
  let userId = existing.rows[0]?.id ?? id;

  if (!existing.rows[0]) {
    await client.query(
      `INSERT INTO users (id, email, password_hash, email_verified_at, is_active)
       VALUES ($1, $2, $3, now(), true)
       ON CONFLICT (id) DO NOTHING`,
      [userId, normalized, passwordHash],
    );
  } else {
    await client.query(
      `UPDATE users SET password_hash = $2, email_verified_at = COALESCE(email_verified_at, now()), is_active = true
       WHERE id = $1`,
      [userId, passwordHash],
    );
  }

  await client.query(
    `INSERT INTO profiles (
       id, email, first_name, last_name, phone, kyc_status, is_frozen,
       member_no, referral_code, signup_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
     ON CONFLICT (id) DO UPDATE SET
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       kyc_status = EXCLUDED.kyc_status,
       is_frozen = EXCLUDED.is_frozen,
       member_no = EXCLUDED.member_no,
       referral_code = COALESCE(profiles.referral_code, EXCLUDED.referral_code)`,
    [
      userId,
      normalized,
      firstName,
      lastName,
      profile.phone ?? null,
      profile.kycStatus ?? "none",
      profile.isFrozen ?? false,
      memberNo,
      referralCode,
    ],
  );

  await client.query(
    `INSERT INTO accounts (user_id, balance, reserved_balance, total_points, current_tier_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       balance = EXCLUDED.balance,
       reserved_balance = EXCLUDED.reserved_balance,
       total_points = EXCLUDED.total_points,
       current_tier_id = EXCLUDED.current_tier_id,
       updated_at = now()`,
    [
      userId,
      account.balance ?? "0",
      account.reservedBalance ?? "0",
      account.totalPoints ?? 0,
      account.currentTierId ?? null,
    ],
  );

  for (const role of roles) {
    await client.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, $2)
       ON CONFLICT ON CONSTRAINT user_roles_user_role_unique DO NOTHING`,
      [userId, role],
    );
  }

  return userId;
}

async function upsertMerchant(client, {
  id,
  name,
  apiKey,
  secrets,
  merchantType,
  merchantScope = "standalone",
  parentMerchantId = null,
  topupInitUrl = null,
  cashPool = "50000",
  balance = "0",
  creditLimit = "10000",
}) {
  const apiSecretHash = pepperedHash(secrets.api);
  const signingSecretEncrypted = encryptString(secrets.signing);

  const existing = await client.query(`SELECT id FROM merchants WHERE api_key = $1 LIMIT 1`, [apiKey]);
  const merchantId = existing.rows[0]?.id ?? id;

  const cols = `
    name = $2,
    api_secret_hash = $3,
    is_active = true,
    merchant_type = $4,
    commission_pct = '2.50',
    fixed_fee = '0',
    balance = $5,
    credit_limit = $6,
    cash_pool = $7::numeric,
    cash_pool_updated_at = now(),
    merchant_scope = $8,
    parent_merchant_id = $9,
    signing_secret = NULL,
    signing_secret_encrypted = $10,
    signing_secret_set_at = now(),
    topup_init_url = COALESCE($11, topup_init_url)
  `;

  if (existing.rows[0]) {
    await client.query(
      `UPDATE merchants SET ${cols} WHERE id = $1`,
      [
        merchantId,
        name,
        apiSecretHash,
        merchantType,
        balance,
        creditLimit,
        cashPool,
        merchantScope,
        parentMerchantId,
        signingSecretEncrypted,
        topupInitUrl,
      ],
    );
  } else {
    await client.query(
      `INSERT INTO merchants (
         id, name, api_key, api_secret_hash, is_active, merchant_type,
         commission_pct, fixed_fee, balance, credit_limit, cash_pool,
         cash_pool_updated_at, merchant_scope, parent_merchant_id,
         signing_secret, signing_secret_encrypted, signing_secret_set_at,
         topup_init_url, ip_whitelist
       ) VALUES (
         $1,$2,$3,$4,true,$5,
         '2.50','0',$6,$7,$8,
         now(),$9,$10,
         NULL,$11,now(),
         $12,'{}'::text[]
       )`,
      [
        merchantId,
        name,
        apiKey,
        apiSecretHash,
        merchantType,
        balance,
        creditLimit,
        cashPool,
        merchantScope,
        parentMerchantId,
        signingSecretEncrypted,
        topupInitUrl,
      ],
    );
  }

  return merchantId;
}

async function upsertMerchantUser(client, { id, merchantId, userId, email, role, fullName }) {
  await client.query(
    `INSERT INTO merchant_users (id, merchant_id, user_id, email, full_name, role, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,true)
     ON CONFLICT ON CONSTRAINT merchant_users_user_merchant_unique DO UPDATE SET
       role = EXCLUDED.role,
       is_active = true,
       full_name = EXCLUDED.full_name`,
    [id, merchantId, userId, email.toLowerCase(), fullName, role],
  );
}

async function seedPaymentCatalog(client) {
  await client.query(
    `INSERT INTO payment_providers (id, code, name, is_active, commission_pct, fixed_fee, sort_order)
     VALUES ($1,'test_finance','Test Finance Provider',true,'0','0',1)
     ON CONFLICT (code) DO NOTHING`,
    [FIX.providerTest],
  );

  const prov = await client.query(`SELECT id FROM payment_providers WHERE code = 'test_finance' LIMIT 1`);
  const providerId = prov.rows[0]?.id ?? FIX.providerTest;

  for (const [id, code, name, kind] of [
    [FIX.pmHavale, "havale", "Test Havale", "both"],
    [FIX.pmPapara, "papara", "Test Papara", "both"],
  ]) {
    await client.query(
      `INSERT INTO payment_methods (id, provider_id, code, name, kind, is_active, commission_pct, fixed_fee, sort_order)
       VALUES ($1,$2,$3,$4,$5,true,'0','0',0)
       ON CONFLICT ON CONSTRAINT payment_methods_provider_code_unique DO NOTHING`,
      [id, providerId, code, name, kind],
    );
  }

  const havalePm = (
    await client.query(
      `SELECT id FROM payment_methods WHERE provider_id = $1 AND code = 'havale' LIMIT 1`,
      [providerId],
    )
  ).rows[0].id;
  const paparaPm = (
    await client.query(
      `SELECT id FROM payment_methods WHERE provider_id = $1 AND code = 'papara' LIMIT 1`,
      [providerId],
    )
  ).rows[0].id;

  return { providerId, havalePm, paparaPm };
}

async function seedMerchantMethods(client, merchantId, code, name, kind = "both") {
  await client.query(
    `INSERT INTO merchant_methods (merchant_id, code, name, kind, is_active, sort_order)
     VALUES ($1,$2,$3,$4,true,0)
     ON CONFLICT ON CONSTRAINT merchant_methods_merchant_code_unique DO NOTHING`,
    [merchantId, code, name, kind],
  );
}

async function seedProviderMethodMap(client, merchantId, txType, providerMethodId, actorId) {
  await client.query(
    `UPDATE merchant_provider_method_map
     SET is_active = false, updated_at = now()
     WHERE merchant_id = $1 AND tx_type = $2 AND is_active = true`,
    [merchantId, txType],
  );
  await client.query(
    `INSERT INTO merchant_provider_method_map (merchant_id, tx_type, provider_method_id, is_active, created_by)
     VALUES ($1,$2,$3,true,$4)
     ON CONFLICT DO NOTHING`,
    [merchantId, txType, providerMethodId, actorId],
  );
}

async function seedRoutingRule(client, methodType, direction, merchantId, weightPct) {
  await client.query(
    `INSERT INTO payment_routing_rules (method_type, direction, merchant_id, weight_pct, is_active)
     VALUES ($1,$2,$3,$4,true)
     ON CONFLICT ON CONSTRAINT payment_routing_rules_unique DO UPDATE SET
       weight_pct = EXCLUDED.weight_pct,
       is_active = true,
       updated_at = now()`,
    [methodType, direction, merchantId, weightPct],
  );
}

async function clearFixtureLedger(client) {
  await client.query(
    `DELETE FROM merchant_settlement_log
     WHERE notes LIKE $1
        OR (reference_type = 'transaction' AND reference_id IN (
          SELECT id FROM transactions WHERE metadata->>'fixture' = $2
        ))`,
    [`%${FIXTURE_TAG}%`, FIXTURE_TAG],
  );
  await client.query(
    `DELETE FROM merchant_cash_pool_log
     WHERE notes LIKE $1
        OR (reference_type IN ('transaction', 'topup_session') AND reference_id IN (
          SELECT id FROM transactions WHERE metadata->>'fixture' = $2
        ))`,
    [`%${FIXTURE_TAG}%`, FIXTURE_TAG],
  );
  await client.query(`DELETE FROM transactions WHERE metadata->>'fixture' = $1`, [FIXTURE_TAG]);
}

async function seedLedgerCoherentData(client, ids) {
  const {
    memberFunded,
    memberLoyalty,
    memberPendingTopup,
    commerceStandalone,
    commerceParent,
    commerceChild,
    financeHavale,
    financePapara,
    merchantUserOwner,
  } = ids;

  await clearFixtureLedger(client);

  const TOPUP_AMOUNT = 5000;
  const SPEND_AMOUNT = 250;
  const COMMISSION_PCT = 2.5;
  const spendFee = computeFee(SPEND_AMOUNT, COMMISSION_PCT, 0);
  const spendMerchantNet = SPEND_AMOUNT - spendFee;
  const memberTopupBalance = fmtMoney(TOPUP_AMOUNT);
  const memberFinalBalance = fmtMoney(TOPUP_AMOUNT - SPEND_AMOUNT);

  const topupCreatedAt = new Date(Date.now() - 2 * 86400000).toISOString();
  const spendCreatedAt = new Date(Date.now() - 86400000).toISOString();
  const pendingExpiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();

  const publicTopup = "T-FIXTURE-000001";
  const publicSpend = "P-FIXTURE-000001";
  const publicBonus = "B-FIXTURE-000001";
  const topupPublicNo = "T-FIXTURE-000099";
  const topupMerchantRef = "FIX-TOPUP-001";

  // Completed topup session (Flow C) — memberFunded
  await client.query(
    `INSERT INTO topup_sessions (
       id, public_no, user_id, merchant_id, method_type, amount, status,
       merchant_ref, iban, account_holder, bank_name, payment_reference,
       finalized_at, expires_at
     ) VALUES ($1,$2,$3,$4,'havale',$5,'success',
       $6,'TR330006100519786457841326','Test Fixture A.Ş.','Test Bank','FIX-REF-COMPLETE',
       $7,$7)
     ON CONFLICT (public_no) DO UPDATE SET
       status = 'success',
       amount = EXCLUDED.amount,
       merchant_id = EXCLUDED.merchant_id,
       user_id = EXCLUDED.user_id,
       finalized_at = EXCLUDED.finalized_at,
       expires_at = EXCLUDED.expires_at`,
    [
      FIX.topupSessionCompleted,
      publicTopup,
      memberFunded,
      financeHavale,
      fmtMoney(TOPUP_AMOUNT),
      topupMerchantRef,
      topupCreatedAt,
    ],
  );

  // Pending topup session — memberPendingTopup (non-ledger; future expiry)
  await client.query(
    `UPDATE topup_sessions SET status = 'cancelled', updated_at = now()
     WHERE user_id = $1 AND status IN ('pending','awaiting_member_action','member_confirmed','redirected')
       AND id <> $2`,
    [memberPendingTopup, FIX.topupSession],
  );
  await client.query(
    `INSERT INTO topup_sessions (
       id, public_no, user_id, merchant_id, method_type, amount, status,
       iban, account_holder, bank_name, payment_reference, expires_at
     ) VALUES ($1,$2,$3,$4,'havale','750.00','pending',
       'TR330006100519786457841326','Test Fixture A.Ş.','Test Bank','FIX-REF-001',$5)
     ON CONFLICT (public_no) DO UPDATE SET
       status = 'pending',
       expires_at = EXCLUDED.expires_at,
       amount = EXCLUDED.amount`,
    [FIX.topupSession, topupPublicNo, memberPendingTopup, financeHavale, pendingExpiresAt],
  );

  // Member transactions — topup then spend (balance_after chain)
  await client.query(
    `INSERT INTO transactions (
       id, public_no, user_id, type, status, amount, fee, balance_after,
       description, reference_id, merchant_ref, metadata, created_at
     ) VALUES ($1,$2,$3,'topup','completed',$4,'0',$5,'Fixture topup',$6,$7,$8::jsonb,$9)
     ON CONFLICT (public_no) DO UPDATE SET
       amount = EXCLUDED.amount,
       fee = EXCLUDED.fee,
       balance_after = EXCLUDED.balance_after,
       reference_id = EXCLUDED.reference_id,
       merchant_ref = EXCLUDED.merchant_ref,
       metadata = EXCLUDED.metadata,
       created_at = EXCLUDED.created_at`,
    [
      FIX.txTopup,
      publicTopup,
      memberFunded,
      fmtMoney(TOPUP_AMOUNT),
      memberTopupBalance,
      FIX.topupSessionCompleted,
      topupMerchantRef,
      fixtureMeta({ merchant_id: financeHavale, flow: "C" }),
      topupCreatedAt,
    ],
  );

  await client.query(
    `INSERT INTO transactions (
       id, public_no, user_id, type, status, amount, fee, balance_after,
       description, metadata, created_at
     ) VALUES ($1,$2,$3,'spend','completed',$4,$5,$6,'Fixture spend',$7::jsonb,$8)
     ON CONFLICT (public_no) DO UPDATE SET
       amount = EXCLUDED.amount,
       fee = EXCLUDED.fee,
       balance_after = EXCLUDED.balance_after,
       metadata = EXCLUDED.metadata,
       created_at = EXCLUDED.created_at`,
    [
      FIX.txSpend,
      publicSpend,
      memberFunded,
      fmtMoney(SPEND_AMOUNT),
      fmtMoney(spendFee),
      memberFinalBalance,
      fixtureMeta({ merchant_id: commerceStandalone, flow: "A" }),
      spendCreatedAt,
    ],
  );

  await client.query(
    `INSERT INTO transactions (
       id, public_no, user_id, type, status, amount, fee, balance_after,
       description, metadata
     ) VALUES ($1,$2,$3,'bonus','completed','0','0','0','Fixture loyalty bonus tx',$4::jsonb)
     ON CONFLICT (public_no) DO UPDATE SET
       amount = EXCLUDED.amount,
       balance_after = EXCLUDED.balance_after,
       metadata = EXCLUDED.metadata`,
    [FIX.txBonus, publicBonus, memberLoyalty, fixtureMeta()],
  );

  // Finance havale — opening cash_pool + topup posting (Flow C)
  const havaleOpening = 95000;
  const havaleAfterTopup = havaleOpening + TOPUP_AMOUNT;
  await client.query(
    `INSERT INTO merchant_cash_pool_log (
       merchant_id, change_amount, balance_before, balance_after, reason, notes, created_by, created_at
     ) VALUES ($1,$2,'0',$2,'manual_in',$3,$4,$5)`,
    [
      financeHavale,
      fmtMoney(havaleOpening),
      fixtureMeta({ note: "opening cash_pool" }),
      merchantUserOwner,
      new Date(Date.now() - 3 * 86400000).toISOString(),
    ],
  );
  await client.query(
    `INSERT INTO merchant_cash_pool_log (
       merchant_id, change_amount, balance_before, balance_after, reason,
       reference_type, reference_id, notes, created_at
     ) VALUES ($1,$2,$3,$4,'topup_cash_pool','topup_session',$5,$6,$7)`,
    [
      financeHavale,
      fmtMoney(TOPUP_AMOUNT),
      fmtMoney(havaleOpening),
      fmtMoney(havaleAfterTopup),
      FIX.topupSessionCompleted,
      fixtureMeta({ merchant_ref: topupMerchantRef, flow: "C" }),
      topupCreatedAt,
    ],
  );

  // Finance papara — opening cash_pool only (no settlement logs on finance merchants)
  await client.query(
    `INSERT INTO merchant_cash_pool_log (
       merchant_id, change_amount, balance_before, balance_after, reason, notes, created_by
     ) VALUES ($1,'75000.00','0','75000.00','manual_in',$2,$3)`,
    [financePapara, fixtureMeta({ note: "opening cash_pool" }), merchantUserOwner],
  );

  // Commerce standalone — spend settlement (Flow A)
  await client.query(
    `INSERT INTO merchant_settlement_log (
       merchant_id, change_amount, balance_before, balance_after, reason,
       reference_type, reference_id, notes, created_by, created_at
     ) VALUES ($1,$2,'0',$2,'spend','transaction',$3,$4,$5,$6)`,
    [
      commerceStandalone,
      fmtMoney(spendMerchantNet),
      FIX.txSpend,
      fixtureMeta({ flow: "A" }),
      merchantUserOwner,
      spendCreatedAt,
    ],
  );

  // Commerce parent / child — standalone settlement balances for BO fixtures
  await client.query(
    `INSERT INTO merchant_settlement_log (
       merchant_id, change_amount, balance_before, balance_after, reason, notes, created_by
     ) VALUES ($1,'500.00','0','500.00','manual_settlement',$2,$3)`,
    [commerceParent, fixtureMeta({ note: "parent BO opening balance" }), merchantUserOwner],
  );
  await client.query(
    `INSERT INTO merchant_settlement_log (
       merchant_id, change_amount, balance_before, balance_after, reason, notes, created_by
     ) VALUES ($1,'200.00','0','200.00','pay_to_merchant',$2,$3)`,
    [
      commerceChild,
      fixtureMeta({ note: "child settlement for parent BO" }),
      merchantUserOwner,
    ],
  );

  // Sync merchant columns + member account to ledger tails
  await client.query(`UPDATE merchants SET balance = $2 WHERE id = $1`, [
    commerceStandalone,
    fmtMoney(spendMerchantNet),
  ]);
  await client.query(`UPDATE merchants SET balance = '500.00' WHERE id = $1`, [commerceParent]);
  await client.query(`UPDATE merchants SET balance = '200.00' WHERE id = $1`, [commerceChild]);
  await client.query(`UPDATE merchants SET balance = '0', cash_pool = $2, cash_pool_updated_at = now() WHERE id = $1`, [
    financeHavale,
    fmtMoney(havaleAfterTopup),
  ]);
  await client.query(
    `UPDATE merchants SET balance = '0', cash_pool = '75000.00', cash_pool_updated_at = now() WHERE id = $1`,
    [financePapara],
  );
  await client.query(
    `UPDATE accounts SET balance = $2, reserved_balance = '0', updated_at = now() WHERE user_id = $1`,
    [memberFunded, memberFinalBalance],
  );
  await client.query(
    `UPDATE accounts SET balance = '0', reserved_balance = '0', updated_at = now() WHERE user_id = $1`,
    [memberLoyalty],
  );
}

async function seedSampleData(client, ids) {
  const {
    memberFunded,
    memberReferrer,
    memberReferee,
    memberPendingTopup,
    memberLoyalty,
    memberChat,
    staffSupport,
    commerceStandalone,
    financeHavale,
    havalePm,
    paparaPm,
  } = ids;

  const chatPublicNo = "CHT-FIXTURE-000001";

  await client.query(
    `INSERT INTO referrals (
       id, referrer_user_id, referee_user_id, status, qualifying_event, qualifying_amount, qualified_at, meta
     ) VALUES ($1,$2,$3,'qualified','first_spend','100.00',now(),$4::jsonb)
     ON CONFLICT ON CONSTRAINT referrals_referee_unique DO UPDATE SET
       status = EXCLUDED.status,
       referrer_user_id = EXCLUDED.referrer_user_id`,
    [
      FIX.referralRow,
      memberReferrer,
      memberReferee,
      JSON.stringify({ fixture: FIXTURE_TAG }),
    ],
  );

  await client.query(
    `INSERT INTO loyalty_points_log (id, user_id, points, reason, reference_id, metadata)
     VALUES ($1,$2,500,'manual_grant',$3,$4::jsonb)
     ON CONFLICT DO NOTHING`,
    [FIX.loyaltyLog, memberLoyalty, FIX.txBonus, JSON.stringify({ fixture: FIXTURE_TAG })],
  );

  await client.query(
    `INSERT INTO chat_threads (
       id, public_no, user_id, category, subject, status, claimed_by_staff_id, claimed_at, last_message_at
     ) VALUES ($1,$2,$3,'general','Test destek talebi','open',$4,now(),now())
     ON CONFLICT (public_no) DO UPDATE SET
       status = 'open',
       claimed_by_staff_id = EXCLUDED.claimed_by_staff_id,
       last_message_at = now()`,
    [FIX.chatThread, chatPublicNo, memberChat, staffSupport],
  );

  for (const [id, senderRole, senderUserId, body] of [
    [FIX.chatMsgMember, "member", memberChat, "Merhaba, test mesajı — member.chat@"],
    [FIX.chatMsgStaff, "staff", staffSupport, "Merhaba, test yanıtı — support@"],
  ]) {
    await client.query(
      `INSERT INTO chat_messages (id, thread_id, sender_role, sender_user_id, body, metadata)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [id, FIX.chatThread, senderRole, senderUserId, body, JSON.stringify({ fixture: FIXTURE_TAG })],
    );
  }

  for (const [id, userId, category, titleTr, bodyTr] of [
    [FIX.notifWelcome, memberFunded, "wallet", "Hoş geldiniz", "Test bakiyeniz yüklendi."],
    [FIX.notifTopup, memberPendingTopup, "topup", "Yatırım bekleniyor", "Havale onayı bekleniyor."],
  ]) {
    await client.query(
      `INSERT INTO notifications (id, user_id, category, title_tr, body_tr, metadata)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [id, userId, category, titleTr, bodyTr, JSON.stringify({ fixture: FIXTURE_TAG })],
    );
  }

  const periodFrom = new Date(Date.now() - 7 * 86400000).toISOString();
  const periodTo = new Date().toISOString();
  const claimExpires = new Date(Date.now() + 7 * 86400000).toISOString();

  await client.query(
    `INSERT INTO profit_share_campaigns (
       id, period_type, period_from, period_to, distribution_pct,
       platform_revenue, platform_cost, affiliate_cost, net_profit, pool_amount,
       top_turnover_total, eligible_count, max_recipients, claim_expires_hours, status, notes
     ) VALUES (
       $1,'weekly',$2,$3,'10',
       '10000','2000','0','8000','800',
       '25000',1,10,168,'published','Test fixture campaign'
     )
     ON CONFLICT (id) DO UPDATE SET status = 'published'`,
    [FIX.psCampaign, periodFrom, periodTo],
  );

  await client.query(
    `INSERT INTO profit_share_allocations (
       id, campaign_id, user_id, rank_no, turnover_amount, share_pct, allocated_amount,
       status, expires_at
     ) VALUES ($1,$2,$3,1,'25000','100','800','pending',$4)
     ON CONFLICT ON CONSTRAINT ps_alloc_campaign_user_unique DO UPDATE SET
       allocated_amount = EXCLUDED.allocated_amount,
       status = 'pending',
       expires_at = EXCLUDED.expires_at`,
    [FIX.psAllocation, FIX.psCampaign, memberFunded, claimExpires],
  );

  const affiliateExists = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'merchant_affiliates'`,
  );
  if (affiliateExists.rows.length) {
    await client.query(
      `INSERT INTO merchant_affiliates (
         id, kind, code, name, email, linked_user_id, auth_user_id, status, meta
       ) VALUES ($1,'internal_member','AFF-FIXTURE','Test Affiliate','affiliate@wallet.local',$2,$2,'active',$3::jsonb)
       ON CONFLICT DO NOTHING`,
      [FIX.affiliateRow, ids.affiliateUser, JSON.stringify({ fixture: FIXTURE_TAG })],
    );

    const aff = await client.query(`SELECT id FROM merchant_affiliates WHERE code = 'AFF-FIXTURE' LIMIT 1`);
    if (aff.rows[0]) {
      await client.query(
        `INSERT INTO merchant_affiliate_links (
           id, affiliate_id, merchant_id, commission_basis, commission_pct, status, notes
         ) VALUES ($1,$2,$3,'pct','5','active','Fixture affiliate link')
         ON CONFLICT (id) DO NOTHING`,
        [FIX.affiliateLink, aff.rows[0].id, commerceStandalone],
      );
    }
  }

  await seedProviderMethodMap(client, financeHavale, "topup", havalePm, staffSupport);
  await seedProviderMethodMap(client, financeHavale, "withdraw", havalePm, staffSupport);
  await seedProviderMethodMap(client, ids.financePapara, "topup", paparaPm, staffSupport);
  await seedProviderMethodMap(client, ids.financePapara, "withdraw", paparaPm, staffSupport);
}

async function seedMerchantBoData(client, ids) {
  const { financeHavale } = ids;

  await client.query(
    `INSERT INTO merchant_api_calls (
       id, merchant_id, endpoint, method, ip, status_code, error_code, latency_ms, merchant_ref, request_body, response_body
     ) VALUES ($1,$2,'/merchant-api/topup/init','POST','127.0.0.1',200,NULL,42,'FIX-API-001',$3::jsonb,$4::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [
      FIX.apiCallFinance,
      financeHavale,
      JSON.stringify({ fixture: FIXTURE_TAG, amount: 750 }),
      JSON.stringify({ ok: true, fixture: FIXTURE_TAG }),
    ],
  );
}

async function main() {
  assertEnv();
  log(`[test:seed] Loading env from ${ENV_PATH}`);
  log(`[test:seed] Target: ${process.env.DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}`);

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const tierRow = await client.query(
      `SELECT id FROM loyalty_tiers WHERE level_name = 'silver' AND sub_rank = 0 LIMIT 1`,
    );
    const silverTierId = tierRow.rows[0]?.id ?? 4;

    const staffAccounting = await upsertUser(client, {
      id: FIX.staffAccounting,
      email: "accounting@wallet.local",
      firstName: "Test",
      lastName: "Accounting",
      memberNo: genMemberNo(101),
      referralCode: genReferralCode(101),
      roles: ["accounting"],
    });

    const staffSupport = await upsertUser(client, {
      id: FIX.staffSupport,
      email: "support@wallet.local",
      firstName: "Test",
      lastName: "Support",
      memberNo: genMemberNo(102),
      referralCode: genReferralCode(102),
      roles: ["support"],
    });

    const memberBase = await upsertUser(client, {
      id: FIX.memberBase,
      email: "member.base@wallet.local",
      firstName: "Member",
      lastName: "Base",
      memberNo: "TST000001",
      referralCode: "R-TSTBASE1",
    });

    const memberFunded = await upsertUser(client, {
      id: FIX.memberFunded,
      email: "member.funded@wallet.local",
      firstName: "Member",
      lastName: "Funded",
      memberNo: "TST000002",
      referralCode: "R-TSTFUND1",
      account: { totalPoints: 1200, currentTierId: silverTierId },
    });

    await upsertUser(client, {
      id: FIX.memberFrozen,
      email: "member.frozen@wallet.local",
      firstName: "Member",
      lastName: "Frozen",
      memberNo: "TST000003",
      referralCode: "R-TSTFRZN1",
      profile: { isFrozen: true },
    });

    await upsertUser(client, {
      id: FIX.memberKycPending,
      email: "member.kyc-pending@wallet.local",
      firstName: "Member",
      lastName: "KycPending",
      memberNo: "TST000004",
      referralCode: "R-TSTKYC01",
      profile: { kycStatus: "pending" },
    });

    const memberReferrer = await upsertUser(client, {
      id: FIX.memberReferrer,
      email: "member.referrer@wallet.local",
      firstName: "Member",
      lastName: "Referrer",
      memberNo: "TST000005",
      referralCode: "R-TSTREF01",
    });

    const memberReferee = await upsertUser(client, {
      id: FIX.memberReferee,
      email: "member.referee@wallet.local",
      firstName: "Member",
      lastName: "Referee",
      memberNo: "TST000006",
      referralCode: "R-TSTREF02",
    });

    const memberPendingTopup = await upsertUser(client, {
      id: FIX.memberPendingTopup,
      email: "member.pending-topup@wallet.local",
      firstName: "Member",
      lastName: "PendingTopup",
      memberNo: "TST000007",
      referralCode: "R-TSTTOP01",
    });

    const memberLoyalty = await upsertUser(client, {
      id: FIX.memberLoyalty,
      email: "member.loyalty@wallet.local",
      firstName: "Member",
      lastName: "Loyalty",
      memberNo: "TST000008",
      referralCode: "R-TSTLOY01",
      account: { totalPoints: 3000, currentTierId: silverTierId },
    });

    const memberChat = await upsertUser(client, {
      id: FIX.memberChat,
      email: "member.chat@wallet.local",
      firstName: "Member",
      lastName: "Chat",
      memberNo: "TST000009",
      referralCode: "R-TSTCHT01",
    });

    const commerceStandalone = await upsertMerchant(client, {
      id: FIX.commerceStandalone,
      name: "Fixture Commerce (Standalone)",
      apiKey: MERCHANT_KEYS.commerceStandalone,
      secrets: MERCHANT_SECRETS.commerceStandalone,
      merchantType: "commerce",
      merchantScope: "standalone",
      balance: "0",
      cashPool: "0",
    });

    const commerceParent = await upsertMerchant(client, {
      id: FIX.commerceParent,
      name: "Fixture Commerce (Parent)",
      apiKey: MERCHANT_KEYS.commerceParent,
      secrets: MERCHANT_SECRETS.commerceParent,
      merchantType: "commerce",
      merchantScope: "parent",
      balance: "0",
    });

    const commerceChild = await upsertMerchant(client, {
      id: FIX.commerceChild,
      name: "Fixture Commerce (Child)",
      apiKey: MERCHANT_KEYS.commerceChild,
      secrets: MERCHANT_SECRETS.commerceChild,
      merchantType: "commerce",
      merchantScope: "child",
      parentMerchantId: commerceParent,
      balance: "0",
    });

    const financeHavale = await upsertMerchant(client, {
      id: FIX.financeHavale,
      name: "Fixture Finance Havale",
      apiKey: MERCHANT_KEYS.financeHavale,
      secrets: MERCHANT_SECRETS.financeHavale,
      merchantType: "finance",
      cashPool: "0",
      topupInitUrl: null,
    });

    const financePapara = await upsertMerchant(client, {
      id: FIX.financePapara,
      name: "Fixture Finance Papara",
      apiKey: MERCHANT_KEYS.financePapara,
      secrets: MERCHANT_SECRETS.financePapara,
      merchantType: "finance",
      cashPool: "0",
      topupInitUrl: "http://localhost:3000/mock/topup-init",
    });

    const merchantUserOwner = await upsertUser(client, {
      id: FIX.merchantUserOwner,
      email: "merchant.owner@wallet.local",
      firstName: "Merchant",
      lastName: "Owner",
      memberNo: genMemberNo(201),
      referralCode: genReferralCode(201),
    });
    const merchantUserAccountant = await upsertUser(client, {
      id: FIX.merchantUserAccountant,
      email: "merchant.accountant@wallet.local",
      firstName: "Merchant",
      lastName: "Accountant",
      memberNo: genMemberNo(202),
      referralCode: genReferralCode(202),
    });
    const merchantUserReadonly = await upsertUser(client, {
      id: FIX.merchantUserReadonly,
      email: "merchant.readonly@wallet.local",
      firstName: "Merchant",
      lastName: "Readonly",
      memberNo: genMemberNo(203),
      referralCode: genReferralCode(203),
    });

    await upsertMerchantUser(client, {
      id: FIX.merchantUserOwner,
      merchantId: commerceStandalone,
      userId: merchantUserOwner,
      email: "merchant.owner@wallet.local",
      role: "owner",
      fullName: "Merchant Owner",
    });
    await upsertMerchantUser(client, {
      id: FIX.merchantUserAccountant,
      merchantId: commerceStandalone,
      userId: merchantUserAccountant,
      email: "merchant.accountant@wallet.local",
      role: "accountant",
      fullName: "Merchant Accountant",
    });
    await upsertMerchantUser(client, {
      id: FIX.merchantUserReadonly,
      merchantId: commerceStandalone,
      userId: merchantUserReadonly,
      email: "merchant.readonly@wallet.local",
      role: "read_only",
      fullName: "Merchant Readonly",
    });

    const merchantUserParent = await upsertUser(client, {
      id: FIX.merchantUserParent,
      email: "merchant.parent@wallet.local",
      firstName: "Merchant",
      lastName: "Parent",
      memberNo: genMemberNo(204),
      referralCode: genReferralCode(204),
    });
    await upsertMerchantUser(client, {
      id: FIX.merchantUserParent,
      merchantId: commerceParent,
      userId: merchantUserParent,
      email: "merchant.parent@wallet.local",
      role: "owner",
      fullName: "Merchant Parent Owner",
    });

    const merchantUserFinance = await upsertUser(client, {
      id: FIX.merchantUserFinance,
      email: "merchant.finance@wallet.local",
      firstName: "Merchant",
      lastName: "Finance",
      memberNo: genMemberNo(205),
      referralCode: genReferralCode(205),
    });
    await upsertMerchantUser(client, {
      id: FIX.merchantUserFinance,
      merchantId: financeHavale,
      userId: merchantUserFinance,
      email: "merchant.finance@wallet.local",
      role: "owner",
      fullName: "Finance Merchant Owner",
    });

    const affiliateUser = await upsertUser(client, {
      id: FIX.affiliateUser,
      email: "affiliate@wallet.local",
      firstName: "Test",
      lastName: "Affiliate",
      memberNo: genMemberNo(301),
      referralCode: genReferralCode(301),
    });

    const { havalePm, paparaPm } = await seedPaymentCatalog(client);

    await seedMerchantMethods(client, financeHavale, "havale", "Havale / EFT", "both");
    await seedMerchantMethods(client, financePapara, "papara", "Papara", "both");

    await seedRoutingRule(client, "havale", "topup", financeHavale, "100");
    await seedRoutingRule(client, "havale", "withdraw", financeHavale, "100");
    await seedRoutingRule(client, "papara", "topup", financePapara, "100");
    await seedRoutingRule(client, "papara", "withdraw", financePapara, "100");

    await seedSampleData(client, {
      memberFunded,
      memberReferrer,
      memberReferee,
      memberPendingTopup,
      memberLoyalty,
      memberChat,
      staffSupport,
      affiliateUser,
      commerceStandalone,
      financeHavale,
      financePapara,
      havalePm,
      paparaPm,
    });

    await seedLedgerCoherentData(client, {
      memberFunded,
      memberLoyalty,
      memberPendingTopup,
      commerceStandalone,
      commerceParent,
      commerceChild,
      financeHavale,
      financePapara,
      merchantUserOwner,
    });

    await seedMerchantBoData(client, { financeHavale });

    await client.query("COMMIT");

    const counts = await pool.query(`
      SELECT
        (SELECT count(*) FROM users WHERE email LIKE '%@wallet.local') AS fixture_users,
        (SELECT count(*) FROM merchants WHERE api_key LIKE 'tk_%fixture%' OR api_key LIKE 'tk_child%') AS fixture_merchants,
        (SELECT count(*) FROM transactions WHERE public_no LIKE '%-FIXTURE-%') AS fixture_txs,
        (SELECT count(*) FROM chat_threads WHERE public_no LIKE '%-FIXTURE-%') AS fixture_chats
    `);

    log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    log(" Test fixtures seeded (idempotent)");
    log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    log(`  Password (all accounts): ${PASSWORD}`);
    log(`  Sign-in: http://localhost:8080/auth`);
    log(`  Counts: ${JSON.stringify(counts.rows[0])}`);
    log("\n  Merchant HMAC secrets (for smoke / API tests):");
    for (const [key, secrets] of Object.entries(MERCHANT_SECRETS)) {
      log(`    ${key}: signing=${secrets.signing}`);
    }
    log("\n  Merchant BO test accounts (password for all: " + PASSWORD + ")");
    log("  ┌────────────────────────────────────┬──────────┬─────────────────────────────────────────┐");
    log("  │ Email                              │ Role     │ Merchant fixture                        │");
    log("  ├────────────────────────────────────┼──────────┼─────────────────────────────────────────┤");
    log("  │ merchant.owner@wallet.local        │ owner    │ Commerce standalone · spend net ~243.75 │");
    log("  │ merchant.accountant@wallet.local   │ accountant│ Commerce standalone (settings 403)   │");
    log("  │ merchant.readonly@wallet.local     │ read_only│ Commerce standalone (invite 403)      │");
    log("  │ merchant.parent@wallet.local       │ owner    │ Commerce parent + 1 child               │");
    log("  │ merchant.finance@wallet.local      │ owner    │ Finance havale · cash_pool 100000       │");
    log("  └────────────────────────────────────┴──────────┴─────────────────────────────────────────┘");
    log("  Ledger verify: npm run test:seed:verify  (run before smoke-all)");
    log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[test:seed] FAILED:", err.message ?? err);
  process.exit(1);
});
