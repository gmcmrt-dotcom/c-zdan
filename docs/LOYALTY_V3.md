# Loyalty v3 — wallet-circulation model

## Philosophy

Profit is tied to **turnover, not topup**. Topups and withdraws are costs;
only spend (Flow A) generates revenue. The loyalty programme rewards members
who keep balance circulating inside the wallet.

## Tiers

Seeded by `apps/api/src/db/seed.ts` (`LOYALTY_TIERS`) — **18 barems** (6 levels × 3
`sub_rank` steps, L6). Both points **and** turnover are required to level up — point
grinders without real spend cannot climb tiers.

| Level | Barems | Turnover ceiling (₺) | Multiplier range |
|-------|--------|---------------------:|-----------------:|
| Rookie | I–III | 0 → 3,000 | 1.00× – 1.05× |
| Silver | I–III | 10,000 → 50,000 | 1.08× – 1.12× |
| Gold | I–III | 100,000 → 500,000 | 1.18× – 1.25× |
| Platinum | I–III | 750,000 → 2,000,000 | 1.32× – 1.50× |
| Diamond | I–III | 4,000,000 → 10,000,000 | 1.58× – 1.75× |
| Elite | I–III | 20,000,000 → 50,000,000 | 1.85× – 2.00× |

Full threshold table: `docs/BUSINESS_DECISIONS.md` § L6.

Cashback is **off** product-wide; tier rows keep the `cashback_pct` value so a
future on-switch is a settings-flip, not a migration.

## Formulae

```
spend_pts = floor(amount / 10) × turnover_factor × streak_factor × tier_mul × cooldown_factor
  turnover_factor = 1 + log2(min(monthly_spend_count, 32) + 1)   # max ~6×
  streak_factor   = 1 + min(streak_days × 0.05, 0.5)              # max 1.5×
  tier_mul        = tier.point_multiplier                         # 1.0 – 2.0
  cooldown_factor = 0.5 if user_in_cooldown else 1.0

cashback        = 0     # disabled; future cap 1.5%
topup_pts       = 0     # only one-time welcome bonus (Flow C does not earn points)
withdraw_penalty = -floor(amount / 10) × 2   # -2 pts / 10 ₺
```

## Withdrawal cooldown

If a member completes 3 or more withdraws inside 30 days, their multiplier
drops by 50% for the next 30 days. Tracked via `accounts.cooldown_until` and
`user_in_cooldown(user_id)`.

## Onboarding policy (after the 2026-05-18 revision)

Signup collects only **first name + last name + email + email-OTP**. Phone,
date-of-birth and similar attributes are filled in afterwards as profile
completion tasks that grant small one-off point bonuses (no TL).

## Economy guardrail

Average finance cost ≈ 5% on the deposit leg; average commerce revenue ≈ 4%
on the spend leg. A member who deposits ₺100 and immediately spends ₺100 is a
**net ₺1 loss** to the platform. The loyalty programme is therefore tuned to
keep that ₺100 circulating until at least ₺150–₺200 of commerce turnover has
happened before it leaves the wallet.

## Idempotency

`loyalty_points_log` carries a unique index on `(user_id, reason, reference_id)`
where `reference_id IS NOT NULL`. All point awards write through services in
`apps/api/src/services/member.service.ts` and `payment-code.service.ts`.
