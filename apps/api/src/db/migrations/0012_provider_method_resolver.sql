-- L1 — Provider-method resolver map (Q4 Option B).
--
-- `provider_ledger.provider_method_id` is `NOT NULL` with FK to
-- `payment_methods`. The C/D money flows finalize on a merchant whose
-- `integration_adapter` is a free-text string (e.g. "aninda_v1"), NOT a
-- payment_method link, so we have no clean source for that column today.
--
-- This map table resolves `(merchant_id, tx_type)` to the `payment_method`
-- id that should be written to `provider_ledger`. The admin BO will
-- populate it when a merchant is onboarded (or when payment_methods are
-- introduced). A NULL lookup falls back to "skip the provider_ledger
-- write" (logged at warn) so the money flow never breaks on a missing
-- mapping — finance reconciliation degrades gracefully to the
-- merchant_cash_pool_log + merchant_settlement_log path.

CREATE TABLE IF NOT EXISTS merchant_provider_method_map (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id         uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  tx_type             text NOT NULL,         -- 'topup' | 'withdraw' | etc.
  provider_method_id  uuid NOT NULL REFERENCES payment_methods(id) ON DELETE RESTRICT,
  is_active           boolean NOT NULL DEFAULT true,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (tx_type IN ('topup', 'withdraw', 'merchant_credit', 'spend'))
);

CREATE UNIQUE INDEX IF NOT EXISTS merchant_provider_method_map_unique
  ON merchant_provider_method_map (merchant_id, tx_type)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS merchant_provider_method_map_lookup
  ON merchant_provider_method_map (merchant_id, tx_type, is_active);
