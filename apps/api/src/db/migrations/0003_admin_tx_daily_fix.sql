-- P0-36 — admin_tx_daily column type + primary key fix.
--
-- The original schema declared `day timestamp` and `total_amount jsonb` /
-- `total_fee jsonb` (a copy-paste mistake — they should have been `date` and
-- `numeric(14,2)`). It also did NOT declare a primary key on `(day, type)`
-- even though the hourly worker did `ON CONFLICT (day, type) DO UPDATE`. As
-- a result every hourly refresh has been silently failing in catch-and-warn,
-- and dashboard reads built on this table returned empty rows.
--
-- Strategy:
--   1) Wipe any existing junk rows (they were never readable anyway).
--   2) Drop the jsonb columns and re-add them as numeric(14,2).
--   3) Coerce the `day` column to `date`.
--   4) Add the missing PRIMARY KEY.
DELETE FROM admin_tx_daily;

ALTER TABLE admin_tx_daily
  DROP COLUMN IF EXISTS total_amount,
  DROP COLUMN IF EXISTS total_fee;
ALTER TABLE admin_tx_daily
  ADD COLUMN total_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN total_fee    numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE admin_tx_daily
  ALTER COLUMN day TYPE date USING (day::date);

-- Add the (day, type) primary key the hourly worker depends on. Skip if a
-- legacy DB already added an equivalent unique index.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'admin_tx_daily_pkey'
      AND conrelid = 'admin_tx_daily'::regclass
  ) THEN
    ALTER TABLE admin_tx_daily
      ADD CONSTRAINT admin_tx_daily_pkey PRIMARY KEY (day, type);
  END IF;
END$$;
