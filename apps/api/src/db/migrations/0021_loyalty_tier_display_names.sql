-- L6 barem display names: Roman I/II/III → Plus / Pro / Prime (idempotent).

UPDATE loyalty_tiers SET display_name = CASE id
  WHEN 1  THEN 'Rookie Plus'
  WHEN 2  THEN 'Rookie Pro'
  WHEN 3  THEN 'Rookie Prime'
  WHEN 4  THEN 'Silver Plus'
  WHEN 5  THEN 'Silver Pro'
  WHEN 6  THEN 'Silver Prime'
  WHEN 7  THEN 'Gold Plus'
  WHEN 8  THEN 'Gold Pro'
  WHEN 9  THEN 'Gold Prime'
  WHEN 10 THEN 'Platinum Plus'
  WHEN 11 THEN 'Platinum Pro'
  WHEN 12 THEN 'Platinum Prime'
  WHEN 13 THEN 'Diamond Plus'
  WHEN 14 THEN 'Diamond Pro'
  WHEN 15 THEN 'Diamond Prime'
  WHEN 16 THEN 'Elite Plus'
  WHEN 17 THEN 'Elite Pro'
  WHEN 18 THEN 'Elite Prime'
  ELSE display_name
END
WHERE NOT is_archived AND id BETWEEN 1 AND 18;
