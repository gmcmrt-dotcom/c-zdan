-- K3 — MFA backup codes (Q11). One-time codes a user can use INSTEAD OF
-- a TOTP code at the MFA challenge step. Generated at enroll-verify time
-- (8 codes, shown to the user ONCE), stored only as sha256 hashes,
-- consumed by setting `consumed_at`. Regeneration drops all unused codes
-- and issues a fresh set.

CREATE TABLE IF NOT EXISTS user_mfa_backup_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   text NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_mfa_backup_codes_user_idx
  ON user_mfa_backup_codes (user_id) WHERE consumed_at IS NULL;

-- One sha256 hash per user — a code that lands on the same hash for a
-- different user is astronomically unlikely but the constraint is cheap.
CREATE UNIQUE INDEX IF NOT EXISTS user_mfa_backup_codes_user_hash_unique
  ON user_mfa_backup_codes (user_id, code_hash);
