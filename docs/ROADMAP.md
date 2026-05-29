# Wallet — product roadmap

> **Canonical open work:** `docs/SESSION_STATUS.md` — güncel sprint / öncelik sırası.
> Bu dosya orta-uzun vadeli ürün kararları ve faz planını tutar.

**Last updated:** 2026-05-29

---

## Loyalty v3 — kurgu önerileri

Kaynak: loyalty program araştırması §9. Spek: `docs/LOYALTY_V3.md`.  
**İş kararları (onaylı 2026-05-29):** `docs/BUSINESS_DECISIONS.md` § L1–L6.

### İş kararı — onaylandı ✅

| # | Konu | Karar | Durum |
|---|------|-------|-------|
| L1 | **Canlı kod ↔ LOYALTY_V3 hizalama** | **B** — Kademeli: önce çekim cezası, sonra seri/cooldown | ✅ approved → [BUSINESS_DECISIONS § L1](BUSINESS_DECISIONS.md#l1--kademeli-loyalty-hizalama) |
| L2 | **Tier otomatik yükseltme** | **B** — Otomatik yükselt, manuel düşür | ✅ approved → [BUSINESS_DECISIONS § L2](BUSINESS_DECISIONS.md#l2--tier-otomatik-yükseltme) |
| L3 | **Cashback açılışı** | **A** — Cashback kapalı; L1+L2 önce | ✅ approved → [BUSINESS_DECISIONS § L3](BUSINESS_DECISIONS.md#l3--cashback) |
| L4 | **Profit share vs loyalty çift teşvik** | **A** — İkisi bağımsız (PS2 ile uyumlu) | ✅ approved → [BUSINESS_DECISIONS § L4](BUSINESS_DECISIONS.md#l4--profit-share-vs-loyalty) |
| L5 | **Referral ayrı tut** | **A** — Referral ayrı; anti-farming hazır olana kadar ödeme kapalı | ✅ approved → [BUSINESS_DECISIONS § L5](BUSINESS_DECISIONS.md#l5--referral) |
| L6 | **Tier eşikleri** | **MAJOR** — 6 seviye × 3 barem; turnover ×20; hızlı ilk seviye | ✅ shipped (2026-05-29) → [BUSINESS_DECISIONS § L6](BUSINESS_DECISIONS.md#l6--tier-yapısı-2026-05-29) |

### Teknik yol haritası (LOYALTY_V3 fazları)

Sıra — onaylı iş kararlarına göre (`docs/BUSINESS_DECISIONS.md` uygulama önceliği):

1. **Withdraw penalty (L1 Faz 1)** — `withdraw_penalty = -floor(amount / 10) × 2` (`member.service` / withdraw akışı).
2. **Tier auto-upgrade (L2)** — puan + turnover; otomatik yükselt, manuel düşür; upgrade audit satırı.
3. ~~**L6 tier reseed**~~ ✅ — 18 barem satırı (`sub_rank` 0–2); turnover ×20; migration `0017_loyalty_barems` + `current_tier_id` barem I eşlemesi.
4. **Cooldown + streak (L1 Faz 2)** — 30 günde ≥3 withdraw → `accounts.cooldown_until` + `cooldown_factor = 0.5`; streak_factor spend path.
5. **Tam LOYALTY_V3 formülü** — turnover_factor, streak_factor, tier_mul, cooldown_factor birlikte (`payment-code.service` spend path).
6. **Cashback (L3 — en son)** — settings flip; guard: max %1.5, L1–L2 tamam.

### Kod / dokümantasyon boşlukları

| Gap | Durum |
|-----|-------|
| `commission_discount_pct` tier'da tanımlı; ücret hesabına uygulanmıyor | Açık (K1 — onay bekliyor) |
| ~~Admin loyalty settings UI backend'e bağlı değil~~ | ✅ K2 (2026-05-29) |
| K9 formül düzeltmesi (Option C — mevcut fazla kazanım devam) | İş kararı bekliyor — `docs/UYGULANAN_DEGISIKLIKLER.md` |

### Referans

- **İş kararları** → `docs/BUSINESS_DECISIONS.md`
- Spek → `docs/LOYALTY_V3.md`
- Puan servisleri → `apps/api/src/services/member.service.ts`, `payment-code.service.ts`
- Tier seed → `apps/api/src/db/seed.ts` (`LOYALTY_TIERS`)
- Admin UI → `/admin/loyalty` (`docs/PAGE_CONTRACTS.md`)

---

## Kazanç Dağıtımı — yapılacaklar

Kaynak: profit share inceleme (2026-05). Sayfa kontratı → `docs/PAGE_CONTRACTS.md` § `/admin/profit-share`.  
**İş kararları (onaylı 2026-05-29):** `docs/BUSINESS_DECISIONS.md` § PS1–PS6.

**Durum:** PS1–PS13 **tamamlandı** (2026-05-29). Tek kaynak spek: `docs/PROFIT_SHARE.md`.

### İş kararı — onaylandı ✅ (PS1–PS6)

- [x] **PS1** Net kâr = tüm gelirler − tüm giderler; dağıtım sonrası kalan net tutar sisteme kalır. **Carry-forward:** her dağıtım toplamı genel giderine eklenir, sonraki net kâr buna göre hesaplanır. → [BUSINESS_DECISIONS § PS1](BUSINESS_DECISIONS.md#ps1--net-kâr-ve-carry-forward-genel-gider)
- [x] **PS2** Sadakat + kazanç payı **bağımsız** (ikisi de ödül alabilir; L4 ile uyumlu). → [BUSINESS_DECISIONS § PS2](BUSINESS_DECISIONS.md#ps2--sadakat-ve-kazanç-payı-bağımsızlığı)
- [x] **PS3** Claim süresi — mevcut BO: admin seçiyor, **değişiklik yok**. → [BUSINESS_DECISIONS § PS3](BUSINESS_DECISIONS.md#ps3--claim-süresi)
- [x] **PS4** Havuz — mevcut BO: % girilir, o kadar dağıtılır, **tavan yok**. → [BUSINESS_DECISIONS § PS4](BUSINESS_DECISIONS.md#ps4--havuz-tavanı)
- [x] **PS5** Yayın sonrası iletişim — **e-posta + uygulama içi** (+ isteğe bağlı push). → [BUSINESS_DECISIONS § PS5](BUSINESS_DECISIONS.md#ps5--yayın-sonrası-bildirim)
- [x] **PS6** Kapanış — **özet + muhasebe onayı denetim izi** (kim, ne zaman). → [BUSINESS_DECISIONS § PS6](BUSINESS_DECISIONS.md#ps6--kampanya-kapanışı)

### Teknik uygulama (PS7–PS13) ✅

- [x] **PS7** `platform_cost=0` / `affiliate_cost=0` stub düzelt — `computePreview` gerçek maliyet kaynaklarına bağlandı (2026-05-29, PS1 ile birlikte).
- [x] **PS8** Önizleme API ↔ Admin UI — `{ summary, allocations }` + `carried_overhead` gösterimi (2026-05-29).
- [x] **PS9** Üye API ↔ FE DTO — camelCase `ProfitShareReward` (`member.service` + shared DTO) (2026-05-29).
- [x] **PS10** Yuvarlama / havuz artığı — `distributeProRataAllocations`, kuruş artığı rank sırasıyla (2026-05-29).
- [x] **PS11** Kampanya cancel / close RPC + UI — `admin_cancel_*`, `admin_close_*` + butonlar (2026-05-29).
- [x] **PS12** `PROFIT_SHARE.md` — net kâr, durum makinesi, claim, cron, RBAC tek spek (2026-05-29).
- [x] **PS13** Playwright E2E — `e2e/admin/profit-share.spec.ts`, `e2e/member/profit-share.spec.ts` (2026-05-29).

### Referans

- **Spek (tek kaynak)** → `docs/PROFIT_SHARE.md`
- **İş kararları** → `docs/BUSINESS_DECISIONS.md`
- Sayfa kontratı → `docs/PAGE_CONTRACTS.md` § `/admin/profit-share`
- Servis → `apps/api/src/services/admin/profit-share.service.ts`
- Şema → `apps/api/src/db/schema/profit-share.ts`
- Admin UI → `apps/web/src/pages/admin/ProfitShare.tsx`
- Üye UI → `apps/web/src/pages/ProfitShareRewards.tsx`
- Loyalty çapraz → ROADMAP L4 / PS2

---

## P0 — onaylı kararlar (2026-05-29)

Kaynak: `docs/UYGULANAN_DEGISIKLIKLER.md` § Hâlâ Bekleyen Maddeler.  
**İş kararları:** `docs/BUSINESS_DECISIONS.md` § P0-21, P0-22, P0-32.

| ID | Konu | Karar | Durum |
|----|------|-------|-------|
| P0-21 | Geç topup callback / session TTL | Süreyi kaldır — finans merchant bildiriminde bakiye yüklensin | ✅ approved → [BUSINESS_DECISIONS § P0-21](BUSINESS_DECISIONS.md#p0-21--geç-topup-callback) |
| P0-22 | Topup tutar uyuşmazlığı | Sağlayıcı tutarını kabul et; üyeye gelen tutar yüklensin | ✅ approved → [BUSINESS_DECISIONS § P0-22](BUSINESS_DECISIONS.md#p0-22--sağlayıcı-tutarını-kabul-et) |
| P0-32 | 7 admin remediation RPC | Şimdilik kalsın | ⏸ deferred → [BUSINESS_DECISIONS § P0-32](BUSINESS_DECISIONS.md#p0-32--admin-remediation-rpcleri) |

---

## Deploy otomasyonu — "+" komutu

**Durum:** ✅ Script + dokümantasyon hazır (2026-05-29). Gerçek sunucuya deploy için `deploy.config.json` gerekli.

### Tamamlanan

- [x] `scripts/deploy-plus.mjs` — ön kontrol, GitHub commit+push, git/rsync, uzak build + restart
- [x] `deploy.config.example.json` + `.gitignore` (`deploy.config.json`)
- [x] `docs/DEPLOY_PLUS.md` — tek seferlik kurulum + günlük kullanım
- [x] `.cursor/rules/deploy-plus.mdc` — agent `+` / `deploy` / `sunucuya gönder` davranışı
- [x] `npm run deploy` / `npm run deploy:plus` — `--message`, `--no-push`, `--dry-run` bayrakları

### Sıradaki (opsiyonel)

- [ ] CI/CD — GitHub Actions ile `main` push sonrası otomatik staging deploy
- [ ] Deploy öncesi smoke — staging'de `smoke-all.mjs` gate
- [ ] Blue-green veya zero-downtime restart (şu an `systemctl restart`)
- [ ] Telegram deploy bildirimi (başarı/hata)
- [ ] `deploy.config.json` şifreleme veya 1Password/env entegrasyonu

### Referans

- Rehber → `docs/DEPLOY_PLUS.md`
- Genel deploy → `docs/DEPLOY_WORKFLOW.md`
- Sunucu kurulumu → `installers/linux/install.sh`
