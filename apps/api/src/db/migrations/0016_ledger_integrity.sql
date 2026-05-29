-- Ledger integrity cross-check runs (automated + manual mutabakat).
-- Append-only; findings stored as JSON for admin BO review.

CREATE TABLE IF NOT EXISTS ledger_integrity_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_by text NOT NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  ok boolean NOT NULL DEFAULT false,
  check_count int NOT NULL DEFAULT 0,
  finding_count int NOT NULL DEFAULT 0,
  error_count int NOT NULL DEFAULT 0,
  warning_count int NOT NULL DEFAULT 0,
  critical_count int NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  duration_ms int,
  error text
);

CREATE INDEX IF NOT EXISTS ledger_integrity_runs_started_idx
  ON ledger_integrity_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS ledger_integrity_runs_status_idx
  ON ledger_integrity_runs (status, started_at DESC);

-- BO permission for manual trigger (view reuses reconciliation:view).
INSERT INTO bo_permissions (role, resource, action)
VALUES
  ('admin', 'ledger_integrity', 'run'),
  ('accounting', 'ledger_integrity', 'run')
ON CONFLICT (role, resource, action) DO NOTHING;
