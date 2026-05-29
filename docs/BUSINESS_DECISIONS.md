# Wallet — iş kararları (onaylı)

> **Kaynak:** Ürün sahibi kararları — 2026-05-29  
> **Durum:** `approved`  
> **Yol haritası bağlantısı:** `docs/ROADMAP.md`  
> **Canlı açık iş:** `docs/SESSION_STATUS.md`

---

## Özet tablo

| ID | Konu | Karar | Durum | Tarih |
|----|------|-------|-------|-------|
| PS1 | Net kâr / gelir tanımı | Gelir = tüm gelirler − tüm giderler; dağıtım sonrası kalan net tutar sisteme kalır. **Carry-forward:** Her dağıtımdaki toplam tutar şirket genel giderine eklenir; sonraki dağıtımın net kârı buna göre hesaplanır. | approved | 2026-05-29 |
| PS2 | Sadakat ↔ kazanç payı çift teşvik | **A** — İkisi bağımsız (sadakat + kazanç payı aynı spend'den ödül alabilir). | approved | 2026-05-29 |
| PS3 | Claim süresi | Mevcut BO: admin seçiyor — **değişiklik yok**. | approved | 2026-05-29 |
| PS4 | Havuz tavanı | Mevcut BO: % girilir, o kadar dağıtılır — **tavan yok, değişiklik yok**. | approved | 2026-05-29 |
| PS5 | Yayın sonrası iletişim | **C** — E-posta + uygulama içi bildirim (+ isteğe bağlı push). | approved | 2026-05-29 |
| PS6 | Kampanya kapanışı | **C** — Kapanış özeti + muhasebe onayı denetim izi (kim, ne zaman kapattı). | approved | 2026-05-29 |
| L1 | Loyalty canlı kod hizalama | **B** — Kademeli: önce çekim cezası, sonra seri/cooldown. | approved | 2026-05-29 |
| L2 | Tier yükseltme / düşürme | **B** — Otomatik yükselt, manuel düşür. | approved | 2026-05-29 |
| L3 | Cashback | **A** — Cashback kapalı; L1 + L2 önce. | approved | 2026-05-29 |
| L4 | Profit share vs loyalty | **A** — İkisi bağımsız (PS2 ile uyumlu). | approved | 2026-05-29 |
| L5 | Referral | **A** — Referral ayrı; anti-farming hazır olana kadar ödeme kapalı. | approved | 2026-05-29 |
| L6 | Tier eşikleri | **MAJOR** — Her seviyenin altında 3 kademeli barem; ilk seviye + baremler hızlı geçiş; üst seviyeler zorlaşır; mevcut turnover ×20. | approved | 2026-05-29 |
| P0-21 | Geç topup callback / session TTL | Süreyi kaldır — finans merchant kurallara göre bildirim atınca bakiye yüklensin (geç callback için session TTL engeli yok). | approved | 2026-05-29 |
| P0-22 | Topup tutar uyuşmazlığı | Finans merchant'tan hangi tutar gelirse üyeye o yüklensin (sağlayıcı tutarını kabul et). | approved | 2026-05-29 |
| P0-32 | Admin remediation RPC'leri | Şimdilik kalsın (ertelendi). | approved (defer) | 2026-05-29 |
| K1 | Sadakat harcama bakiyesi | **Gelecek tasarım onaylı** — program statüsüne göre üye bakiyesi/kredi; yapılandırılabilir tavan; yalnızca Akış A (spend). Şu an **kapalı**. | approved (future) | 2026-05-29 |
| K2 | Admin loyalty settings → backend | **Evet** — `/admin/settings` sadakat anahtarları `settings` tablosuna bağlanır. | approved | 2026-05-29 |
| K3 | Cashback | **A** — Kapalı kalır (L3 ile uyumlu). | approved | 2026-05-29 |
| K4 | Referral payout | **A** — Anti-farming hazır olana kadar kapalı (L5 ile uyumlu). | approved | 2026-05-29 |
| K5 | 7 admin remediation RPC | **A** — Şimdi uygula (P0-32 defer iptal). | approved | 2026-05-29 |
| K6 | Merchant cashout pipeline | **A** — MVP + USDT withdraw komisyon alanı; komisyon platform geliri. | approved | 2026-05-29 |
| K7 | Smoke 4 fail | **A** — `smoke-all.mjs` düzelt. | approved | 2026-05-29 |
| K8 | Deploy | **B** — Yalnızca GitHub; sunucu deploy henüz yok. | approved | 2026-05-29 |
| K9 | Aninda | **B** — Önce staging. | approved | 2026-05-29 |
| K10 | Finance topup URL | **B** — Mock URL yeterli (şimdilik). | approved | 2026-05-29 |
| K11 | Affiliate | **B** — Kapalı kalır. | approved | 2026-05-29 |
| K12 | Loyalty formül değişiklikleri | **C** — İleriye dönük; retroaktif yeniden hesap yok. | approved | 2026-05-29 |

---

## K1–K12 Kararlar (2026-05-29 backlog)

### K1 — Sadakat harcama bakiyesi ✅ (gelecek tasarım — şu an kapalı)

**Durum:** Özellik **şu an kapalı**; aşağıdaki kurallar aktivasyon öncesi onaylı tasarımdır.

**Karar:** Üye, sadakat programı statüsüne (tier / barem) göre **program bazlı bakiye/kredi** alır. Bu fayda:

- **Merchant komisyon indirimi değildir** (platform ücreti düşürme yok).
- **Merchant faydası değildir** (settlement / net artış yok).
- Üyeye doğrudan harcanabilir sadakat bakiyesi olarak tanımlanır.

**Kural 1 — Tavan:** Bu sadakat bakiyesi için yapılandırılabilir bir **maksimum tutar (ceiling)** zorunludur (global veya tier bazlı — uygulama detayı implementasyonda).

**Kural 2 — Harcama kısıtı:** Bakiye **yalnızca merchant spend** (Akış A / ödeme kodu) için kullanılabilir. Aşağıdakilerde **kullanılamaz**:

| Akış | Kullanım |
|------|----------|
| Akış A — spend (ödeme kodu) | ✅ İzinli |
| Akış B — merchant credit pull | ❌ Yasak |
| Akış C — topup | ❌ Yasak |
| Akış D — withdraw | ❌ Yasak |
| Diğer amaçlar | ❌ Yasak |

Hard Rule #7 uyumu korunur: üye komisyon ödemez; sadakat bakiyesi gross tutardan düşülür, merchant'a ek maliyet yansıtılmaz.

**Şema / alan notu (implementasyon niyeti):** Mevcut `loyalty_tiers.commission_discount_pct` alanı bu semantiği taşımıyor. Aktivasyonda ya alan **yeniden adlandırılır** ya da ayrı bir **`loyalty_spend_balance`** (veya eşdeğeri üye bakiye kolonu + tier kuralı) kavramı eklenir. **Şimdilik kod değişikliği yok** — yalnızca tasarım kaydı.

**Önceki taslak (iptal):** Merchant platform ücreti indirimi (`commission_discount_pct` → merchant net artış) — K1 bu yönde **onaylanmadı**.

### K2 — Admin loyalty settings

`/admin/settings` sadakat sekmesindeki anahtarlar (`points_per_spend_unit`, `withdraw_penalty_per_unit`, vb.) `settings` tablosu + allowlist üzerinden okunur/yazılır.

### K3 — Cashback

L3 ile aynı: cashback kapalı; ileride açılırsa max %1,5.

### K4 — Referral payout

L5 ile aynı: anti-farming production-ready olana kadar ödeme kapalı.

### K5 — Admin remediation RPC'leri

7 eksik admin RPC (referral nitelendirme, override silme, affiliate dashboard, vb.) — P0-32 defer iptal; uygulama onaylı.

### K6 — Merchant cashout

MVP cashout pipeline; USDT withdraw formunda komisyon girişi; komisyon platform geliri olarak kaydedilir.

### K7 — Smoke

`smoke-all.mjs` içindeki 4 bilinen fail düzeltilir.

### K8 — Deploy

GitHub push/commit; production sunucu deploy bu aşamada yok (K8-B).

### K9 — Aninda

Canlı öncesi staging ortamında doğrulama.

### K10 — Finance topup init URL

Dev/mock URL yeterli; canlı init URL sonraki ops adımı.

### K11 — Affiliate

`affiliate_system_enabled` kapalı kalır.

### K12 — Loyalty formül

Tier/puan formülü değişiklikleri yalnızca ileriye dönük; geçmiş `loyalty_points_log` retroaktif yeniden hesaplanmaz.

---

## PS1 — Net kâr ve carry-forward genel gider

> **Uygulama speği:** `docs/PROFIT_SHARE.md` § 2

### Karar (tam metin)

**Gelir = tüm gelirler − tüm giderler.** Sisteme kalan net tutar.

**IMPORTANT:** Her dağıtımdaki toplam tutarı şirketin genel giderine ekleyip bir sonraki dağıtımdaki net kârı buna göre hesapla (carry-forward overhead between campaigns).

### Teknik notlar (uygulandı — 2026-05-29)

| Konu | Durum |
|------|-------|
| Net kâr formülü | ✅ `fetchPlatformEconomics` + `computeProfitShareNetProfit` |
| Carry-forward | ✅ `settings.profit_share_cumulative_overhead` + kampanya `carried_overhead` snapshot |
| Publish overhead | ✅ `addCumulativeOverhead` + `profit_share.overhead_carry_forward` audit |
| Migrasyon | `0018_profit_share_overhead` |

---

## PS2 — Sadakat ve kazanç payı bağımsızlığı

Aynı üye hem loyalty puanı hem profit-share allocation alabilir. L4 ile aynı karar — çifte teşvik engellenmez.

**Etki:** `LOYALTY_V3.md` ve profit-share eligibility kurallarında karşılıklı exclusion yazılmaz.

---

## PS3 — Claim süresi

Admin BO'da `claim_expires_hours` admin tarafından seçilir. Varsayılan veya band kısıtı eklenmez.

---

## PS4 — Havuz tavanı

Admin BO'da `distribution_pct` girilir; girilen yüzde kadar dağıtılır. Mutlak TRY tavanı veya % üst sınırı yok.

---

## PS5 — Yayın sonrası bildirim

> **Uygulama speği:** `docs/PROFIT_SHARE.md` § 6 · kod: `profit-share-notify.service.ts`

| Kanal | Zorunluluk |
|-------|------------|
| E-posta | Evet |
| Uygulama içi bildirim | Evet |
| Push | İsteğe bağlı (settings / üye tercihi) |

**Etki:** Publish sonrası otomasyon — mevcut mail taslağı UI'sının ötesinde notification servisi + üye inbox.

---

## PS6 — Kampanya kapanışı

`closed` durumunda:

1. **Kapanış özeti** — dağıtılan / talep edilmeyen / süresi dolan treasury özeti.
2. **Muhasebe onayı denetim izi** — kim kapattı, ne zaman (`writeAudit` + kullanıcı kimliği).

---

## L1 — Kademeli loyalty hizalama

**Sıra:**

1. **Faz 1:** Withdraw penalty (`withdraw_penalty = -floor(amount / 10) × 2`) — `member.service` / withdraw akışı.
2. **Faz 2:** Streak factor + cooldown writer (`accounts.cooldown_until`, 30 günde ≥3 withdraw → `cooldown_factor = 0.5`).

Tam `LOYALTY_V3` formülü (turnover_factor × streak × tier_mul × cooldown) Faz 2 sonrası spend path'e bağlanır.

---

## L2 — Tier otomatik yükseltme

- **Yükseltme:** Puan **ve** turnover eşiği birlikte sağlanınca otomatik upgrade.
- **Düşürme:** Yalnızca admin manuel (otomatik downgrade yok).
- **Denetim:** Upgrade/downgrade `loyalty_points_log` veya ayrı audit satırı.

---

## L3 — Cashback

Cashback ürün genelinde **kapalı** kalır. L1 + L2 tamamlanana kadar açılmaz. Gelecekte açılırsa max %1.5 (mevcut `LOYALTY_V3.md` guard).

---

## L4 — Profit share vs loyalty

PS2 ile aynı: programlar bağımsız; aynı spend her iki teşviki de tetikleyebilir.

---

## L5 — Referral

Referral payout loyalty'den bağımsız. Anti-farming cron job'ları production-ready olana kadar referral **ödeme kapalı** (mevcut guard korunur).

---

## L6 — Tier yapısı ✅ (2026-05-29)

### Karar

- 6 ana seviye (`rookie` … `elite`), her birinin altında **3 kademeli barem** (`sub_rank` 0, 1, 2).
- Mevcut `min_turnover` değerleri **×20** ölçeklenir.
- İlk seviye + baremler: düşük eşik → hızlı geçiş (yeni üye algısı).
- Üst seviyeler: baremler arası ve seviyeler arası gap büyür.

**Uygulama:** `0017_loyalty_barems.sql` + `seed.ts` (18 satır) + `loyalty-tier.service.ts` (sort_order barem seçimi).

### Mevcut seed (referans — `apps/api/src/db/seed.ts`)

| level | display | sub | min_points | min_turnover (₺) | multiplier |
|-------|---------|-----|------------|------------------:|-----------:|
| rookie | Rookie | 0 | 0 | 0 | 1.00 |
| silver | Silver | 0 | 1,000 | 5,000 | 1.10 |
| gold | Gold | 0 | 5,000 | 25,000 | 1.25 |
| platinum | Platinum | 0 | 25,000 | 100,000 | 1.50 |
| diamond | Diamond | 0 | 100,000 | 500,000 | 1.75 |
| elite | Elite | 0 | 500,000 | 2,500,000 | 2.00 |

### Önerilen yapı (18 satır — onaylı taslak)

`sub_rank` 0 = giriş baremi, 1 = orta, 2 = seviye tavanı. Çarpanlar kademeli artar; cashback tüm satırlarda `0` (L3).

| # | level_name | display | sub | min_points | min_turnover (₺) | multiplier | not |
|---|------------|---------|-----|------------|------------------:|-----------:|-----|
| 1 | rookie | Rookie I | 0 | 0 | 0 | 1.00 | Başlangıç |
| 2 | rookie | Rookie II | 1 | 50 | 1,000 | 1.02 | Hızlı ilk barem |
| 3 | rookie | Rookie III | 2 | 150 | 3,000 | 1.05 | Rookie tavanı |
| 4 | silver | Silver I | 0 | 400 | 10,000 | 1.08 | 5k×20'nin alt üçte biri |
| 5 | silver | Silver II | 1 | 700 | 25,000 | 1.10 | |
| 6 | silver | Silver III | 2 | 1,000 | 50,000 | 1.12 | 5k×20 = 100k'nın yarısı |
| 7 | gold | Gold I | 0 | 2,500 | 100,000 | 1.18 | |
| 8 | gold | Gold II | 1 | 4,000 | 250,000 | 1.22 | |
| 9 | gold | Gold III | 2 | 5,000 | 500,000 | 1.25 | 25k×20 |
| 10 | platinum | Platinum I | 0 | 15,000 | 750,000 | 1.32 | |
| 11 | platinum | Platinum II | 1 | 20,000 | 1,500,000 | 1.40 | |
| 12 | platinum | Platinum III | 2 | 25,000 | 2,000,000 | 1.50 | 100k×20 |
| 13 | diamond | Diamond I | 0 | 60,000 | 4,000,000 | 1.58 | |
| 14 | diamond | Diamond II | 1 | 80,000 | 7,000,000 | 1.66 | |
| 15 | diamond | Diamond III | 2 | 100,000 | 10,000,000 | 1.75 | 500k×20 |
| 16 | elite | Elite I | 0 | 300,000 | 20,000,000 | 1.85 | |
| 17 | elite | Elite II | 1 | 400,000 | 35,000,000 | 1.92 | |
| 18 | elite | Elite III | 2 | 500,000 | 50,000,000 | 2.00 | 2.5M×20 |

**Şema etkisi:** `loyalty_tiers` zaten `sub_rank` ve `sort_order` taşır; 18 satır seed + mevcut üyelerin `current_tier_id` eşlemesi migration gerektirir (trivial değil — ayrı migration task).

**Admin UI:** `/admin/loyalty` barem listesini `sort_order` ile göstermeli.

---

## P0-21 — Geç topup callback

Session TTL süresi dolmuş olsa bile, finans merchant kurallara uygun bildirim gönderdiğinde bakiye yüklenir. HTTP 500 / reject yerine idempotent credit.

**Etki:** `topup` session handler — TTL hard-block kaldırılır; audit + idempotency korunur.

---

## P0-22 — Sağlayıcı tutarını kabul et

Webhook'ta beklenen tutar ≠ sağlayıcı tutarı durumunda 500 dönmek yerine gelen tutarı üyeye yükle; sonsuz retry döngüsü önlenir.

**Etki:** Finance merchant callback handler — amount mismatch → credit provider amount + audit flag.

---

## P0-32 — Admin remediation RPC'leri

7 eksik admin RPC (referral nitelendirme, override silme, affiliate dashboard, vb.) — **K5 ile defer iptal**; uygulama onaylı (2026-05-29).

---

## Uygulama öncelik sırası (öneri)

| Sıra | ID | Gerekçe |
|------|-----|---------|
| 1 | P0-21, P0-22 | Üye parası — topup akışı kritik |
| 2 | L1 Faz 1 | Withdraw penalty — düşük risk, tek servis |
| 3 | L2 | Auto-upgrade — tier motoru; L6 öncesi veya L6 ile birlikte |
| 4 | L6 | Seed + migration + admin UI — büyük diff, L2'ye bağlı |
| 5 | L1 Faz 2 | Streak + cooldown — spend formülü |
| 6 | PS1 + PS7 | Net kâr gerçek maliyetler + carry-forward alanı |
| 7 | PS8–PS11 | Profit-share teknik boşluklar |
| 8 | PS5 | Bildirim pipeline |
| 9 | PS6 | Kapanış özeti + muhasebe onayı |
| 10 | PS12–PS13 | Spek + E2E ✅ (2026-05-29) |
| — | L3, L4, L5 | Politika — çoğu mevcut guard ile uyumlu; kod değişikliği minimal |
| 11 | K5 | Admin remediation RPC'leri (P0-32 defer iptal) |
| 12 | K6 | Merchant cashout MVP + USDT komisyon |
| — | K8–K11 | Ops / politika — kod minimal veya sonraki sprint |
| — | K1 | Sadakat harcama bakiyesi — gelecek tasarım onaylı; aktivasyon bekliyor |
