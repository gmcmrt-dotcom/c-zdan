-- P0-16, P0-19, P0-41, P0-42 — production hardening migration.
--
-- Run via `npm run db:migrate`. Idempotent: every statement is guarded by
-- IF NOT EXISTS / IF EXISTS so re-running on a partially-migrated DB is safe.

-- ============================================================
-- P0-16 — One open withdraw session per user (mirror topup partial unique).
-- ============================================================
-- Run a cleanup first: if any duplicate `pending` / `sent_to_merchant` rows
-- exist for the same user, mark the older ones as 'cancelled' so the unique
-- index can be created. In practice this should affect zero rows on a
-- healthy production DB but is the safe sequence.
WITH dups AS (
  SELECT id,
         row_number() OVER (PARTITION BY user_id
                            ORDER BY created_at DESC) AS rn
  FROM withdraw_sessions
  WHERE status IN ('pending', 'sent_to_merchant')
)
UPDATE withdraw_sessions
SET status = 'cancelled',
    finalized_at = now(),
    updated_at = now(),
    failure_reason = 'P0-16 dedupe: superseded by newer open session'
WHERE id IN (SELECT id FROM dups WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS withdraw_sessions_one_open_per_user_unique
  ON withdraw_sessions (user_id)
  WHERE status IN ('pending', 'sent_to_merchant');

-- ============================================================
-- P0-19 — CASCADE → RESTRICT on the immutable financial ledger.
--
-- Deleting a user or merchant must NOT delete their transactions or
-- settlement history. Switch the FK behaviour and add a soft-delete column
-- on the parent tables; admin "delete" workflows should now flip
-- `deleted_at` instead of removing the row.
-- ============================================================

-- transactions.user_id → users.id
ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_user_id_users_id_fk;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_user_id_users_id_fk
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

-- merchant_settlement_log.merchant_id → merchants.id
ALTER TABLE merchant_settlement_log
  DROP CONSTRAINT IF EXISTS merchant_settlement_log_merchant_id_merchants_id_fk;
ALTER TABLE merchant_settlement_log
  ADD CONSTRAINT merchant_settlement_log_merchant_id_merchants_id_fk
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT;

-- merchant_cash_pool_log.merchant_id → merchants.id
ALTER TABLE merchant_cash_pool_log
  DROP CONSTRAINT IF EXISTS merchant_cash_pool_log_merchant_id_merchants_id_fk;
ALTER TABLE merchant_cash_pool_log
  ADD CONSTRAINT merchant_cash_pool_log_merchant_id_merchants_id_fk
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT;

-- Soft-delete columns. The application must filter `deleted_at IS NULL` in
-- every member/merchant lookup; the FK constraint above is a defence-in-depth.
ALTER TABLE users      ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE merchants  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE profiles   ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS users_active_idx
  ON users (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS merchants_active_idx
  ON merchants (id) WHERE deleted_at IS NULL;

-- ============================================================
-- P0-41 — Affiliate link unique constraint (latent; safe today because the
-- affiliate flag is OFF). Prevents double commission accrual when commission
-- service ships.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS merchant_affiliate_links_active_unique
  ON merchant_affiliate_links (affiliate_id, merchant_id)
  WHERE status = 'active';

-- ============================================================
-- P0-42 — Routing weight invariants. Reject weights outside 0..100.
-- The sum=100 invariant per (method_type, direction) is enforced in the
-- service layer; a CHECK constraint can't see sibling rows.
-- ============================================================
ALTER TABLE payment_routing_rules
  DROP CONSTRAINT IF EXISTS payment_routing_rules_weight_pct_chk;
ALTER TABLE payment_routing_rules
  ADD CONSTRAINT payment_routing_rules_weight_pct_chk
  CHECK (weight_pct IS NULL OR (weight_pct >= 0 AND weight_pct <= 100));

-- ============================================================
-- P1 (third sweep) — money column CHECKs that should have existed from day 1.
-- ============================================================
ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_amount_nonneg_chk;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_amount_nonneg_chk CHECK (amount >= 0);

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_fee_nonneg_chk;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_fee_nonneg_chk CHECK (fee >= 0);

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_reserved_lte_balance_chk;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_reserved_lte_balance_chk
  CHECK (reserved_balance <= balance);

ALTER TABLE merchants
  DROP CONSTRAINT IF EXISTS merchants_credit_limit_nonneg_chk;
ALTER TABLE merchants
  ADD CONSTRAINT merchants_credit_limit_nonneg_chk CHECK (credit_limit >= 0);

ALTER TABLE merchants
  DROP CONSTRAINT IF EXISTS merchants_cashout_reserved_nonneg_chk;
ALTER TABLE merchants
  ADD CONSTRAINT merchants_cashout_reserved_nonneg_chk
  CHECK (cashout_reserved_amount IS NULL OR cashout_reserved_amount >= 0);

-- ============================================================
-- P0-12 — Encrypt signing_secret at rest.
--
-- Step 1 (this migration): add the encrypted column + a rotation history
--   table. Application code now writes `signing_secret_encrypted` on every
--   create / rotate AND continues to read either column for compat.
-- Step 2 (next migration after backfill): UPDATE merchants
--     SET signing_secret_encrypted = encrypt(signing_secret)
--     WHERE signing_secret_encrypted IS NULL AND signing_secret IS NOT NULL;
--   (run from a script that has access to lib/crypto.ts; SQL alone cannot
--    encrypt without the MFA_ENCRYPTION_KEY.)
-- Step 3 (final migration): drop the plaintext column once backfill is
--   verified across all environments.
-- ============================================================
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS signing_secret_encrypted text;

CREATE TABLE IF NOT EXISTS merchant_secret_rotations (
  id bigserial PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  rotated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS merchant_secret_rotations_merchant_idx
  ON merchant_secret_rotations (merchant_id, created_at DESC);
