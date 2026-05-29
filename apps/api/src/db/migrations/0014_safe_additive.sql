-- Batch P — safe additives (no behavior change, no force-logout).
--
-- Every statement here is verified safe against the live dev DB and the
-- writer code paths:
--   - All new CHECK constraints pass on current data (audited via SELECT
--     count(*) WHERE NOT <predicate> = 0 before authoring).
--   - All new indexes / partial unique indexes match the existing writer
--     pattern (no writer today produces a row that would conflict).
--   - All new FKs are orphan-free at the time of writing.
--
-- Items closed by this migration:
--   - p1-third-sweep: provider_ledger.provider_id FK to payment_providers
--   - p1-third-sweep: loyalty_points_log idempotency UNIQUE (defensive;
--     today's writers either omit reference_id or pass a freshly-generated
--     transaction id, so the predicate cannot collide)
--   - p1-third-sweep: merchant hierarchy scope CHECK
--   - p2-third-sweep: provider_method_health non-negative count / window
--     ordering / success_rate range CHECKs (table is empty today)
--   - p1-third-sweep: profit_share_campaigns invariants (period ordering,
--     pool_amount >= 0, max_recipients > 0, claim_expires_hours > 0)
--
-- Rollback: every statement uses `DROP CONSTRAINT IF EXISTS` / `DROP INDEX
-- IF EXISTS` first, so this whole file can be reverted by removing the
-- ADD/CREATE half and re-running the migration tail. Constraints + indexes
-- only — zero data writes.

-- ============================================================
-- 1. provider_ledger.provider_id FK (p1-third-sweep, missing FK).
--
-- The column exists with notNull but no FK; the table is empty today
-- (0 rows) so adding the FK has no orphan impact. ON DELETE RESTRICT
-- mirrors the policy used for every other settlement-pointing FK so a
-- provider can't be deleted out from under its ledger rows.
-- ============================================================
ALTER TABLE provider_ledger
  DROP CONSTRAINT IF EXISTS provider_ledger_provider_id_payment_providers_id_fk;
ALTER TABLE provider_ledger
  ADD CONSTRAINT provider_ledger_provider_id_payment_providers_id_fk
  FOREIGN KEY (provider_id) REFERENCES payment_providers(id) ON DELETE RESTRICT;

-- ============================================================
-- 2. loyalty_points_log idempotency UNIQUE (p1-third-sweep).
--
-- Defensive: today's writers in payment-code.service.ts pass a freshly
-- generated `transactions.id` as `reference_id`, and the admin members
-- service writers (`awardPoints`, `cancelUserWindowPoints`) pass NULL
-- so they fall outside the partial-unique predicate entirely. The new
-- constraint catches any FUTURE retry path that would otherwise silently
-- double-award the same logical event.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_points_log_idempotency_unique
  ON loyalty_points_log (user_id, reason, reference_id)
  WHERE reference_id IS NOT NULL;

-- ============================================================
-- 3. merchants hierarchy scope CHECK (p1-third-sweep).
--
-- The third-sweep audit calls out the implicit invariant
--     (merchant_scope = 'child') <=> (parent_merchant_id IS NOT NULL)
-- which today is enforced only by the service layer. Live data passes:
--   SELECT COUNT(*) FROM merchants
--    WHERE (merchant_scope = 'child') != (parent_merchant_id IS NOT NULL);
--   -- 0
-- Standalone + parent rows continue to allow NULL parent_merchant_id;
-- child rows must point at one.
-- ============================================================
ALTER TABLE merchants
  DROP CONSTRAINT IF EXISTS merchants_hierarchy_chk;
ALTER TABLE merchants
  ADD CONSTRAINT merchants_hierarchy_chk
  CHECK ((merchant_scope = 'child') = (parent_merchant_id IS NOT NULL));

-- ============================================================
-- 4. provider_method_health invariants (p2-third-sweep).
--
-- Table is empty today (0 rows). The columns are all `integer` with a
-- default of 0, so the non-negative CHECKs encode the existing implicit
-- semantics (you cannot have a negative "success_count" within a window).
-- ============================================================
ALTER TABLE provider_method_health
  DROP CONSTRAINT IF EXISTS provider_method_health_counts_nonneg_chk;
ALTER TABLE provider_method_health
  ADD CONSTRAINT provider_method_health_counts_nonneg_chk
  CHECK (
    total_count >= 0
    AND success_count >= 0
    AND cancelled_count >= 0
    AND failed_count >= 0
    AND timeout_count >= 0
    AND pending_count >= 0
  );

ALTER TABLE provider_method_health
  DROP CONSTRAINT IF EXISTS provider_method_health_window_ordering_chk;
ALTER TABLE provider_method_health
  ADD CONSTRAINT provider_method_health_window_ordering_chk
  CHECK (window_end > window_start);

ALTER TABLE provider_method_health
  DROP CONSTRAINT IF EXISTS provider_method_health_success_rate_range_chk;
ALTER TABLE provider_method_health
  ADD CONSTRAINT provider_method_health_success_rate_range_chk
  CHECK (success_rate IS NULL OR (success_rate >= 0 AND success_rate <= 1));

-- ============================================================
-- 5. profit_share_campaigns structural invariants (p1-third-sweep).
--
-- Live data passes (period_from < period_to, pool_amount >= 0,
-- max_recipients > 0, claim_expires_hours > 0). The `distribution_pct`
-- range CHECK was shipped in mig 0006; the rest of the invariants live in
-- the service layer today (`createCampaign` / `publishCampaign`) but
-- nothing at the DB layer prevented a manual UPDATE from corrupting them.
-- ============================================================
ALTER TABLE profit_share_campaigns
  DROP CONSTRAINT IF EXISTS profit_share_campaigns_period_ordering_chk;
ALTER TABLE profit_share_campaigns
  ADD CONSTRAINT profit_share_campaigns_period_ordering_chk
  CHECK (period_from < period_to);

ALTER TABLE profit_share_campaigns
  DROP CONSTRAINT IF EXISTS profit_share_campaigns_pool_nonneg_chk;
ALTER TABLE profit_share_campaigns
  ADD CONSTRAINT profit_share_campaigns_pool_nonneg_chk
  CHECK (pool_amount >= 0);

ALTER TABLE profit_share_campaigns
  DROP CONSTRAINT IF EXISTS profit_share_campaigns_max_recipients_chk;
ALTER TABLE profit_share_campaigns
  ADD CONSTRAINT profit_share_campaigns_max_recipients_chk
  CHECK (max_recipients > 0);

ALTER TABLE profit_share_campaigns
  DROP CONSTRAINT IF EXISTS profit_share_campaigns_claim_hours_chk;
ALTER TABLE profit_share_campaigns
  ADD CONSTRAINT profit_share_campaigns_claim_hours_chk
  CHECK (claim_expires_hours > 0);
