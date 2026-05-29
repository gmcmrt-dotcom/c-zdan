-- PS1 — carry-forward overhead: snapshot per campaign + cumulative settings key.

ALTER TABLE profit_share_campaigns
  ADD COLUMN IF NOT EXISTS carried_overhead numeric(14, 2) NOT NULL DEFAULT '0';

INSERT INTO settings (key, value, description)
VALUES (
  'profit_share_cumulative_overhead',
  '0'::jsonb,
  'PS1 carry-forward: cumulative pool_amount from published profit-share campaigns'
)
ON CONFLICT (key) DO NOTHING;
