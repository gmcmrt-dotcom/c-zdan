-- L6 — 6 levels × 3 barems (18 loyalty_tiers rows); turnover ×20.
-- Idempotent: safe on empty DB (fresh migrate) and legacy 6-tier installs.

CREATE UNIQUE INDEX IF NOT EXISTS loyalty_tiers_level_sub_unique
  ON loyalty_tiers (level_name, sub_rank)
  WHERE NOT is_archived;

DO $body$
DECLARE
  legacy_count int;
BEGIN
  SELECT count(*)::int INTO legacy_count
  FROM loyalty_tiers
  WHERE NOT is_archived;

  -- Legacy 6-tier seed (all sub_rank = 0) → remap FKs then upsert 18 barems.
  IF legacy_count = 6 AND NOT EXISTS (
    SELECT 1 FROM loyalty_tiers WHERE NOT is_archived AND sub_rank > 0
  ) THEN
    UPDATE accounts a
    SET current_tier_id = CASE lt.level_name
      WHEN 'rookie' THEN 1
      WHEN 'silver' THEN 4
      WHEN 'gold' THEN 7
      WHEN 'platinum' THEN 10
      WHEN 'diamond' THEN 13
      WHEN 'elite' THEN 16
    END
    FROM loyalty_tiers lt
    WHERE a.current_tier_id = lt.id
      AND NOT lt.is_archived;

    UPDATE payment_codes pc
    SET reserved_at_tier_id = CASE lt.level_name
      WHEN 'rookie' THEN 1
      WHEN 'silver' THEN 4
      WHEN 'gold' THEN 7
      WHEN 'platinum' THEN 10
      WHEN 'diamond' THEN 13
      WHEN 'elite' THEN 16
    END
    FROM loyalty_tiers lt
    WHERE pc.reserved_at_tier_id = lt.id
      AND NOT lt.is_archived;
  END IF;

  -- Canonical 18 barems (BUSINESS_DECISIONS.md § L6). Upsert always so re-run is safe.
  INSERT INTO loyalty_tiers (
    id, level_name, display_name, sub_rank, sort_order,
    min_points, min_turnover, commission_discount_pct, point_multiplier, cashback_pct, is_archived
  ) VALUES
    (1,  'rookie',   'Rookie I',    0,  1,      0,       0,          0, 1.00, 0, false),
    (2,  'rookie',   'Rookie II',   1,  2,     50,    1000,          0, 1.02, 0, false),
    (3,  'rookie',   'Rookie III',  2,  3,    150,    3000,          0, 1.05, 0, false),
    (4,  'silver',   'Silver I',    0,  4,    400,   10000,          0, 1.08, 0, false),
    (5,  'silver',   'Silver II',   1,  5,    700,   25000,          0, 1.10, 0, false),
    (6,  'silver',   'Silver III',  2,  6,   1000,   50000,          0, 1.12, 0, false),
    (7,  'gold',     'Gold I',      0,  7,   2500,  100000,          1, 1.18, 0, false),
    (8,  'gold',     'Gold II',     1,  8,   4000,  250000,          1, 1.22, 0, false),
    (9,  'gold',     'Gold III',    2,  9,   5000,  500000,          1, 1.25, 0, false),
    (10, 'platinum', 'Platinum I',  0, 10,  15000,  750000,          2, 1.32, 0, false),
    (11, 'platinum', 'Platinum II', 1, 11,  20000, 1500000,          2, 1.40, 0, false),
    (12, 'platinum', 'Platinum III',2, 12,  25000, 2000000,          2, 1.50, 0, false),
    (13, 'diamond',  'Diamond I',   0, 13,  60000, 4000000,          3, 1.58, 0, false),
    (14, 'diamond',  'Diamond II',  1, 14,  80000, 7000000,          3, 1.66, 0, false),
    (15, 'diamond',  'Diamond III', 2, 15, 100000,10000000,          3, 1.75, 0, false),
    (16, 'elite',    'Elite I',     0, 16, 300000,20000000,          5, 1.85, 0, false),
    (17, 'elite',    'Elite II',    1, 17, 400000,35000000,          5, 1.92, 0, false),
    (18, 'elite',    'Elite III',   2, 18, 500000,50000000,          5, 2.00, 0, false)
  ON CONFLICT (id) DO UPDATE SET
    level_name = EXCLUDED.level_name,
    display_name = EXCLUDED.display_name,
    sub_rank = EXCLUDED.sub_rank,
    sort_order = EXCLUDED.sort_order,
    min_points = EXCLUDED.min_points,
    min_turnover = EXCLUDED.min_turnover,
    commission_discount_pct = EXCLUDED.commission_discount_pct,
    point_multiplier = EXCLUDED.point_multiplier,
    cashback_pct = EXCLUDED.cashback_pct,
    is_archived = EXCLUDED.is_archived;

  -- Drop orphaned legacy rows if any (ids > 18).
  UPDATE loyalty_tiers SET is_archived = true
  WHERE id > 18 AND NOT is_archived;

  PERFORM setval(
    pg_get_serial_sequence('loyalty_tiers', 'id'),
    GREATEST((SELECT MAX(id) FROM loyalty_tiers), 1)
  );
END $body$;
