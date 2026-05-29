-- K2 — Admin BO loyalty + OTP settings rows (allowlist-backed writes).

INSERT INTO settings (key, value, description) VALUES
  ('otp_length', '6'::jsonb, 'OTP digit count'),
  ('otp_ttl_minutes', '10'::jsonb, 'OTP validity window (minutes)'),
  ('otp_max_attempts', '5'::jsonb, 'Max OTP verification attempts'),
  ('otp_resend_seconds', '60'::jsonb, 'Cooldown before OTP resend (seconds)'),
  ('first_topup_bonus', '50'::jsonb, 'One-time first topup bonus points (legacy)'),
  ('first_topup_bonus_v2', '50'::jsonb, 'One-time first topup bonus points (v2)'),
  ('monthly_active_threshold', '3'::jsonb, 'Min tx count for monthly-active bonus'),
  ('monthly_active_bonus', '25'::jsonb, 'Monthly active user bonus points'),
  ('monthly_active_bonus_v2', '25'::jsonb, 'Monthly active user bonus points (v2)'),
  ('birthday_bonus_points', '100'::jsonb, 'Birthday bonus points'),
  ('profile_complete_bonus', '25'::jsonb, 'Profile completion bonus (phone added)'),
  ('points_per_topup_unit', '100'::jsonb, 'TL per 1 topup point (LOYALTY_V3: topup_pts=0; legacy key)'),
  ('points_per_topup_unit_v2', '100'::jsonb, 'TL per 1 topup point (v2)'),
  ('points_per_spend_unit', '10'::jsonb, 'TL per spend point base unit (floor(amount/unit))'),
  ('points_per_spend_unit_v2', '10'::jsonb, 'TL per spend point base unit (v2)'),
  ('withdraw_penalty_per_unit', '10'::jsonb, 'TL per withdraw penalty unit (floor(amount/unit)×2)'),
  ('turnover_bonus_log_base', '2'::jsonb, 'log2 base for turnover bonus multiplier'),
  ('payment_code_lengths', '[15, 60, 1440]'::jsonb, 'Payment code TTL options (minutes)')
ON CONFLICT (key) DO NOTHING;
