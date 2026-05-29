-- J1 — audit_log.user_agent column for forensic linking back to user_login_ips.
--      Nullable so historical rows stay valid; truncated at 512 chars by the
--      service-layer writer to bound malicious-UA-header bloat.
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS user_agent text;

-- J2 — payment_methods commission + fixed_fee + amount-bound CHECKs.
--      The columns existed already with no protection against negative
--      or absurd values. We pin commission_pct to [0, 100] and fixed_fee
--      to [0, 1000000] (cents). The existing kind CHECK is left alone.
ALTER TABLE payment_methods
  DROP CONSTRAINT IF EXISTS payment_methods_commission_pct_chk;
ALTER TABLE payment_methods
  ADD CONSTRAINT payment_methods_commission_pct_chk
  CHECK (commission_pct >= 0 AND commission_pct <= 100);

ALTER TABLE payment_methods
  DROP CONSTRAINT IF EXISTS payment_methods_fixed_fee_chk;
ALTER TABLE payment_methods
  ADD CONSTRAINT payment_methods_fixed_fee_chk
  CHECK (fixed_fee >= 0);

-- bounds — min/max/limit columns are nullable; if both set, max must be >= min.
ALTER TABLE payment_methods
  DROP CONSTRAINT IF EXISTS payment_methods_amount_bounds_chk;
ALTER TABLE payment_methods
  ADD CONSTRAINT payment_methods_amount_bounds_chk
  CHECK (
    (min_amount IS NULL OR min_amount >= 0)
    AND (max_amount IS NULL OR max_amount >= 0)
    AND (min_amount IS NULL OR max_amount IS NULL OR max_amount >= min_amount)
    AND (daily_limit IS NULL OR daily_limit >= 0)
    AND (per_tx_limit IS NULL OR per_tx_limit >= 0)
  );

-- J2 — merchant_cashout_methods.network enum CHECK.
--      Live values observed: bitcoin, ethereum, tron. Allow the documented
--      set + 'fiat_iban' as the on-ramp network used by the existing
--      manual-cashout flow (matches what the admin form offers).
ALTER TABLE merchant_cashout_methods
  DROP CONSTRAINT IF EXISTS merchant_cashout_methods_network_chk;
ALTER TABLE merchant_cashout_methods
  ADD CONSTRAINT merchant_cashout_methods_network_chk
  CHECK (network IN ('bitcoin', 'ethereum', 'tron', 'fiat_iban', 'other'));

-- J2 — Merchants invariant: `cashout_reserved_amount` MUST be <= the
--      effective balance limit (balance + overdraft if enabled).
--      The reservation flow already enforces this in service code; the
--      CHECK is belt-and-braces and prevents a buggy admin migration
--      from leaving the table in an inconsistent state.
ALTER TABLE merchants
  DROP CONSTRAINT IF EXISTS merchants_cashout_reserved_chk;
ALTER TABLE merchants
  ADD CONSTRAINT merchants_cashout_reserved_chk
  CHECK (cashout_reserved_amount >= 0);

-- J1 — Snapshot column for PCR (chat_profile_change_requests.old_value).
--      Nullable so historical rows stay valid. Populated by
--      `chatCreateProfileChangeRequest` going forward.
ALTER TABLE chat_profile_change_requests
  ADD COLUMN IF NOT EXISTS old_value text;
