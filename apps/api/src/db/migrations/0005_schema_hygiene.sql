-- P1 (third sweep) — schema hygiene batch.
--
-- Indexes, constraints, and dead-column drops that should have existed from
-- day 1 but didn't. All statements are idempotent (guarded by IF NOT EXISTS
-- / IF EXISTS) so it's safe to re-run.

-- ============================================================
-- transactions hot-query indexes.
-- These columns are used as JOIN/lookup keys from admin BO + reconciliation
-- queries. Without indexes they sequential-scan a growing table.
-- ============================================================
CREATE INDEX IF NOT EXISTS transactions_reference_id_idx
  ON transactions (reference_id)
  WHERE reference_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_merchant_ref_idx
  ON transactions (merchant_ref)
  WHERE merchant_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_external_tx_id_idx
  ON transactions (external_tx_id)
  WHERE external_tx_id IS NOT NULL;

-- ============================================================
-- merchant_cash_pool_log — drop the duplicate `note` column (kept `notes`).
-- Both were created accidentally; only `notes` is ever written. Dropping
-- the unused one is safe because no service references it.
-- ============================================================
ALTER TABLE merchant_cash_pool_log
  DROP COLUMN IF EXISTS note;

-- ============================================================
-- loyalty_tiers.sort_order uniqueness.
-- Two tiers with the same sort_order produced non-deterministic ordering
-- in `pickTier` queries. The data is admin-managed so any pre-existing
-- duplicates would have been a manual config bug; we surface them with
-- this unique constraint instead of silently mis-ordering.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'loyalty_tiers_sort_order_unique'
  ) THEN
    BEGIN
      CREATE UNIQUE INDEX loyalty_tiers_sort_order_unique
        ON loyalty_tiers (sort_order)
        WHERE is_archived = FALSE;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'loyalty_tiers.sort_order has duplicate values — index NOT created. Resolve in admin BO then re-run.';
    END;
  END IF;
END$$;

-- ============================================================
-- merchant_cashout_sessions.status — enforce the documented enum.
-- The column is `text` today; an upstream bug could write any value.
-- ============================================================
ALTER TABLE merchant_cashout_sessions
  DROP CONSTRAINT IF EXISTS merchant_cashout_sessions_status_chk;
ALTER TABLE merchant_cashout_sessions
  ADD CONSTRAINT merchant_cashout_sessions_status_chk
  CHECK (status IN ('pending', 'sent_to_provider', 'success', 'failed', 'timeout', 'cancelled', 'expired'));

-- ============================================================
-- accounts.current_tier_id ON DELETE policy.
-- The original FK was `NO ACTION` so deleting a loyalty tier failed even
-- when the admin had archived it. Switch to SET NULL so a deleted tier
-- leaves the account un-tiered (the next loyalty operation recomputes it
-- from min_turnover / min_points).
-- ============================================================
ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_current_tier_id_loyalty_tiers_id_fk;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_current_tier_id_loyalty_tiers_id_fk
  FOREIGN KEY (current_tier_id) REFERENCES loyalty_tiers(id) ON DELETE SET NULL;

-- ============================================================
-- merchant_cashout_sessions amount/fee CHECKs (defensive — should always
-- be positive but column had no constraint).
-- ============================================================
ALTER TABLE merchant_cashout_sessions
  DROP CONSTRAINT IF EXISTS merchant_cashout_sessions_amount_pos_chk;
ALTER TABLE merchant_cashout_sessions
  ADD CONSTRAINT merchant_cashout_sessions_amount_pos_chk CHECK (amount > 0);

ALTER TABLE merchant_cashout_sessions
  DROP CONSTRAINT IF EXISTS merchant_cashout_sessions_fee_nonneg_chk;
ALTER TABLE merchant_cashout_sessions
  ADD CONSTRAINT merchant_cashout_sessions_fee_nonneg_chk CHECK (fee >= 0);
