# Manuel Test Kontrol Listesi

> **Amaç:** Member UI, Admin BO ve Merchant BO yüzeylerinin release öncesi elle doğrulanması.  
> **Kaynak rotalar:** `apps/web/src/App.tsx` · **Admin menü:** `apps/web/src/lib/admin-bo-registry.ts` · **Merchant menü:** `apps/web/src/components/MerchantLayout.tsx`

Her maddeyi tamamladıkça `- [ ]` → `- [x]` olarak işaretleyin. Beklenen sonuç sütununda kısa doğrulama notu yazın.

---

## 0. Ön koşullar

### 0.1 Ortam kurulumu

- [ ] PostgreSQL çalışıyor (`DATABASE_URL` → `apps/api/.env`)
- [ ] Şema uygulandı: `npm run db:migrate`
- [ ] Referans seed: `npm run db:seed` (veya `npm run db:reset` → migrate + seed + **admin:bootstrap** birlikte)
- [ ] İlk admin: `npm run admin:bootstrap` (`db:reset` kullandıysanız otomatik; aksi halde bir kez)
- [ ] Test fixture'ları: `npm run test:seed` (Option A — `scripts/seed-test-fixtures.mjs`)
- [ ] Ledger integrity (temiz DB): `npm run test:seed:verify` → `critical_count=0`, `error_count=0` — **`node scripts/smoke-all.mjs` öncesinde** koş; smoke tutarsız tx ekler, sonrasında verify yeşil sayılmaz
- [ ] `db:reset` / fixture sonrası tarayıcıda **çıkış + admin@wallet.local ile yeniden giriş** (eski JWT geçersiz `sub` taşır; `Admin1234`)
- [ ] Dev stack ayakta: `npm run dev` (API `:3000`, Web `:8080`)
- [ ] Tarayıcı: `http://localhost:8080`

### 0.2 Ortam değişkenleri (dev)

| Değişken | Dosya | Varsayılan | Ne zaman gerekli |
|----------|-------|------------|------------------|
| `VITE_DEV_MOCK_MERCHANT` | `apps/web/.env.local` | yok | Topup mock akışı + `/mock-pay` sayfası |
| `VITE_AFFILIATE_ENABLED` | `apps/web/.env.local` | `false` | Admin **İş Ortakları** menüsü + affiliate rotaları |
| `VITE_MFA_ENFORCEMENT` | `apps/web/.env.local` | `false` | Staff TOTP zorunluluğu (`/auth/mfa-challenge`) |

Örnek `apps/web/.env.local`:

```env
VITE_DEV_MOCK_MERCHANT=true
# VITE_AFFILIATE_ENABLED=true
# VITE_MFA_ENFORCEMENT=true
```

- [ ] Mock topup testi için `VITE_DEV_MOCK_MERCHANT=true` ayarlandı ve web yeniden başlatıldı
- [ ] Affiliate testi için `VITE_AFFILIATE_ENABLED=true` + `settings.affiliate_system_enabled=true` (Admin → Ayarlar) ayarlandı

### 0.3 Otomatik duman testi (API)

Sunucu ayaktayken:

```bash
npm run test:seed:verify   # önce — 0 critical / 0 error beklenir
node scripts/smoke-all.mjs # sonra — smoke DB'ye ek tx yazar
```

- [ ] `test:seed:verify` smoke **öncesinde** 0 critical / 0 error
- [ ] Komut 0 exit code ile bitti (172 endpoint vakası, ~5 sn)
- [ ] Uzak host hedeflenmedi (sadece `localhost` — prod koruması aktif)

> Smoke sonrası `test:seed:verify` tekrar koşulursa bulgu çıkabilir — bu beklenen gürültüdür; aynı snapshot'ta ikisi birden yeşil sayılmaz.

---

## 1. Test hesapları

> Parola: **`Test1234!`** (admin hariç). Admin: **`Admin1234`**.  
> Hesaplar `npm run test:seed` ile idempotent oluşturulur.

| E-posta | Parola | Rol / tip | Kullanım |
|---------|--------|-----------|----------|
| `admin@wallet.local` | `Admin1234` | Staff · `admin` | Tam Admin BO erişimi |
| `accounting@wallet.local` | `Test1234!` | Staff · `accounting` | Finans odaklı BO, kısıtlı mutasyon |
| `support@wallet.local` | `Test1234!` | Staff · `support` | Destek + üye dondurma/KYC |
| `member.base@wallet.local` | `Test1234!` | Üye | Temel akışlar, düşük bakiye |
| `member.funded@wallet.local` | `Test1234!` | Üye | Ödeme / topup / withdraw testleri |
| `member.frozen@wallet.local` | `Test1234!` | Üye · **dondurulmuş** | Frozen guard testleri |
| `member.kyc-pending@wallet.local` | `Test1234!` | Üye · KYC bekliyor | Admin KYC onay akışı |
| `member.referrer@wallet.local` | `Test1234!` | Üye · davet eden | Referral link + istatistik |
| `member.referee@wallet.local` | `Test1234!` | Üye · davet edilen | Referral bonus tetikleme |
| `member.pending-topup@wallet.local` | `Test1234!` | Üye · açık topup oturumu | Topup status sayfası |
| `member.loyalty@wallet.local` | `Test1234!` | Üye · sadakat puanı | Tier / puan görünümü |
| `member.chat@wallet.local` | `Test1234!` | Üye · açık destek talebi | ChatWidget + admin chat |
| `merchant.owner@wallet.local` | `Test1234!` | Merchant · `owner` | Commerce standalone (tahsilat ~₺243,75 defter) |
| `merchant.parent@wallet.local` | `Test1234!` | Merchant · `owner` | Commerce parent + child bayi listesi |
| `merchant.finance@wallet.local` | `Test1234!` | Merchant · `owner` | Finance havale · kasa defteri (API docs yok) |
| `merchant.accountant@wallet.local` | `Test1234!` | Merchant · `accountant` | Okuma + settlement (settings 403) |
| `merchant.readonly@wallet.local` | `Test1234!` | Merchant · `read_only` | Salt okunur (invite 403) |
| `affiliate@wallet.local` | `Test1234!` | Affiliate (flag açıkken) | `/affiliate/*` rotaları |

Seed merchant'ları (fixture adları — detay seed çıktısında):

| Merchant | Tip | Not |
|----------|-----|-----|
| Test Commerce Standalone | commerce | Akış A/B, API docs |
| Test Commerce Parent + Child | commerce · parent/child | Bayi listesi |
| Test Finance Havale | finance | Akış C topup |
| Test Finance Papara | finance | Alternatif finans yöntemi |

---

## 2. Rol matrisi — kim ne görmeli?

### 2.1 Admin BO — staff rolleri

Kaynak: `getAdminNavGroups()` + `bo_permissions` seed.

| Modül / menü | admin | accounting | support |
|--------------|:-----:|:----------:|:-------:|
| Panel | ✓ | ✓ | ✓ |
| Üyeler | ✓ | ✓ | ✓ |
| İşlemler | ✓ | ✓ | ✓ |
| Destek (Chat) | ✓ | ✓ | ✓ |
| Ticari / Finans Merchant'lar | ✓ | — | — |
| Bayiler | ✓ | ✓ | — |
| Finance Entegrasyon | ✓ | ✓ | — |
| İş Ortakları *(flag)* | ✓ | ✓ | — |
| Komisyonlar | ✓ | ✓ | — |
| Kazanç Dağıtımı | ✓ | — | — |
| Mutabakat | ✓ | ✓ | — |
| Sadakat | ✓ | — | — |
| Davetler | ✓ | ✓ | ✓ |
| Sistem logları | ✓ | ✓ | ✓ |
| Ayarlar | ✓ | — | — |
| BO Kullanıcıları | ✓ | — | — |
| Yetkiler | ✓ | — | — |
| Şablonlar | ✓ | — | — |
| Yöntem Tipleri | ✓ | — | — |

**Mutasyon farkları (elle doğrula):**

- [ ] `accounting@` — üye dondurma **başarısız** olmalı (403 / hata mesajı)
- [ ] `accounting@` — merchant oluşturma **başarısız** olmalı
- [ ] `support@` — üye dondurma **başarılı** olmalı
- [ ] `support@` — KYC onay/red **başarılı** olmalı (`members.kyc` seed izni)
- [ ] `support@` — Ayarlar menüsü **görünmemeli**
- [ ] `admin@` — tüm menü grupları görünür

### 2.2 Merchant BO — merchant rolleri

Kaynak: `MerchantLayout` + `merchantSelfNav`.

| Sayfa | owner | accountant | read_only |
|-------|:-----:|:----------:|:---------:|
| Dashboard | ✓ | ✓ | ✓ |
| Üye işlemleri | ✓ | ✓ | ✓ |
| Tahsilat (cashout) | ✓ | ✓* | ✓* |
| API çağrıları | ✓ | ✓ | ✓ |
| API dokümantasyonu *(commerce)* | ✓ | ✓ | ✓ |
| Settlement (`/merchant/settlement`) | ✓ | ✓ | ✓ |
| Bayiler (`/merchant/children`) | ✓ | — | — |
| Kullanıcılar | ✓ | — | — |
| Yetkiler | ✓ | — | — |
| Ayarlar (IP whitelist, webhook, secret) | ✓ | — | — |
| Profil | ✓ | ✓ | ✓ |

\* Cashout oluşturma ayrıca `can_cashout_create` bayrağına bağlı.

- [ ] `merchant.readonly@` — Ayarlar / Kullanıcılar / Yetkiler menüsü **yok**
- [ ] `merchant.accountant@` — Dashboard + işlemler görünür; ayarlar **yok**
- [ ] `merchant.owner@` — tüm owner menüleri görünür
- [ ] Finance merchant ile giriş — API dokümantasyonu menüsü **gizli** (`commerceOnly`)

---

## 3. Özel senaryolar

### 3.1 Dondurulmuş hesap (`member.frozen@`)

Kaynak: `apps/api/src/services/auth.service.ts` (giriş engeli) · `requireUnfrozen` middleware (oturum açıkken POST engeli).

- [ ] Giriş **engellenir** — HTTP 403 · `ACCOUNT_FROZEN` (Türkçe hata metni; oturum açılmaz)
- [ ] Admin → Üyeler → `member.frozen@` satırında **Donduruldu** badge
- [ ] Admin (support veya admin) → Dondur kaldır → giriş başarılı
- [ ] Dondur kaldırıldıktan sonra ödeme kodu / topup / withdraw **çalışır**
- [ ] *(İsteğe bağlı)* Oturum açıkken tekrar dondurulursa POST mutasyonları `ACCOUNT_FROZEN` döner; GET okumaları (bakiye, oturum listesi) devam eder

### 3.2 KYC — admin-only onay

- [ ] `member.kyc-pending@` ile üye tarafında profil/KYC durumu **bekliyor** görünür
- [ ] Admin → Üye detay → KYC onayla → durum **doğrulandı** olur
- [ ] KYC butonları `<Can do="members.kyc:approve">` ile sarılı — yetkisiz staff'ta gizli
- [ ] `support@` KYC reddi + sebep girebilir
- [ ] Red sonrası üye profilinde red durumu yansır

### 3.3 Affiliate feature flag

**Kapalı** (`VITE_AFFILIATE_ENABLED=false`, varsayılan):

- [ ] Admin sol menüde **İş Ortakları** yok
- [ ] `/admin/affiliates` → yönlendirme veya erişim engeli
- [ ] Üye referral (`/referrals`) **normal çalışır** (Akış E etkilenmez)

**Açık** (`VITE_AFFILIATE_ENABLED=true` + `affiliate_system_enabled`):

- [ ] Admin → İş Ortakları listesi yüklenir
- [ ] `affiliate@wallet.local` → `/affiliate` dashboard açılır
- [ ] Affiliate ledger / payouts / profil sayfaları erişilebilir

---

## 4. Member UI

### 4.1 Kimlik doğrulama (`/auth`)

- [ ] Kayıt formu — geçerli e-posta + parola (≥12, büyük/küçük/rakam) ile yeni hesap
- [ ] Zayıf parola reddedilir
- [ ] Duplicate e-posta reddedilir
- [ ] Giriş — `member.funded@wallet.local` / `Test1234!` başarılı
- [ ] Yanlış parola — hata mesajı, oturum açılmaz
- [ ] Çıkış — token temizlenir, `/auth`'a yönlendirilir
- [ ] Şifre sıfırlama talebi formu gönderilebilir (dev'de e-posta veya log)

### 4.2 MFA (`/profile/mfa`, `/auth/mfa-challenge`)

- [ ] MFA kurulum sayfası — TOTP QR + doğrulama kodu
- [ ] Yedek kodlar (8 adet) gösterilir ve indirilebilir
- [ ] MFA kaldırma — tüm oturumlar revoke (tekrar giriş gerekir)
- [ ] `VITE_MFA_ENFORCEMENT=true` iken staff giriş → `/auth/mfa-challenge` yönlendirmesi
- [ ] Geçersiz TOTP kodu reddedilir
- [ ] Geçerli TOTP sonrası Admin BO erişimi açılır

### 4.3 Ana sayfa (`/`)

- [ ] `member.funded@` — bakiye kartı TRY formatında (`fmtTRY`)
- [ ] Tier / sadakat özeti görünür
- [ ] Hızlı aksiyonlar (topup, withdraw, payment) linkleri çalışır
- [ ] Alt tab bar — 5 sekme (Ana Sayfa, İşlemler, Ödeme, Sadakat, Profil)
- [ ] Bildirim zili — okunmamış sayaç
- [ ] Dil değiştirici TR ↔ EN

### 4.4 İşlemler (`/transactions`)

- [ ] İşlem listesi yüklenir (seed verisi varsa satırlar görünür)
- [ ] Satıra tıklayınca detay açılır (`DetailPage` pattern)
- [ ] Merchant adı **üye yüzeyinde görünmez** (hard rule §6)
- [ ] Komisyon / fee **üye yüzeyinde görünmez**
- [ ] `TxIdBadge` — public_no kopyalanabilir

### 4.5 Ödeme — Akış A (`/payment`)

- [ ] Tutar + `customerName` ile önizleme (preview)
- [ ] Ödeme kodu oluşturulur — QR / kod metni görünür
- [ ] Kod iptali çalışır
- [ ] Yetersiz bakiye — anlamlı hata (`INSUFFICIENT_FUNDS`)
- [ ] `member.frozen@` — ödeme engellenir (bkz. §3.1)
- [ ] Kod TTL geri sayımı görünür

### 4.6 Topup — Akış C (`/topup`, `/topup/status`)

- [ ] Finans merchant listesi yüklenir (seed finance merchant'lar)
- [ ] Yöntem seçimi + tutar → oturum başlatılır
- [ ] Tek açık oturum kuralı — ikinci topup uyarı verir
- [ ] `/topup/status` — bekleyen oturum durumu (pending / completed / expired)
- [ ] Mock akış: redirect → `/mock-pay` → "Ödedim" → bakiye artışı
- [ ] 20 dk TTL sonrası oturum expired (veya seed'de expired örneği)
- [ ] `member.pending-topup@` — status sayfasında mevcut oturum görünür

### 4.7 Withdraw — Akış D (`/withdraw`, `/withdraw/status`)

- [ ] Çekim yöntemi listesi (method types)
- [ ] Tutar + hedef bilgisi → oturum oluşturulur
- [ ] Reserve pattern — bakiye düşer, reserved artar
- [ ] `/withdraw/status` — oturum durumu takibi
- [ ] Yetersiz çekilebilir bakiye hatası
- [ ] `member.frozen@` — withdraw engellenir

### 4.8 Sadakat (`/loyalty`)

- [ ] `member.loyalty@` — mevcut tier + puan görünür
- [ ] Tier ilerleme çubuğu / eşik bilgisi
- [ ] Puan geçmişi listesi
- [ ] Cashback / çarpan bilgisi member-safe (merchant yok)

### 4.9 Profil (`/profile`)

- [ ] Ad, telefon, e-posta maskeli veya tam (kendi verisi)
- [ ] Profil düzenleme — OTP akışı (telefon/e-posta değişikliği)
- [ ] IBAN / çekim hedefi kaydı
- [ ] MFA ayarları linki → `/profile/mfa`
- [ ] Davetler linki → `/referrals`
- [ ] Kazanç dağıtımı linki → `/profit-share`
- [ ] Çıkış butonu

### 4.10 Davetler — Akış E (`/referrals`)

- [ ] `member.referrer@` — kişisel davet linki oluşturulur
- [ ] Link kopyalama / paylaşma (WhatsApp, e-posta)
- [ ] İstatistik kartları (toplam, bekleyen, onaylı)
- [ ] Davet edilenler listesi — `member.referee@` görünür
- [ ] Merchant adı listede **yok**

### 4.11 Kazanç dağıtımı (`/profit-share`)

- [ ] Aktif kampanya listesi (seed allocation varsa)
- [ ] Üye payı TRY formatında
- [ ] Geçmiş dağıtımlar
- [ ] Boş durum — anlamlı empty state

### 4.12 Bildirimler (`/notifications`)

- [ ] Bildirim listesi yüklenir
- [ ] Tek bildirim okundu işaretleme
- [ ] Tümünü okundu işaretle
- [ ] Zilden `/notifications` navigasyonu
- [ ] Okunmamış sayaç sıfırlanır

### 4.13 MockPay (`/mock-pay`)

- [ ] `VITE_DEV_MOCK_MERCHANT=false` iken dev'de uyarı / prod'da 403
- [ ] `?ref=&amount=&return=` parametreleri parse edilir
- [ ] "Ödedim" — topup finalize, return URL'e yönlendirme
- [ ] "İptal et" — oturum iptal
- [ ] Open redirect koruması — `return=//evil.com` reddedilir

### 4.14 ChatWidget (tüm üye sayfaları)

- [ ] Sağ alt köşede chat balonu görünür
- [ ] Yeni destek talebi — kategori + konu + mesaj
- [ ] `member.chat@` — mevcut thread devam eder
- [ ] Dosya eki yükleme (izin verilen tipler)
- [ ] Staff cevabı socket ile anlık gelir
- [ ] Profil değişikliği talebi (PCR) formu gönderilebilir

---

## 5. Admin BO

> Giriş: `admin@wallet.local` / `Admin1234` (veya rol testleri için accounting/support).

### 5.1 Panel (`/admin`)

- [ ] Dashboard istatistik kartları yüklenir
- [ ] Üye / işlem / merchant özet sayıları mantıklı
- [ ] Son aktivite veya grafik bileşenleri hata vermez
- [ ] AI asistan (varsa) soru sorulabilir

### 5.2 Üyeler (`/admin/members`, `/admin/members/:id`)

- [ ] Liste — arama, sayfalama, sıralama
- [ ] Frozen filtresi — sadece dondurulmuşlar (`member.frozen@`)
- [ ] KYC filtresi — verified / pending
- [ ] Satıra tıklayınca detay sayfası
- [ ] Detay — PII maskeli (accounting) vs tam (admin + izin)
- [ ] Bakiye görünümü — maskeli / tam izin ayrımı
- [ ] Manuel bakiye düzeltme (admin)
- [ ] Dondur / aktif et
- [ ] KYC onay / red / beklemeye al
- [ ] Giriş IP geçmişi sekmesi
- [ ] Zorla çıkış (`admin_force_logout_member`)

### 5.3 İşlemler (`/admin/transactions`)

- [ ] İşlem listesi — tip, tutar, durum filtreleri
- [ ] Tam metadata — merchant_ref, external_tx_id (izinli kullanıcı)
- [ ] Satır detayı / expand
- [ ] CSV veya export (izin varsa)
- [ ] Çekim hedefi tam görünüm (`withdrawals:view_destination`)

### 5.4 Destek — Chat (`/admin/chat`)

- [ ] Talep listesi — açık / çözüldü filtreleri
- [ ] Talep üstlenme (claim)
- [ ] Cevap yazma + gönderme
- [ ] Durum güncelleme (resolved vb.)
- [ ] PCR onay / red — profil değişikliği talepleri
- [ ] `member.chat@` thread'i listede görünür

### 5.5 Merchant'lar (`/admin/merchants`, `/admin/merchants/:id`)

- [ ] Ticari liste (`?type=commerce`) — seed commerce merchant'lar
- [ ] Finans liste (`?type=finance`) — seed finance merchant'lar
- [ ] Detay — komisyon, limit, cash pool / settlement bakiye
- [ ] API key maskeli; tam görüntüleme izin ile
- [ ] Secret rotate
- [ ] Pasif / aktif toggle
- [ ] Manuel settlement (commerce)
- [ ] Kullanıcı ekleme (merchant BO erişimi)

### 5.6 Bayiler (`/admin/merchant-children`)

- [ ] Parent altındaki child merchant listesi
- [ ] Toplam settlement özeti
- [ ] Child detaya link
- [ ] API key kolonu — izin ile tam görünüm

### 5.7 Finance Entegrasyon (`/admin/finance-integrations`)

- [ ] Finance merchant entegrasyon paneli
- [ ] Topup init URL / sync URL görüntüleme (izin ile tam)
- [ ] Entegrasyon test butonu
- [ ] Provider method map listesi

### 5.8 İş Ortakları (`/admin/affiliates`) — *flag gerekli*

- [ ] Affiliate listesi
- [ ] Yeni affiliate oluşturma
- [ ] Komisyon modeli seçimi
- [ ] Duraklat / sonlandır
- [ ] İletişim + ödeme bilgisi (hassas izin)

### 5.9 Komisyonlar (`/admin/commissions`)

- [ ] Komisyon raporu — tarih aralığı
- [ ] Merchant kırılımı
- [ ] Export (izin varsa)

### 5.10 Kazanç Dağıtımı (`/admin/profit-share`)

- [ ] Kampanya listesi
- [ ] Yeni kampanya oluşturma
- [ ] Yayınla / taslak
- [ ] Dağıtım geçmişi

### 5.11 Mutabakat (`/admin/reconciliation`)

- [ ] Merchant seçimi + tarih aralığı
- [ ] İşlem vs settlement / cash_pool karşılaştırma
- [ ] Fark (discrepancy) satırları
- [ ] Gross vs net açıklama metni görünür

### 5.12 Sadakat (`/admin/loyalty`)

- [ ] Tier listesi — min puan / ciro eşikleri
- [ ] Tier düzenleme
- [ ] Manuel puan ver / düş
- [ ] Formül / çarpan ayarları

### 5.13 Davetler (`/admin/referrals`)

- [ ] Davet kayıtları listesi
- [ ] Manuel onay / iptal
- [ ] Konfigürasyon — puan / bakiye ödülleri
- [ ] Anti-farming limitleri görünür

### 5.14 Sistem logları (`/admin/system-logs`)

- [ ] Audit log listesi
- [ ] JSON payload detayı (izin ile tam)
- [ ] System log sekmesi
- [ ] Filtre — aksiyon, kullanıcı, tarih

### 5.15 Ayarlar (`/admin/settings`)

- [ ] Genel ayarlar formu
- [ ] `affiliate_system_enabled` toggle
- [ ] Topup / withdraw TTL değerleri
- [ ] Cashout ağ listesi (ticari merchant)
- [ ] Kaydet — değişiklik kalıcı

### 5.16 BO Kullanıcıları (`/admin/users`)

- [ ] Staff listesi — admin / accounting / support
- [ ] Rol ekleme / kaldırma
- [ ] Yeni staff daveti
- [ ] Pasif staff giriş yapamaz

### 5.17 Yetkiler (`/admin/permissions`)

- [ ] Modül erişim matrisi — rol × modül toggle
- [ ] Hassas veri merkezi accordion
- [ ] Kullanıcı override satırı
- [ ] Değişiklik kaydedilir ve menüyü etkiler

### 5.18 Şablonlar (`/admin/templates`)

- [ ] E-posta / bildirim şablon listesi
- [ ] Şablon önizleme
- [ ] Düzenleme + kaydet

### 5.19 Yöntem Tipleri (`/admin/method-types`)

- [ ] Topup / withdraw method kataloğu
- [ ] Yeni tip ekleme
- [ ] Aktif / pasif toggle
- [ ] Withdraw ETA düzenleme

### 5.20 Merchant başvuruları (`/admin/onboarding`)

- [ ] Başvuru listesi — pending / approved / rejected sekmeleri
- [ ] Başvuru detay — şirket bilgileri
- [ ] Onay → merchant oluşturulur
- [ ] Red + sebep / bilgi isteme

---

## 6. Merchant BO

> Giriş: `merchant.owner@` (commerce standalone), `merchant.parent@` (parent+child), `merchant.finance@` (finance) — şifre `Test1234!`. Otomasyon: `e2e/merchant/*.spec.ts` + smoke `bo.merchant-*`.

### 6.1 Dashboard (`/merchant`)

- [ ] Merchant adı + tip badge (Ticari / Finans)
- [ ] Bakiye / settlement veya cash pool özeti
- [ ] Son hareketler tablosu
- [ ] Tarih filtresi
- [ ] Finans merchant — cash pool log; Ticari — settlement log

### 6.2 Üye işlemleri (`/merchant/transactions`)

- [ ] İşlem listesi — sadece kendi merchant scope
- [ ] Tip filtresi (spend, merchant_credit vb.)
- [ ] Başka merchant'ın işlemi **görünmez**
- [ ] Üye PII tam görünüm **yok** (hard rule §13)
- [ ] Export veya PDF (varsa)

### 6.3 Tahsilat (`/merchant/cashout`)

- [ ] Cashout yöntemi seçimi (seed cashout methods)
- [ ] Talep oluşturma (owner veya `can_cashout_create`)
- [ ] Min / max tutar validasyonu
- [ ] Açık talep listesi
- [ ] `merchant.readonly@` — oluşturma butonu devre dışı

### 6.4 Settlement defteri (`/merchant/settlement`)

- [ ] Ticari merchant — settlement log listesi
- [ ] Sebep etiketleri Türkçe (`pay_to_merchant`, `manual_settlement` vb.)
- [ ] Tarih aralığı filtresi
- [ ] PDF export / yazdır
- [ ] Finans merchant — **Kasa Defteri** (`merchant_cash_pool_log` via REST); API docs menüde yok
- [ ] Parent merchant — `/merchant/children` bayi listesi + settlement filtre

### 6.5 Bayiler (`/merchant/children`) — *owner only*

- [ ] Child merchant listesi (parent hesabıyla)
- [ ] Child API key maskeli
- [ ] Child bakiye özeti
- [ ] Standalone merchant — boş liste veya menü yok

### 6.6 API çağrıları (`/merchant/api-calls`)

- [ ] Son API çağrı logları
- [ ] HTTP status + endpoint
- [ ] Hata kodu filtreleme
- [ ] Request/response özet (PII maskeli)

### 6.7 Kullanıcılar (`/merchant/users`) — *owner only*

- [ ] Merchant kullanıcı listesi
- [ ] Davet — e-posta + rol (accountant / read_only)
- [ ] Rol değiştirme
- [ ] Aktif / pasif toggle
- [ ] `can_cashout_create` toggle

### 6.8 Yetkiler (`/merchant/permissions`) — *owner only*

- [ ] Kullanıcı bazlı override listesi
- [ ] İzin ekleme / kaldırma
- [ ] Değişiklik merchant kullanıcı erişimini etkiler

### 6.9 Ayarlar (`/merchant/settings`) — *owner only*

- [ ] IP whitelist düzenleme + kaydet
- [ ] Webhook URL kaydet
- [ ] Signing secret rotate — yeni secret bir kez gösterilir
- [ ] `merchant.accountant@` — sayfa erişilemez (403 / redirect)

### 6.10 Profil (`/merchant/profile`)

- [ ] Kullanıcı adı / e-posta
- [ ] Merchant rol badge
- [ ] Son giriş zamanı
- [ ] Parola değiştirme linki veya form

### 6.11 API dokümantasyonu (`/merchant/api-docs`) — *commerce only*

- [ ] Entegrasyon kılavuzu linkleri (TR / EN / quickstart)
- [ ] Markdown indirme veya yeni sekmede açılma
- [ ] Finans merchant ile menü **gizli**

---

## 7. Çapraz kontroller (regresyon)

- [ ] Üye yüzeyinde hiçbir yerde merchant adı görünmez
- [ ] Üye yüzeyinde komisyon / fee satırı yok
- [ ] Staff oturum değişikliği (rol / MFA) → tüm token'lar revoke
- [ ] CSRF — cookie auth POST istekleri `X-CSRF-Token` ile çalışır
- [ ] 404 — bilinmeyen rota `NotFound` sayfası
- [ ] Subdomain / rol yönlendirme — staff `/admin`, merchant `/merchant`, üye `/`
- [ ] i18n — TR varsayılan; EN geçişinde layout bozulmaz
- [ ] Mobil viewport (375px) — alt tab bar ve chat widget taşmaz

---

## 8. Test oturumu kaydı

| Alan | Değer |
|------|-------|
| Tarih | |
| Test eden | |
| Git commit | `git rev-parse --short HEAD` |
| `test:seed` çalıştırıldı mı? | |
| `smoke-all` sonucu | PASS / FAIL |
| Açık bulgular | |

---

*Son güncelleme: 2026-05-28 · Option B — manuel checklist*
