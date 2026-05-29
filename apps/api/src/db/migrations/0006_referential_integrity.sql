-- H2 — Referential integrity + indexes + percent CHECKs.
--
-- 1. Add missing FKs that should have existed from day 1 (orphan-audited
--    against the live DB before the migration; zero affected rows).
-- 2. Add `expires_at` indexes for the upcoming token-purge cron (H3).
-- 3. Add hot-path query indexes flagged in the third-sweep audit.
-- 4. Add percent-range CHECK constraints across rates / multipliers /
--    distributions so an admin BO write can never exceed the 0..100 band
--    that downstream math assumes.
--
-- All statements are idempotent.

-- ============================================================
-- 1. Missing FKs (NOT VALID first — the columns are populated and the
--    orphan audit returned zero rows, so we add CONSTRAINT directly).
-- ============================================================
ALTER TABLE withdraw_requests
  DROP CONSTRAINT IF EXISTS withdraw_requests_user_id_users_id_fk;
ALTER TABLE withdraw_requests
  ADD CONSTRAINT withdraw_requests_user_id_users_id_fk
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE topup_requests
  DROP CONSTRAINT IF EXISTS topup_requests_provider_id_payment_providers_id_fk;
ALTER TABLE topup_requests
  ADD CONSTRAINT topup_requests_provider_id_payment_providers_id_fk
  FOREIGN KEY (provider_id) REFERENCES payment_providers(id) ON DELETE RESTRICT;

ALTER TABLE payment_codes
  DROP CONSTRAINT IF EXISTS payment_codes_consumed_by_merchant_merchants_id_fk;
ALTER TABLE payment_codes
  ADD CONSTRAINT payment_codes_consumed_by_merchant_merchants_id_fk
  FOREIGN KEY (consumed_by_merchant) REFERENCES merchants(id) ON DELETE SET NULL;

ALTER TABLE profile_change_otps
  DROP CONSTRAINT IF EXISTS profile_change_otps_user_id_users_id_fk;
ALTER TABLE profile_change_otps
  ADD CONSTRAINT profile_change_otps_user_id_users_id_fk
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ============================================================
-- 2. expires_at indexes — needed by the H3 token-purge cron.
-- ============================================================
CREATE INDEX IF NOT EXISTS refresh_tokens_expires_at_idx
  ON refresh_tokens (expires_at);

CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_at_idx
  ON password_reset_tokens (expires_at);

CREATE INDEX IF NOT EXISTS email_verification_tokens_expires_at_idx
  ON email_verification_tokens (expires_at);

-- ============================================================
-- 3. Hot-path indexes (third-sweep audit).
-- ============================================================
CREATE INDEX IF NOT EXISTS merchant_settlement_log_merchant_created_idx
  ON merchant_settlement_log (merchant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS merchant_api_calls_merchant_ref_idx
  ON merchant_api_calls (merchant_ref)
  WHERE merchant_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS profit_share_allocations_expires_pending_idx
  ON profit_share_allocations (expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS event_outbox_sent_at_idx
  ON event_outbox (sent_at)
  WHERE sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS merchants_finance_cash_pool_freshness_idx
  ON merchants (cash_pool_updated_at)
  WHERE merchant_type = 'finance';

-- ============================================================
-- 4. Percent-range CHECKs (0..100).
--    Downstream math (fees, multipliers, distribution) assumes the
--    column sits in this band; nothing checks it at the column today.
-- ============================================================
ALTER TABLE merchants
  DROP CONSTRAINT IF EXISTS merchants_commission_pct_range_chk;
ALTER TABLE merchants
  ADD CONSTRAINT merchants_commission_pct_range_chk
  CHECK (commission_pct IS NULL OR (commission_pct >= 0 AND commission_pct <= 100));

ALTER TABLE merchants
  DROP CONSTRAINT IF EXISTS merchants_failure_rate_pct_range_chk;
ALTER TABLE merchants
  ADD CONSTRAINT merchants_failure_rate_pct_range_chk
  CHECK (failure_rate_pct IS NULL OR (failure_rate_pct >= 0 AND failure_rate_pct <= 100));

ALTER TABLE merchants
  DROP CONSTRAINT IF EXISTS merchants_deposit_commission_pct_range_chk;
ALTER TABLE merchants
  ADD CONSTRAINT merchants_deposit_commission_pct_range_chk
  CHECK (deposit_commission_pct IS NULL OR (deposit_commission_pct >= 0 AND deposit_commission_pct <= 100));

ALTER TABLE merchants
  DROP CONSTRAINT IF EXISTS merchants_withdraw_commission_pct_range_chk;
ALTER TABLE merchants
  ADD CONSTRAINT merchants_withdraw_commission_pct_range_chk
  CHECK (withdraw_commission_pct IS NULL OR (withdraw_commission_pct >= 0 AND withdraw_commission_pct <= 100));

ALTER TABLE loyalty_tiers
  DROP CONSTRAINT IF EXISTS loyalty_tiers_commission_discount_pct_range_chk;
ALTER TABLE loyalty_tiers
  ADD CONSTRAINT loyalty_tiers_commission_discount_pct_range_chk
  CHECK (commission_discount_pct IS NULL OR (commission_discount_pct >= 0 AND commission_discount_pct <= 100));

ALTER TABLE loyalty_tiers
  DROP CONSTRAINT IF EXISTS loyalty_tiers_cashback_pct_range_chk;
ALTER TABLE loyalty_tiers
  ADD CONSTRAINT loyalty_tiers_cashback_pct_range_chk
  CHECK (cashback_pct IS NULL OR (cashback_pct >= 0 AND cashback_pct <= 100));

ALTER TABLE profit_share_campaigns
  DROP CONSTRAINT IF EXISTS profit_share_campaigns_distribution_pct_range_chk;
ALTER TABLE profit_share_campaigns
  ADD CONSTRAINT profit_share_campaigns_distribution_pct_range_chk
  CHECK (distribution_pct IS NULL OR (distribution_pct >= 0 AND distribution_pct <= 100));

-- ============================================================
-- 5. event_outbox.updated_at — needed by the H3 stalled-sending sweeper.
--    Without it we can't tell when a row was last touched, so a worker
--    crash can leave rows in `sending` forever.
-- ============================================================
ALTER TABLE event_outbox
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ============================================================
-- 6. H4 — Admin idempotency dedup table.
--    Admin BO mutations (adjustBalance / recordManualSettlement /
--    adjustCashPool / setCashPool) accept an optional `idempotency_key`.
--    The service inserts (actor_id, action, key) here BEFORE doing the
--    money write — if the unique index trips, the second submission
--    returns the prior result instead of re-applying. Closes the
--    admin-double-click double-debit window.
--
--    TTL is 7 days; a daily cron (added later) sweeps expired rows.
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_idempotency (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      text NOT NULL,
  key         text NOT NULL,
  result      jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_idempotency_actor_action_key_unique
  ON admin_idempotency (actor_id, action, key);

CREATE INDEX IF NOT EXISTS admin_idempotency_expires_at_idx
  ON admin_idempotency (expires_at);
