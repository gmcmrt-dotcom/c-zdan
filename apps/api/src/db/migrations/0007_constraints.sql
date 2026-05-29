-- I2 — Status CHECKs, additional FKs, settlement/cash_pool log invariant.
--
-- All statements idempotent. Adds the documented enum CHECKs that the
-- third-sweep audit flagged, plus a couple of missing FK pointers and a
-- log-invariant CHECK that prevents drift between
-- (balance_before, change_amount, balance_after) on the two financial
-- log tables.

-- ============================================================
-- 1. event_outbox.status CHECK — column was free text; only these values
--    are written by the dispatcher today.
-- ============================================================
ALTER TABLE event_outbox
  DROP CONSTRAINT IF EXISTS event_outbox_status_chk;
ALTER TABLE event_outbox
  ADD CONSTRAINT event_outbox_status_chk
  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped'));

-- ============================================================
-- 2. job_runs.status CHECK (allowed enum values mirror what the scheduler
--    actually writes; verified against the live data in I2 ship-now).
-- ============================================================
ALTER TABLE job_runs
  DROP CONSTRAINT IF EXISTS job_runs_status_chk;
ALTER TABLE job_runs
  ADD CONSTRAINT job_runs_status_chk
  CHECK (status IN ('running', 'ok', 'success', 'error', 'skipped', 'error_stale'));

-- ============================================================
-- 3. chat_messages.canned_response_id FK (silent dangling refs today).
--    Real table name is `chat_canned_responses` (verified against the
--    live schema in I2 ship-now).
-- ============================================================
ALTER TABLE chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_canned_response_id_fk;
ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_canned_response_id_fk
  FOREIGN KEY (canned_response_id) REFERENCES chat_canned_responses(id)
  ON DELETE SET NULL;

-- ============================================================
-- 4. transactions provider_method_id + merchant_method_id ON DELETE policy.
--    Original FKs were `no action` so deleting a method blocked even if no
--    txns referenced it. SET NULL keeps history intact while letting admin
--    archive a method.
-- ============================================================
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_provider_method_id_payment_methods_id_fk'
  ) THEN
    ALTER TABLE transactions
      DROP CONSTRAINT transactions_provider_method_id_payment_methods_id_fk;
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_provider_method_id_payment_methods_id_fk
      FOREIGN KEY (provider_method_id) REFERENCES payment_methods(id) ON DELETE SET NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_merchant_method_id_merchant_methods_id_fk'
  ) THEN
    ALTER TABLE transactions
      DROP CONSTRAINT transactions_merchant_method_id_merchant_methods_id_fk;
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_merchant_method_id_merchant_methods_id_fk
      FOREIGN KEY (merchant_method_id) REFERENCES merchant_methods(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- 5. Settlement / cash_pool log invariant.
--    `balance_before + change_amount = balance_after`. Without this CHECK,
--    a buggy service write can leave the log internally inconsistent and
--    finance reconciliation has to hand-verify every row.
-- ============================================================
ALTER TABLE merchant_settlement_log
  DROP CONSTRAINT IF EXISTS merchant_settlement_log_balance_invariant_chk;
ALTER TABLE merchant_settlement_log
  ADD CONSTRAINT merchant_settlement_log_balance_invariant_chk
  CHECK (balance_before + change_amount = balance_after);

ALTER TABLE merchant_cash_pool_log
  DROP CONSTRAINT IF EXISTS merchant_cash_pool_log_balance_invariant_chk;
ALTER TABLE merchant_cash_pool_log
  ADD CONSTRAINT merchant_cash_pool_log_balance_invariant_chk
  CHECK (balance_before + change_amount = balance_after);

-- ============================================================
-- 6. user_login_ips dedup pre-index for the H3-style cron + I3 client-side
--    skip — speeds up the "did this (user, ip, ua) log in within the last
--    N minutes?" lookup.
-- ============================================================
CREATE INDEX IF NOT EXISTS user_login_ips_user_recent_idx
  ON user_login_ips (user_id, created_at DESC);
