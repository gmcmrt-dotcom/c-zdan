-- Batch Q — safe additives.
--
-- Same SAFE filter as Batch P: no API contract change, no behavior change
-- for legitimate callers, no force-logout, reversible.
--
-- Items closed by this migration:
--   - Q2 / p2-hardening: external_tx_id uniqueness — partial UNIQUE index
--     so a duplicate provider tx id (cross-merchant retry collision, etc.)
--     surfaces as a write error instead of silently double-recording.
--     NULL stays unconstrained (existing flow inserts NULL when there's no
--     external reference — partial predicate keeps it out of the index).
--
-- Pre-flight audit (run against live dev DB before authoring):
--   SELECT external_tx_id, count(*)
--   FROM transactions
--   WHERE external_tx_id IS NOT NULL
--   GROUP BY 1 HAVING count(*) > 1;
--   -- 0 rows
--
-- Rollback: DROP INDEX IF EXISTS transactions_external_tx_id_unique;

-- ============================================================
-- 1. transactions.external_tx_id partial UNIQUE index (Q2).
--
-- Constrains non-null external_tx_id values to be globally unique across
-- the transactions table. NULL values stay unconstrained — that's the
-- existing state for flows that don't have a 3rd-party reference (Flow A
-- spend, Flow B merchant_credit without external_tx_id, profit-share,
-- bonuses, referrals, adjustments — all leave the column NULL).
--
-- The companion non-unique index `transactions_external_tx_id_idx` was
-- shipped in mig 0005 (p1-third-sweep). The new unique index here ALSO
-- serves as a search index, but we keep the existing non-unique one so
-- a future relaxation of the unique predicate doesn't lose the search
-- path. (Postgres can use either, so this is a small redundancy cost in
-- exchange for safe rollback.)
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS transactions_external_tx_id_unique
  ON transactions (external_tx_id)
  WHERE external_tx_id IS NOT NULL;
