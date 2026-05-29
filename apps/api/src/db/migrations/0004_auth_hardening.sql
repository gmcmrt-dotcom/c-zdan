-- P1 (auth hardening) — account lockout + TOTP replay protection.
--
-- Adds the three new columns required by the auth service:
--
--   users.failed_login_count        — counts consecutive failed logins per user
--   users.locked_until              — set on lockout; reset on a good login
--   user_mfa_factors.last_used_step — the last 30s TOTP step that verified;
--                                     the verifier rejects any step <= this
--                                     to make a captured code single-use even
--                                     inside its validity window.
--
-- All three columns are nullable / zero-defaulted so the migration is safe
-- to re-run on a populated DB.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;

ALTER TABLE user_mfa_factors
  ADD COLUMN IF NOT EXISTS last_used_step integer;
