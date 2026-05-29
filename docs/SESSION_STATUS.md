# Session state (LIVE)

> **Update rule:** When a task ships, strike it from this file. When a new task
> is opened, add it here. Do not write release notes here — code history lives
> in git. Full audit roadmap (with per-finding citations) lives in
> `.cursor/plans/wallet_production_go-live_audit_591d4884.plan.md`.

**Last updated:** 2026-05-29 (login API crash fix — K5 shared DTO)

## Login "Beklenmeyen bir hata" ✅ (2026-05-29)

**Kök neden:** K5 `admin.ts` DTO'ları `MoneyAmount`'ı `../index`'ten import ediyordu → döngüsel bağımlılık → API açılışta `ReferenceError: Cannot access 'MoneyAmount' before initialization` ile çöküyordu. Web (`:8080`) ayaktayken API (`:3000`) kapalı → Vite proxy `Failed to fetch` → FE `translateError` fallback: "Beklenmeyen bir hata oluştu".

**Fix:** `MoneyAmount` → `packages/shared/src/dto/common.ts`; `admin.ts` import `./common`. `npm run typecheck` ✅ · curl login 200.

**Kullanıcı:** Her iki dev sunucusu çalışsın — `npm run dev` (veya API `:3000` + web `:8080` ayrı). Admin: `admin@wallet.local` / `Admin1234` → MFA challenge beklenir (`requiresMfa=true`).

## Loyalty tier görüntüleme ✅ (2026-05-29)

- **Sıra:** `genericReadHandler` — `order.asc` yoksa `defaultOrder.asc` (loyalty: `sort_order` artan); üye/admin tier listeleri `asc: true` açık.
- **İsimler:** Roman I/II/III → **Plus / Pro / Prime** (`seed.ts`, migration `0021_loyalty_tier_display_names.sql`).

## Deploy "+" otomasyonu ✅ (2026-05-29)

Tek komutla **GitHub + production** deploy altyapısı:

| Dosya | Amaç |
|-------|------|
| `scripts/deploy-plus.mjs` | Deploy script — otomatik commit+push + sunucu |
| `deploy.config.example.json` | Yapılandırma şablonu (`gitRemote`/`gitBranch`) |
| `docs/DEPLOY_PLUS.md` | Tam rehber (Türkçe) |
| `.cursor/rules/deploy-plus.mdc` | Agent `+` davranışı |

**Kullanım:** `cp deploy.config.example.json deploy.config.json` → sunucu bilgilerini doldur → sohbette `+` veya `npm run deploy`.

**Bayraklar:** `--message`, `--no-push` (yalnızca sunucu), `--dry-run` (önizleme).

**Not:** Gerçek sunucuya deploy yapılmadı — config olmadan script Türkçe talimat verip durur.

## Hemen (bugün) — dev stabil baseline ✅ (2026-05-29)

Sıralı doğrulama tamamlandı:

| Adım | Sonuç | Kanıt |
|------|-------|-------|
| `npm run db:reset` | ✅ | `admin@wallet.local` bootstrap OK (`userId` + `role=admin`) |
| `npm run test:seed` | ✅ | 18 fixture user · 5 merchant · 3 tx |
| `npm run verify:admin-perms` | ✅ | 4/4 (profit_share RPC dahil) |
| `node scripts/run-pratik-test-plan.mjs` | ✅ | **35/35** |
| `npm run test:seed:verify` | ✅ | `critical_count=0` · `error_count=0` (smoke öncesi) |
| API restart | ✅ | `:3000` temiz başlatıldı (rate-limit sıfır) |
| Admin curl login | ✅ | HTTP 200 · `requiresMfa=true` |
| `member.frozen@` curl login | ✅ | HTTP 403 · `ACCOUNT_FROZEN` |

**Tarayıcı:** `db:reset` / fixture sonrası **çıkış yapın** → `admin@wallet.local` / `Admin1234` ile yeniden giriş. Eski JWT geçersiz `sub` taşır; admin BO `STAFF_REQUIRED` / `PERMISSION_DENIED` verebilir.

**Integrity disiplini:** `test:seed:verify` yalnızca temiz DB snapshot'ta yeşil sayılır; `smoke-all` sonrası tekrar koşarsanız bulgu çıkar — ayrı komutlar, aynı snapshot değil.

## Dev ortam kurtarma — uygulandı (2026-05-28)

Test koşuları (smoke + E2E + pratik plan) sonrası bozulan local dev ortam tek zincirle toparlandı:

```bash
npm run db:reset && npm run test:seed && npm run test:bo-overrides
# API restart (LOGIN_RATE_LIMIT sıfırla)
lsof -ti:3000 | xargs kill -9 2>/dev/null; sleep 1; cd apps/api && npm run dev
# Web (8080) ayrı terminalde: cd apps/web && npm run dev
node scripts/verify-admin-perms.mjs   # exit 0 = admin BO OK
```

**Doğrulama:** login 200 · verify-admin-perms 4/4 · profit-share / loyalty / chat API yeşil · API `:3000/health` 200 · web `:8080` 200.

**Kullanıcı aksiyonu:** Tarayıcıda çıkış → `admin@wallet.local` / `Admin1234` ile yeniden giriş (eski JWT geçersiz `sub` taşıyor).

## Admin auth after db:reset (2026-05-28)

**Kök neden:** `db:reset` sonrası `user_roles` satırı yoksa (bootstrap atlandıysa) admin RPC'leri `STAFF_REQUIRED` döner — örn. `/admin/profit-share` → `admin_list_profit_share_campaigns`. Eski JWT ile oturum açık kalınca `sub` DB'de yok → `PERMISSION_DENIED` veya `USER_NOT_FOUND`. `bo_permissions` seed'de `profit_share:view` admin rolünde mevcut; sorun izin seed'i değil, staff rolü / oturum senkronu.

**Fix:** `scripts/db-reset.mjs` → `admin:bootstrap` zinciri; `requireAuth` geçersiz `sub` → `USER_NOT_FOUND`; paylaşımlı `hasStaffRole()`; FE `STAFF_REQUIRED` / `PERMISSION_DENIED` i18n + RPC'de `wallet.auth-changed`; `npm run verify:admin-perms` (profit_share RPC dahil).

**Operasyon:** `db:reset` (+ isteğe bağlı `test:seed`) → tarayıcıda çıkış → `admin@wallet.local` / `Admin1234` → `npm run verify:admin-perms`.

## Login incident (2026-05-28)

**Kök neden:** Test planı / smoke koşuları 15 dk pencerede 20+ `/auth/login` isteği üretmiş; in-memory `LOGIN_RATE_LIMIT` (429) tüm girişleri bloklamış. FE `LOGIN_RATE_LIMIT` sözlükte yoktu → "Beklenmeyen bir hata oluştu".

**Fix:** API yeniden başlatıldı (limit sıfırlandı); `admin:bootstrap` doğrulandı; `i18n-errors.ts`'e auth rate-limit kodları eklendi.

**Durum:** ✅ curl + proxy login 200; seed hesapları (`member.funded@`, `accounting@`, `support@`) OK.

## Recent batches (newest → oldest)

| Batch | Headline | Mig |
|-------|----------|-----|
| **AI** | **K5 + K6** — 9 admin remediation RPC (referral qualify/cancel/config, permission overrides, affiliate costs/payout); commerce cashout MVP (`merchant-cashout-request` + webhook callback + USDT komisyon alanı); `profit-share` cashout fee geliri. | — |
| **AH** | **K2 + K7** — admin loyalty/OTP settings allowlist + seed (`0020`); `Settings.tsx` `settings:manage`; smoke 4 fail fix (`/readyz`, CSRF, MFA TOTP, storage Bearer). **K1–K12** kararlar `BUSINESS_DECISIONS.md`. | `0020_loyalty_settings` |
| **AG** | **PS12–PS13** profit share — `docs/PROFIT_SHARE.md` (iş+teknik spek); Playwright `e2e/admin/profit-share.spec.ts` + `e2e/member/profit-share.spec.ts`; INDEX / ROADMAP / BUSINESS_DECISIONS güncellendi. | — |
| **AF** | **PS5–PS11** profit share — yayın bildirimi (email+in-app+push stub); kapanış özeti+audit (`closed_at`/`closed_by`); carried_overhead admin önizleme; üye DTO camelCase hizalama; pool remainder dağıtımı (PS10); cancel/close RPC+UI. | `0019_profit_share_close` |
| **AE** | **PS1 + PS7** profit share — gerçek gelir/gider (`transactions` + `provider_ledger` + affiliate accrual); carry-forward `profit_share_cumulative_overhead` settings + kampanya `carried_overhead` snapshot; publish audit; önizleme API `{ summary, allocations }`. | `0018_profit_share_overhead` |
| **AD** | **L1 Faz 2** LOYALTY_V3 spend formülü — `loyalty-scoring.service.ts` (turnover × streak × tier × cooldown); `payment-code.service` rezervasyon; withdraw ≥3/30g → `cooldown_until`; `my_loyalty_summary` paylaşımlı sorgular; unit testler. | — |
| **AC** | **L6** 6×3 barem tier yapısı — 18 `loyalty_tiers` satırı; turnover ×20; `0017_loyalty_barems` (FK remap barem I); seed upsert; `pickHighestEligibleTier` sort_order; admin/member UI barem etiketleri. | `0017_loyalty_barems` |
| **AB** | **L2** otomatik tier yükseltme (`maybeUpgradeTier` — puan **ve** turnover); spend + admin puan sonrası tetik; manuel düşürme `admin_set_member_tier` / `POST /api/admin/members/:id/tier` (`loyalty:manage`); `loyalty_points_log` + `writeAudit`. | — |
| **AA** | **P0-21/P0-22** topup callback — geç `expired` session kabul; sağlayıcı tutarı source of truth (`amount_mismatch` audit metadata). **L1 Faz 1** withdraw penalty (`-floor(amount/10)×2`, `loyalty_points_log` idempotent). | — |
| **Z** | Pratik test plan (Faz 0–5) — `scripts/run-pratik-test-plan.mjs` **35/35**; withdraw callback yanlış `merchant_settlement_log` yazımı kaldırıldı; integrity `flow_withdraw_cash_pool_posting` withdraw_session log join; dev `/api/dev/*` CSRF skip. | — |
| **Y** | `credit_limit` UX — admin Settlement + merchant Dashboard: "Çekilebilir/Kullanılabilir" kaldırıldı; "Akış B max kapasite" + borç tavanı açıklamaları; API mantığı aynı (`balance + credit_limit` yalnızca Akış B overdraft guard). | — |
| **X** | Merchant BO tam test — seed `merchant.parent@` / `merchant.finance@`, REST settlement (finance cash_pool + parent scope), smoke +10 merchant case, Playwright merchant matrisi **18/18**, FE `dbSelect` → `/api/merchant/self/*`. | — |
| **W** | Test seed ledger coherence — `seed-test-fixtures.mjs` writes matching tx/settlement/cash_pool chains; `npm run test:seed:verify` + `npm run db:reset` (local). | — |
| **V** | Ledger integrity — 20 SQL invariant checks, `ledger_integrity_runs` table, cron 3×/day, admin BO manual trigger + run history UI. | `0016_ledger_integrity` |
| **U** | BO test paketi — `smoke-all.mjs` BO matrisi (accounting/support/merchant rolleri, from/rpc admin gaps), `test-bo-overrides.mjs`, seed'e `merchant.parent@` + `merchant.finance@`, Playwright 65 spec (admin nav crawl + rol matrisi + merchant deny), `Settings.tsx` merchant_self unwrap bugfix. | — |
| **T** | Test fixture seeder — `scripts/seed-test-fixtures.mjs` + `npm run test:seed` | — |
| **S** | Playwright E2E — `e2e/` + `npm run test:e2e` | — |

## Test setup (2026-05-28)

| Option | Durum | Dosya / komut |
|--------|-------|---------------|
| **A** Seed fixtures | ✅ | `npm run test:seed` → `scripts/seed-test-fixtures.mjs` |
| **A′** Seed ledger verify | ✅ **0 critical / 0 error** (temiz DB) | `npm run test:seed:verify` — **smoke-all'dan önce** koş |
| **B** Manuel checklist | **Done** | `docs/MANUAL_TEST_CHECKLIST.md` |
| **C** Playwright E2E | ✅ **69/69** (tam suite, PS13 +4 spec) · Merchant BO alt kümesi **18/18** | `npm run test:e2e` → `e2e/merchant/*` |
| **D** API smoke | ✅ **220/220 pass** (K7) | `node scripts/smoke-all.mjs` — API restart sonrası |
| **F** Pratik gap runner | ✅ **35/35** (local, temiz seed + withdraw tam döngü sonrası verify 0/0) | `node scripts/run-pratik-test-plan.mjs` |

**Smoke:** K7 ile 4 bilinen fail giderildi (`/readyz`, CSRF `identifier-exists`, MFA unenroll TOTP, storage signed-url Bearer).

**Temiz ledger integrity kontrolü (local):**

```bash
npm run db:reset          # LOCAL ONLY — migrate + seed + admin:bootstrap
npm run test:seed
npm run test:seed:verify  # critical_count=0, error_count=0 beklenir
npm run test:bo-overrides # opsiyonel — FE alias izinleri (buton görünürlüğü)
node scripts/verify-admin-perms.mjs  # admin BO PERMISSION_DENIED yok mu?
```

`db:reset` sonrası tarayıcıda **çıkış yapıp yeniden giriş** gerekir (eski JWT geçersiz kullanıcıya işaret eder).

`node scripts/smoke-all.mjs` sonrası integrity tekrar koşulursa bulgu çıkar (smoke API üzerinden tutarsız tx ekler) — smoke ile integrity aynı DB snapshot'ta birlikte yeşil sayılmaz.

**Not:** Peş peşe smoke + E2E koşusu auth rate-limit tetikler — araya API restart koy.

## Open work (priority order)

> **Onaylı iş kararları:** `docs/BUSINESS_DECISIONS.md` § K1–K12 (2026-05-29). Aşağıdaki sıra uygulama önceliğidir.

1. ~~**P0-21 + P0-22 — topup callback**~~ ✅ (2026-05-29) — `topup.service.ts` `finalizeTopupCallback`.

2. **Loyalty v3 — uygulama (L1–L6 onaylı)** — detay: `docs/ROADMAP.md` § Loyalty v3 · `docs/BUSINESS_DECISIONS.md` § L1–L6.
   - ~~**L1 Faz 1:** withdraw penalty~~ ✅ (2026-05-29) — `member.service` + `withdraw.service`.
   - ~~**L1 Faz 2:** streak + cooldown + spend formülü~~ ✅ (2026-05-29) — `loyalty-scoring.service.ts` + `payment-code.service`.
   - ~~**L2:** otomatik tier yükseltme, manuel düşürme~~ ✅ (2026-05-29) — `loyalty-tier.service.ts`.
   - ~~**L6:** 6×3 barem seed + migration (turnover ×20)~~ ✅ (2026-05-29) — `0017_loyalty_barems.sql`.
   - **L3/L4/L5:** politika onaylı (K3/K4); cashback kapalı, referral ödeme anti-farming'e kadar kapalı, profit share bağımsız.
   - ~~**K2:** admin loyalty settings → `settings` allowlist + seed~~ ✅ (2026-05-29).
   - ~~**K1:** sadakat harcama bakiyesi gelecek tasarımı~~ ✅ (2026-05-29) — program bazlı üye bakiyesi; tavan + yalnızca Akış A; şu an **kapalı**; `commission_discount_pct` → rename veya `loyalty_spend_balance` (implementasyon sprint'inde). Detay: `BUSINESS_DECISIONS.md` § K1 · `LOYALTY_V3.md` § Sadakat harcama bakiyesi.
   - **K12:** formül değişiklikleri ileriye dönük; retroaktif recalc yok.

3. ~~**Kazanç Dağıtımı — teknik uygulama (PS1–PS6 onaylı)**~~ ✅ (2026-05-29) — spek: `docs/PROFIT_SHARE.md` · PS1–PS13 tamam.
   - ~~**PS1 + PS7** …~~ ✅
   - ~~**PS8–PS11** …~~ ✅
   - ~~**PS5** …~~ ✅
   - ~~**PS6** …~~ ✅
   - ~~**PS12–PS13** …~~ ✅ (2026-05-29) — `PROFIT_SHARE.md` + Playwright E2E.

4. ~~**K5 — P0-32 admin remediation RPC'leri**~~ ✅ (2026-05-29) — `referrals.service`, `permissions.service`, `affiliate.service` + `rpc.routes.ts`.

5. ~~**K6 — Merchant cashout MVP**~~ ✅ (2026-05-29) — `merchant-cashout.service.ts`, `fn.routes` + `webhooks.routes`, USDT komisyon UI.

6. **K8 — Deploy** — yalnızca GitHub; sunucu deploy henüz yok.

7. **K9 — Aninda staging** — canlı öncesi staging doğrulama.

8. **K10 — Finance `topup_init_url`** — mock URL yeterli (dev); canlı init URL sonraki ops.

9. **K11 — Affiliate** — kapalı kalır.

## Reference

- **Onaylı iş kararları** → `docs/BUSINESS_DECISIONS.md`
- **Kazanç Dağıtımı spek** → `docs/PROFIT_SHARE.md`
- Product roadmap → `docs/ROADMAP.md`
- Audit plan → `.cursor/plans/wallet_production_go-live_audit_591d4884.plan.md`
- DB schema → `apps/api/src/db/schema/*.ts`
- Smoke runner → `scripts/smoke-all.mjs`
- Test fixtures → `npm run test:seed` · verify → `npm run test:seed:verify` · local reset → `npm run db:reset`
- Playwright → `e2e/README.md`
- Pratik gap runner → `node scripts/run-pratik-test-plan.mjs`
