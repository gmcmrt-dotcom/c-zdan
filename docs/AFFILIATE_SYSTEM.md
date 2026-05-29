# Wallet — Affiliate Sistemi (Spec)

> Bu doküman wallet'in **iki ayrı affiliate sistemini** tanımlar:
> 1. **Üye Referral** (Akış E) — üye-üye davet, hibrit ödül — **PRODÜKSİYONDA AKTİF**
> 2. **Merchant Affiliate** (Akış F) — dış kişi/üye merchant getirir, komisyon payı alır — **VARSAYILAN KAPALI** (`VITE_AFFILIATE_ENABLED=false` + `settings.affiliate_system_enabled=false`)
>
> İki sistem **bağımsız** çalışır: ayrı tablolar, ayrı servisler, ayrı UI.
> Bu doküman tasarım kontratıdır — uygulama detayı için
> `apps/api/src/db/schema/{referrals,affiliate}.ts` ve
> `apps/api/src/services/member.service.ts` (referral RPC shim'leri) ile
> affiliate-spesifik servisler kaynak gerçeğidir.

---

## 0. Onaylanan kararlar (kullanıcı, 2026-05-04)

| Karar | Seçim | Not |
|---|---|---|
| Member referral ödül tipi | Hibrit (puan + bakiye) | İki tarafa da hem puan hem TL |
| Member referral tetik | İlk spend | Bot/sahte hesap qualify olamaz |
| Member referral default rakam | Mütevazı | Davet eden 50p+25₺, davet edilen 25p+25₺ |
| Anti-fraud seviyesi | Standart | Phone/email dup, 10/ay cap, 500₺/ay cap, IP rate limit, min 100₺ qualify |
| Merchant affiliate basis | Hibrit/sözleşmeye göre | `our_commission` / `merchant_volume` / `fixed_per_tx` |
| Merchant affiliate kim | İkisi de | Dış kişi/kurum **veya** sistem üyesi |
| Merchant affiliate payout | Manuel/talep üzerine | Affiliate dashboard'dan talep, admin onay |
| Affiliate portal | MVP read-only | Ayrı JWT audience='affiliate' |

---

## 1. AKIŞ E — Member Referral

### 1.1 Senaryo

```
Davet Eden (referrer)            Davet Edilen (referee)            Sistem
──────────────────────           ────────────────────────          ─────────────────────────
1. /referrals açar
2. "Linki kopyala" → wallet.app/auth?ref=R-AB12CD34
3. Linki paylaşır →
                                  4. Linke tıklar
                                  5. Auth/Signup sayfası, ref=... query
                                  6. Telefon doğrulama, kayıt
                                                                    7. apply_referral_signup(code, new_user)
                                                                       → referrals row: status=pending
                                  8. Üye kayıt sonrası onboarding
                                  9. /topup → ilk havale
                                  10. Bakiye yüklenir
                                  11. /payment → ilk spend (≥100₺)
                                                                    12. consume_payment_code() içinde
                                                                       qualify_referral_first_spend hook
                                                                       → status=qualified
                                                                    13. claim_referral_reward (anti-fraud check)
                                                                       → status=rewarded
                                                                    14. İki tarafa puan + bakiye yüklenir
14. Bell badge: "+50 puan +25₺"   14. Bell badge: "+25 puan +25₺"
```

### 1.2 Bizim taraftaki sonuç

- `referrals` tablosuna 1 satır (status: rewarded)
- `referral_rewards_log`'a 4 satır (referrer_points, referrer_balance, referee_points, referee_balance)
- `loyalty_points_log`'a puan satırları (idempotency: reason='referral_reward')
- `transactions` tablosuna `type='referral_bonus'` 2 satır (her iki üye için bakiye TL ödülü)
- Bildirim: her iki tarafa "Referral bonus kazandın"

### 1.3 Anti-fraud kontrolleri

| Kontrol | Davranış |
|---|---|
| Aynı telefon/email zaten kayıtlı | DUPLICATE_PHONE/EMAIL — referral cancel |
| Referee phone hash referrer ile çakışıyor | SELF_REFERRAL — block |
| Referrer'ın aynı IP'sinden 24h içinde 3+ signup | IP_RATE_LIMIT — pending state'te tutar, admin review |
| Referrer'ın aylık 10 referral cap'i dolmuş | MONTHLY_REFERRAL_CAP — yeni signup pending |
| Referrer'ın aylık 500₺ cap'i dolmuş | MONTHLY_REWARD_CAP — yeni qualify pending |
| Referee ilk spend < 100₺ | MIN_SPEND_NOT_MET — qualify atlanır |
| Referee ban'lı | INVALID_REFEREE — referral cancel |

`scan_round_trip_farming` cron'una referral hesabı eklenir: aynı IP'den signup + ilk spend pattern'leri flag'lenir.

### 1.4 RPC'ler

```sql
-- Üye taraf
get_my_referral_link()           → text                    -- referrer'ın kodu (cache)
get_my_referrals()               → table(referee, status, reward, date)
get_my_referral_stats()          → record(total_invites, qualified, total_points, total_balance)

-- Sistem (signup hook)
apply_referral_signup(code, user_id) → referral_id          -- Auth.tsx çağırır

-- Sistem (spend hook, consume_payment_code içinden)
qualify_referral_first_spend(user_id, spend_amount) → bool  -- idempotent

-- Sistem (qualify sonrası)
claim_referral_reward(referral_id) → record(success, reward_amounts)  -- idempotent

-- Admin
admin_set_referral_config(payload jsonb) → void
admin_cancel_referral(referral_id, reason) → void
admin_get_referral_dashboard(filters) → table
```

### 1.5 Tablolar

```sql
referrals
├── id uuid PRIMARY KEY DEFAULT gen_random_uuid()
├── referrer_user_id uuid NOT NULL REFERENCES users(id)
├── referee_user_id uuid NOT NULL REFERENCES users(id)
├── referral_code text NOT NULL                            -- referrer'ın kodu, snapshot
├── status text NOT NULL CHECK (status IN ('pending','qualified','rewarded','expired','cancelled'))
├── qualifying_event text                                   -- 'first_spend' (MVP'de tek event)
├── qualifying_amount numeric(18,2)                        -- 100₺ minimum
├── qualified_at timestamptz
├── rewarded_at timestamptz
├── expired_at timestamptz                                  -- 90 gün signup'tan sonra qualify olmazsa expire
├── cancelled_reason text
├── created_at timestamptz NOT NULL DEFAULT now()
└── meta jsonb DEFAULT '{}'::jsonb

-- partial UNIQUE: bir üye sadece BİR kez davet edilebilir
CREATE UNIQUE INDEX referrals_referee_unique ON referrals(referee_user_id);

-- self-referral block
CHECK (referrer_user_id != referee_user_id)


referral_rewards_log
├── id uuid PRIMARY KEY DEFAULT gen_random_uuid()
├── referral_id uuid NOT NULL REFERENCES referrals(id)
├── recipient_user_id uuid NOT NULL REFERENCES users(id)
├── role text NOT NULL CHECK (role IN ('referrer','referee'))
├── reward_kind text NOT NULL CHECK (reward_kind IN ('points','balance'))
├── amount numeric(18,2) NOT NULL
├── reference_id text NOT NULL                             -- idempotency: referral_id || ':' || role || ':' || kind
├── created_at timestamptz NOT NULL DEFAULT now()

CREATE UNIQUE INDEX referral_rewards_log_ref_unique ON referral_rewards_log(reference_id);


referral_config (single-row table)
├── id boolean PRIMARY KEY DEFAULT true CHECK (id = true)  -- enforce singleton
├── referrer_points integer NOT NULL DEFAULT 50
├── referrer_balance numeric(18,2) NOT NULL DEFAULT 25.00
├── referee_points integer NOT NULL DEFAULT 25
├── referee_balance numeric(18,2) NOT NULL DEFAULT 25.00
├── min_spend_to_qualify numeric(18,2) NOT NULL DEFAULT 100.00
├── monthly_referral_cap integer NOT NULL DEFAULT 10
├── monthly_reward_cap numeric(18,2) NOT NULL DEFAULT 500.00
├── ip_rate_limit_per_24h integer NOT NULL DEFAULT 3
├── expire_after_days integer NOT NULL DEFAULT 90
└── updated_at timestamptz NOT NULL DEFAULT now()


-- users tablosuna kolon ekle (idempotent)
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code text UNIQUE;
-- Trigger: yeni user kaydında benzersiz kod üret (R-{8 random chars})
```

### 1.6 Erişim (service-layer scoping)

Postgres RLS yoktur. Erişim kontrolü Express middleware + servis fonksiyonlarında yapılır:

| Tablo | Üye (`requireAuth`) | Admin (`requireStaff` + `members:view_full`) | Accounting | Support |
|---|---|---|---|---|
| `referrals` | yalnızca `referrer_user_id = req.user.id OR referee_user_id = req.user.id` | tüm satırlar | tüm satırlar (PII maskeli) | tüm satırlar (PII maskeli) |
| `referral_rewards_log` | yalnızca `recipient_user_id = req.user.id` | tüm satırlar | tüm satırlar | tüm satırlar |
| `referral_config` | erişim yok | okuma + yazma | okuma | okuma |

### 1.7 Scheduler jobs (`apps/api/src/workers/scheduler.ts`)

- `expireReferrals` — 6 saatte bir, `status='pending' AND created_at < now() - 90d` → `status='expired'`
- `scanRoundTripFarming` (referral pattern dahil) — günde bir, IP / device / phone örtüşmelerini suggestion'a düşür

### 1.8 i18n key listesi (TR/EN)

```
referral.page.title
referral.page.subtitle
referral.link.copy
referral.link.copied
referral.share.email
referral.share.whatsapp
referral.stats.total_invites
referral.stats.qualified
referral.stats.points_earned
referral.stats.balance_earned
referral.history.title
referral.history.empty
referral.status.pending
referral.status.qualified
referral.status.rewarded
referral.status.expired
referral.status.cancelled
referral.cta.banner.title
referral.cta.banner.button

errors.REFERRAL_DUPLICATE_PHONE
errors.REFERRAL_SELF_REFERRAL
errors.REFERRAL_IP_RATE_LIMIT
errors.REFERRAL_MONTHLY_CAP
errors.REFERRAL_MIN_SPEND_NOT_MET
errors.REFERRAL_INVALID_CODE
errors.REFERRAL_EXPIRED
```

---

## 2. AKIŞ F — Merchant Affiliate (Komisyon)

### 2.1 Senaryo

```
Affiliate (dış/üye)        Merchant                     Sistem
──────────────────         ──────────────                ───────────────────────────────
1. Affiliate başvurur (email, IBAN, vergi no)
                                                          2. Admin /admin/affiliates'te
                                                             yeni affiliate yarat
                                                             → merchant_affiliates row
3. Affiliate merchant getirir
4. Merchant onboard olur
                                                          5. Admin merchant ↔ affiliate
                                                             link oluşturur:
                                                             - basis: our_commission
                                                             - pct: 20% (örnek)
                                                             - valid_from: now
                                                          6. merchant_affiliate_links row
7. Üye merchant'ta spend yapar  7. consume_payment_code →  8. Trigger: record_merchant_affiliate_commission
                                   bizim komisyon hesaplanır   - basis_amount: bizim komisyon
                                                                - commission_amount: bizim_komisyon × 20%
                                                                → merchant_affiliate_ledger row
9. Affiliate /affiliate dashboard
   "Bu ay 320₺" görür
10. "Talep Et" butonu
                                                          11. request_affiliate_payout RPC
                                                              → merchant_affiliate_payouts row
                                                                 status='requested'
                                                          12. Admin /admin/affiliates/payouts
                                                              "Onayla" → status='approved'
                                                          13. (Manuel banka transferi sistem dışı)
                                                          14. Admin "Ödendi" → status='paid'
                                                          15. ledger satırları payout_id ile damgalanır
```

### 2.2 Affiliate tipi

```sql
merchant_affiliates.kind ∈ {'external', 'internal_member'}
- external: linked_user_id NULL, ayrı email/şifre ile portal login
- internal_member: linked_user_id = users.id, kendi cüzdan account'undan komisyon görür
```

Hem external hem internal aynı RPC'leri kullanır; payout external'da banka transferi (sistem dışı), internal'da `transactions(type='affiliate_payout')` ile cüzdan bakiyesine yüklenir.

### 2.3 Komisyon basis

| Basis | Hesap | Avantaj | Dezavantaj |
|---|---|---|---|
| `our_commission` | bizim_komisyon × pct | Negatife düşmeyiz | Affiliate gelir tahmini zor |
| `merchant_volume` | gross_amount × pct | Affiliate için cazip | Düşük marjlı tx'te zarar riski |
| `fixed_per_tx` | her tx için sabit TL | Predictable | Yüksek volume'da pahalı |

Hibrit: `merchant_affiliate_links.commission_basis` kolonu ile her sözleşme kendi basis'ini seçer.

### 2.4 Tablolar

```sql
merchant_affiliates
├── id uuid PRIMARY KEY DEFAULT gen_random_uuid()
├── kind text NOT NULL CHECK (kind IN ('external','internal_member'))
├── code text NOT NULL UNIQUE                              -- A-XXXXXXXX
├── name text NOT NULL
├── email text NOT NULL UNIQUE
├── phone text
├── linked_user_id uuid REFERENCES users(id)               -- internal ise dolu
├── tax_id text                                             -- vergi/TC, external için
├── iban text                                               -- external için ödeme
├── auth_user_id uuid REFERENCES users(id)                  -- external için ayrı Wallet `users` kaydı
├── status text NOT NULL CHECK (status IN ('active','paused','terminated')) DEFAULT 'active'
├── created_at timestamptz NOT NULL DEFAULT now()
├── created_by uuid REFERENCES users(id)                    -- admin who created
└── meta jsonb DEFAULT '{}'::jsonb

CHECK (
  (kind = 'external' AND linked_user_id IS NULL AND auth_user_id IS NOT NULL) OR
  (kind = 'internal_member' AND linked_user_id IS NOT NULL AND auth_user_id IS NULL)
)


merchant_affiliate_links
├── id uuid PRIMARY KEY DEFAULT gen_random_uuid()
├── affiliate_id uuid NOT NULL REFERENCES merchant_affiliates(id)
├── merchant_id uuid NOT NULL REFERENCES merchants(id)
├── commission_basis text NOT NULL CHECK (commission_basis IN ('our_commission','merchant_volume','fixed_per_tx'))
├── commission_pct numeric(5,2)                            -- our_commission/merchant_volume için
├── fixed_amount_per_tx numeric(18,2)                      -- fixed_per_tx için
├── valid_from timestamptz NOT NULL DEFAULT now()
├── valid_to timestamptz                                    -- NULL = sınırsız
├── status text NOT NULL CHECK (status IN ('active','paused','terminated')) DEFAULT 'active'
├── created_at timestamptz NOT NULL DEFAULT now()
├── created_by uuid
└── meta jsonb DEFAULT '{}'::jsonb

-- Bir merchant'ın aynı anda EN FAZLA 1 aktif affiliate linki
CREATE UNIQUE INDEX merchant_affiliate_links_active_unique
  ON merchant_affiliate_links(merchant_id)
  WHERE status = 'active' AND valid_to IS NULL;

-- basis-pct/fixed tutarlılığı
CHECK (
  (commission_basis IN ('our_commission','merchant_volume') AND commission_pct IS NOT NULL AND fixed_amount_per_tx IS NULL) OR
  (commission_basis = 'fixed_per_tx' AND fixed_amount_per_tx IS NOT NULL AND commission_pct IS NULL)
)


merchant_affiliate_ledger
├── id uuid PRIMARY KEY DEFAULT gen_random_uuid()
├── affiliate_id uuid NOT NULL REFERENCES merchant_affiliates(id)
├── link_id uuid NOT NULL REFERENCES merchant_affiliate_links(id)
├── merchant_id uuid NOT NULL REFERENCES merchants(id)
├── source_transaction_id uuid REFERENCES transactions(id)  -- kaynak tx
├── source_type text NOT NULL                              -- 'spend','topup','withdraw'
├── basis_amount numeric(18,2) NOT NULL                    -- baz tutar (komisyon basis'ine göre)
├── commission_basis text NOT NULL                          -- snapshot
├── commission_pct numeric(5,2)                            -- snapshot
├── commission_amount numeric(18,2) NOT NULL               -- final tutar
├── payout_id uuid REFERENCES merchant_affiliate_payouts(id) -- ödendiğinde dolu
├── created_at timestamptz NOT NULL DEFAULT now()
└── reference_id text NOT NULL UNIQUE                      -- idempotency: source_tx_id || ':aff:' || link_id


merchant_affiliate_payouts
├── id uuid PRIMARY KEY DEFAULT gen_random_uuid()
├── affiliate_id uuid NOT NULL REFERENCES merchant_affiliates(id)
├── period_from timestamptz NOT NULL
├── period_to timestamptz NOT NULL
├── ledger_count integer NOT NULL                           -- kapsanan ledger satır sayısı
├── total_amount numeric(18,2) NOT NULL                     -- toplam tutar
├── status text NOT NULL CHECK (status IN ('requested','approved','paid','rejected','cancelled')) DEFAULT 'requested'
├── requested_at timestamptz NOT NULL DEFAULT now()
├── approved_at timestamptz
├── paid_at timestamptz
├── rejected_reason text
├── approved_by uuid REFERENCES users(id)
├── transfer_ref text                                        -- banka transfer referansı / wallet tx id
└── meta jsonb DEFAULT '{}'::jsonb
```

### 2.5 RPC'ler

```sql
-- Affiliate self-service (audience='affiliate' veya internal user)
get_my_affiliate_dashboard()         → record(merchants_count, this_month_amount, payable_amount, ...)
get_my_affiliate_ledger(filters)     → table
get_my_affiliate_payouts()           → table
request_affiliate_payout()           → payout_id  -- pending ledger'dan toplam hesapla, payout req aç

-- Admin
create_merchant_affiliate(payload jsonb)              → affiliate_id
attach_merchant_to_affiliate(merchant_id, affiliate_id, basis, pct/fixed) → link_id
detach_merchant_affiliate_link(link_id, reason)       → void
admin_get_affiliates_dashboard(filters)               → table
admin_get_affiliate_payout_queue()                    → table
admin_approve_affiliate_payout(payout_id, transfer_ref) → void
admin_reject_affiliate_payout(payout_id, reason)      → void
admin_mark_affiliate_payout_paid(payout_id, transfer_ref) → void

-- Sistem (transaction trigger)
record_merchant_affiliate_commission(transaction_id) → ledger_id  -- idempotent, transaction insert sonrası
```

### 2.6 Komisyon trigger noktaları

| Akış | Trigger | basis_amount kaynağı |
|---|---|---|
| Akış A (spend) | `consume_payment_code` SUCCESS sonrası | `our_commission`: `merchant_settlement_log.commission_amount`; `merchant_volume`: `transactions.amount` |
| Akış C (topup) | `finalize_topup_callback` SUCCESS sonrası | aynı şekilde |
| Akış D (withdraw) | `finalize_withdraw_callback` SUCCESS sonrası | aynı şekilde |
| Akış B (credit) | **TRIGGER YOK** — Akış B üye-merchant arası, biz komisyon almıyoruz | - |

`record_merchant_affiliate_commission` her transaction sonrası çağrılır; aktif link yoksa no-op döner.

### 2.7 Erişim (service-layer scoping)

Postgres RLS yoktur; affiliate scope'u service katmanı sağlar. `requireAffiliate` middleware'i (eklendiğinde) JWT'den `affiliateId`'yi yükleyip request context'e koyar, servisler bunu where koşulu olarak kullanır.

| Tablo | Affiliate (kendi) | Admin | Accounting |
|---|---|---|---|
| `merchant_affiliates` | sadece `id = ctx.affiliateId` | hepsi | okuma |
| `merchant_affiliate_links` | sadece `affiliate_id = ctx.affiliateId` | hepsi | okuma |
| `merchant_affiliate_ledger` | sadece `affiliate_id = ctx.affiliateId` | hepsi | hepsi |
| `merchant_affiliate_payouts` | okuma + payout request açma + kendi pending'ini iptal | hepsi | okuma + state geçişleri |

Internal member affiliate için `linked_user_id = req.user.id` filtresi kullanılır; aynı user hem cüzdan hem affiliate görür.

### 2.8 Auth: ayrı audience

External affiliate için `users` tablosunda ayrı bir kayıt (`auth_user_id`) ve `merchant_affiliates` ile bire-bir bağ tutulur. JWT'de affiliate rolü taşınır; staff veya merchant rotasında bu user reddedilir. `RequireAuth` ve `AffiliateLayout` rol kontrolü zorunlu, build-time `VITE_AFFILIATE_ENABLED=false` ise tüm rotalar `Navigate to="/"`.

Subdomain split açıldığında `affiliate.<host>` bu audience'a izin verir; `<host>` ve `merchant.<host>` reddeder.

### 2.9 i18n key listesi (TR/EN)

```
affiliate.dashboard.title
affiliate.dashboard.merchants_count
affiliate.dashboard.this_month
affiliate.dashboard.lifetime_earnings
affiliate.dashboard.payable
affiliate.dashboard.request_payout
affiliate.ledger.title
affiliate.ledger.empty
affiliate.payouts.title
affiliate.payouts.status.requested
affiliate.payouts.status.approved
affiliate.payouts.status.paid
affiliate.payouts.status.rejected

admin.affiliates.title
admin.affiliates.create
admin.affiliates.attach_merchant
admin.affiliates.detach_merchant
admin.affiliates.payout_queue

errors.AFFILIATE_INVALID_BASIS
errors.AFFILIATE_NO_PAYABLE
errors.AFFILIATE_LINK_INACTIVE
errors.AFFILIATE_PAYOUT_ALREADY_REQUESTED
errors.AFFILIATE_INSUFFICIENT_PERMISSION
```

---

## 3. Test senaryoları

### 3.1 Member referral

| # | Senaryo | Beklenen |
|---|---|---|
| E1 | Mutlu yol: signup → topup → spend 100₺ | iki tarafa puan + 25₺ |
| E2 | Min spend altı: signup → spend 50₺ | qualify olmaz, status pending kalır |
| E3 | Self-referral: aynı telefonun 2. hesabı | apply_referral_signup → SELF_REFERRAL |
| E4 | Aylık cap: 11. davet | 11. signup pending'de takılır |
| E5 | Reward cap: 500₺ dolduktan sonra | yeni qualify pending |
| E6 | IP rate limit: 24h içinde 4. signup | pending + admin review flag |
| E7 | 90 gün geçti, qualify yok | expire cron → status='expired' |
| E8 | İdempotency: çift claim_referral_reward | sadece 1 kez ödüllendirilir |
| E9 | Admin manuel cancel | status='cancelled', audit izi |
| E10 | Referee ban | bağlı tüm referral'ları cancel |

### 3.2 Merchant affiliate

| # | Senaryo | Beklenen |
|---|---|---|
| F1 | our_commission basis: bizim komisyon 10₺, %20 → ledger 2₺ | ✓ |
| F2 | merchant_volume basis: tx 100₺, %5 → ledger 5₺ | ✓ |
| F3 | fixed_per_tx basis: 1₺ sabit → ledger 1₺ | ✓ |
| F4 | İdempotency: aynı tx için 2. trigger | duplicate ledger row YOK |
| F5 | Aktif link yok: tx olur ama ledger boş | no-op, log debug |
| F6 | Affiliate payout request: 320₺ pending | payout row, ledger satırlar lock'lanır |
| F7 | Admin approve → mark paid | ledger satırları payout_id ile damgalanır |
| F8 | Affiliate iki link aynı merchant'ta aktif | UNIQUE constraint hatası, INVALID |
| F9 | Internal aff: payout → wallet bakiye | transactions(type='affiliate_payout') |
| F10 | External aff: payout → manuel transfer | transfer_ref kayıtlı, sistem dışı |
| F11 | Akış B (credit_member): trigger no-op | ✓ |

---

## 4. Uygulama yüzeyi

Express tarafında ayrı edge fn yoktur. Her şey `apps/api/src/routes/` altındaki rotalardan ve RPC shim'lerinden çalışır:

| Yüzey | Where |
|-------|-------|
| Affiliate self-service okumalar | `apps/api/src/routes/rpc.routes.ts` (`get_my_affiliate_*`, `request_affiliate_payout`) |
| Admin affiliate dashboard + payout state geçişleri | `apps/api/src/routes/admin.routes.ts` |
| Komisyon hesabı | İlgili akış servislerinin sonundaki `recordMerchantAffiliateCommission()` çağrısı (Akış A/C/D) |
| Affiliate UI | `apps/web/src/pages/affiliate/{Dashboard,Ledger,Payouts,Profile}.tsx` (lazy-loaded, `<AffiliateLazy>` ile feature-flag korumalı) |

Şu an `VITE_AFFILIATE_ENABLED=false` olduğu için tüm affiliate rotaları `Navigate to="/"`. Açılış için bkz. §0 + `docs/DEPLOY_WORKFLOW.md` § Feature flags.

---

## 5. Out of scope (post-MVP)

- Affiliate KYC döküman upload (vergi levhası, TC fotoğraf)
- Referral leaderboard / gamification
- Multi-level referral (sub-affiliate ağacı)
- Affiliate referral linkleri (affiliate kendi merchant getirme linki paylaşır)
- Cohort retention raporları
- Otomatik fatura PDF üretimi (manuel zarf yeterli MVP'de)
