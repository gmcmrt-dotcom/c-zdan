-- PS6 — campaign close audit fields (who/when closed).

ALTER TABLE profit_share_campaigns
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;
