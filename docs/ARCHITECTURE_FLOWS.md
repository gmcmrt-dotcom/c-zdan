# Wallet — Para Akış Mimarisi

> Bu doküman wallet sisteminin **dört ana para akışını** tanımlar.
> Schema, RPC ve API tasarımı bu akışlara göre yapılır. Her geliştirme
> başlamadan önce buradaki sözleşmelere uygunluk doğrulanmalıdır.

---

## 0. Roller

- **Üye (member)** — bizim cüzdan kullanıcımız. Bakiyesi `accounts.balance`'da.
- **Commerce merchant** — üye satın alma yapar (e-ticaret, mağaza). `merchant_type='commerce'`.
- **Finance merchant** — havale / kart / kripto sağlayıcısı. `merchant_type='finance'`.
- **Bizim sistem (cüzdan)** — bütün akışlarda merchant'ın gözünde *bir provider*; üyenin gözünde *cüzdan*.

> Merchant **biz**i provider olarak listeler. Üye merchant ekranında "Wallet ile öde / çek" gibi bir seçenek görür.

### 0.0 Entegrasyon — kim yapar?

| Merchant tipi | Entegrasyon |
|---------------|-------------|
| **commerce** | Karşı taraf (mağaza) kendi sisteminden `merchant-charge` / `merchant-credit` API’lerini kullanır. |
| **finance** | **Yalnızca Wallet ekibi** — havale/kart/kripto init, callback, kasa sync; finance merchant self-service API entegrasyonu yapmaz. |

Detay: `docs/MERCHANT_TYPES.md` (Entegrasyon sorumluluğu).

### 0.1 Commerce merchant hiyerarşisi

Ticari merchant modeli flat olmaktan çıktı; geriye uyumluluk korunarak parent/child destekler:

- `merchant_scope='standalone'`: Eski tekil commerce merchant davranışı.
- `merchant_scope='parent'`: Entegrasyon/grup hesabı. Parent doğrudan Akış A/B muhasebesi yazmaz; altında bayi yönetir.
- `merchant_scope='child'`: A-1/A-2 gibi bayi. Ayrı `merchants` satırıdır, kendi `api_key` + `signing_secret` değerine sahiptir.

Finansal kural: `merchants.balance`, `merchant_settlement_log`, `merchant_api_calls`, `merchant_idempotency` ve transaction `metadata.merchant_id` child merchant bazında kalır. Parent BO ve admin BO toplamları child kayıtlarının aggregate'i olarak hesaplar.

API kural: Parent merchant `merchant-child-upsert` HMAC API'si ile bayilerini bildirir. Sistem her bayi için ayrı credential üretir. Akış A (`merchant-charge`) ve Akış B (`merchant-credit`) çağrıları parent credential ile değil, child credential ile yapılır.

---

### 0.2 Commerce merchant kasa tahsilatı

Commerce merchant pozitif settlement alacağını harici kripto cüzdanına çekebilir:

- Sadece `merchant_type='commerce'` içindir.
- Parent/child modelde tahsilat child/bayi bazında yapılır; parent aggregate çekim yoktur.
- Talep açıldığında `amount + fee` kadar tutar `merchants.cashout_reserved_amount` alanında rezerve edilir. `merchants.balance` success callback gelene kadar değişmez.
- Ödemeci success callback döndüğünde `merchants.balance -= amount + fee`, rezerv serbest kalır ve `merchant_settlement_log.reason='merchant_cashout_paid'` yazılır.
- Ödemeci failed callback döndürürse balance değişmez, rezerv çözülür.
- Yetki: merchant owner her zaman başlatabilir; owner aynı merchant içindeki kullanıcıya `merchant_cashout:create` hassas iznini verebilir.
- Yöntem katalogu: `merchant_cashout_methods` (`USDT_TRC20`, `ETH`, `BTC`, `TRX`) global aktif/pasif + min/max limitlerle BO’dan yönetilir.

---

## 1. AKIŞ A — Üye → Commerce Merchant'a ödeme (spend)

**Senaryo:** Üye bizim cüzdandan bir e-ticaret sitesine ödeme yapacak.

```
Üye uygulamamızda           Commerce merchant'ın sitesinde
─────────────────────       ─────────────────────────────
1. "Ödeme kodu üret"        
2. (Tutar gir → kod alır)   
                            3. Merchant deposit ekranı
                            4. Provider olarak "Wallet" seçer
                            5. Üye kodu yapıştırır
                            6. Merchant API'mize sorgu:
                               POST /merchant-api/charge
                               { code, amount, customer_name, note? }
                               + HMAC headers (x-merchant-key,
                                 x-merchant-timestamp,
                                 x-merchant-signature,
                                 x-merchant-ref)
                            7. Biz doğrularız
                               (consumePaymentCode service)
                            8. SUCCESS → merchant siparişi tamamlar
```

**Bizim taraftaki sonuç:**
- `accounts.balance` üyeden düşer
- `accounts.reserved_balance` rezerve düşer (kod üretiminde rezerv edilmişti)
- `transactions` tablosuna `type='spend'` satır
- Üye **rezerve edilmiş harcama puanını** alır. Cashback şimdilik kapalıdır.
- Merchant **net tutar kadar** bize alacaklı olur: `merchant_settlement += amount - commission_fee`.
  `transactions.amount` gross kalır, `transactions.fee` platform komisyonudur.

**Doğrulama alanları (zorunlu):**
- `code` — payment_codes.code
- `amount` — eşleşmeli (AMOUNT_MISMATCH)
- `customer_name` — eşleşmeli (NAME_MISMATCH). **K5 sonrası `customerName` artık zorunludur** — payment code üretimi sırasında 2-80 karakter "İsim Soyisim" girilir; merchant tarafında case-insensitive normalize ile eşleştirilir. Null customerName ile kod üretilemez.

**Öneri (eklenmesi gereken):**
- `merchant_order_ref` — merchant'ın kendi sipariş ID'si (idempotency için, DUPLICATE_REF kontrolü)
- `currency` — şimdilik TRY sabit ama ileride
- `customer_phone_last4` veya benzeri ek doğrulama (yüksek tutarlarda)
- `request_id` — replay attack önleme (timestamp + nonce)

**Üye tarafı session — O.2 cookie auth:** Üyenin web client'ı tüm `/api/wallet/*` isteklerinde HttpOnly `access_token` cookie kullanır (`credentials: "include"`). Cookie tabanlı oturum login/refresh/mfaChallenge handler'larında `setAuthCookies(res, tokens)` ile yazılır; logout temizler. State-changing isteklerde (POST/PUT/PATCH/DELETE) `X-CSRF-Token` header'ı `csrf_token` cookie'sinden okunup echo edilir.

---

## 2. AKIŞ B — Üye merchant'taki KENDİ bakiyesini cüzdana çekme (member self-transfer)

**Senaryo:** Üyenin commerce merchant'ın kendi sisteminde bir bakiyesi var (kazanç, prim, harcanmamış puan). Üye bu bakiyeyi **kendi** cüzdanına çekmek istiyor. Yani:
- Bu **iade değil** — üye satın aldığı şeyi geri vermiyor.
- Bu **gelen ödeme değil** — merchant üyeye para vermiyor.
- Bu üyenin merchant tarafındaki bakiyesini **kendi cüzdanına transfer**.

```
Üye merchant'ın sitesinde           Bizim taraf
─────────────────────────           ────────────
1. Merchant'ın withdraw/cashout
   ekranında "Wallet'a aktar" seçer
2. Üye cüzdan no + ad/soyad girer
3. Tutar onay → merchant API'mize:
   POST /merchant-api/credit
   { wallet_no, customer_name, amount, note? }
   + HMAC headers (x-merchant-key,
     x-merchant-timestamp,
     x-merchant-signature,
     x-merchant-ref)
                                    4. Biz doğrularız:
                                       • wallet_no var mı?
                                       • profil ad/soyad eşleşmeli
                                         (NAME_MISMATCH)
                                       • merchant aktif + signature OK
                                       • merchant_ref daha önce gelmemişse
                                       • merchant'ın settlement limiti
                                         (`merchants.credit_limit`) yeterli mi?
                                    5. SUCCESS → üyenin bakiyesi artar
                                    6. Merchant settlement hanesinde **bize
                                       borçlanır** (üye fonunu bize devretti,
                                       periyodik settlement ile kapatır)
```

**Bizim taraftaki sonuç:**
- `accounts.balance` ↑
- `transactions` `type='merchant_credit'` (yeni)
- `provider_ledger.direction='credit_to_member'` (yeni)
  → merchant: `-(amount + commission_fee)` / wallet: `+amount`
- `merchants.balance` ↓ gross + komisyon kadar (signed; pozitif=merchant'ın prepaid kasası, negatif=bize borç)
- Üye'ye **puan verilmez** — kendi parasını içeri çekti, kazanç değil.

**Üye için tx açıklaması:** "[Merchant adı]'tan cüzdana transfer" (üye kendi bakiyesini taşıdığını bilir; commerce akışında merchant adı gizlenmez — Akış C/D'deki gizleme kuralı sadece finance routing için).

### Merchant kasa kontrolü (KRİTİK — muhasebesel kural)

Her `credit_member` çağrısında ATOMIK olarak:

1. `SELECT balance, credit_limit FROM merchants WHERE id=$1 FOR UPDATE`
2. **max kapasite = balance + credit_limit** (Akış B borçlanma tavanı; defter yetersizse borç limiti devreye girer — çekilebilir bakiye değildir)
3. IF `amount + commission_fee > available` → `INSUFFICIENT_MERCHANT_BALANCE` döndür, hiçbir şey yazma
4. Aksi halde:
   - `merchants.balance -= (amount + commission_fee)` (negatife düşebilir, ama -credit_limit'in altına asla)
   - `accounts.balance += amount`
   - `provider_ledger` + `transactions` satırı

**Senaryo:**
- Defter bakiyesi 100 ₺, `credit_limit = 0` → Akış B max kapasite 100 ₺
- Üye 200 ₺ transfer isterse → **REJECT** (`INSUFFICIENT_MERCHANT_BALANCE`)
- Aynı senaryoda admin merchant'a `credit_limit = 200` tanımladıysa
  → Akış B max kapasite 100 + 200 = 300 ₺. 200 ₺ geçer; merchant.balance −100 ₺ olur (bize borçlu).

### Merchant başına negatif limit yönetimi
- `merchants.credit_limit numeric NOT NULL DEFAULT 0` — non-negative
- Sadece **admin** rolü değiştirebilir (`merchants:credit_limit` yetkisi)
- Değişiklik audit_log'a yazılır (before/after data)
- Değişiklik yapılırken row-level lock alınır
- Mevcut negatif bakiye yeni limit'in altına düşürmüyorsa anında etkin
- Aksi halde "Mevcut bakiye yeni limit'i aşıyor, önce settlement gerekli" hatası

**Yeni ihtiyaçlar:**
- `tx_type` enum: `merchant_credit`
- `provider_ledger` direction: `credit_to_member`
- `merchants.balance numeric NOT NULL DEFAULT 0` — signed (pozitif=prepaid kasa, negatif=borç)
- `merchants.credit_limit numeric NOT NULL DEFAULT 0` — admin tanımlı borç tavanı
- `merchants.balance + credit_limit` constraint check (negatif bakiye limit'in altına inemez — DB CHECK)
- HMAC signature middleware (BAD_SIGNATURE)
- `merchant_ref` UNIQUE INDEX (idempotency)
- Audit: `credit_limit` değişiklikleri, kasa hareketleri, settlement işlemleri

**Zorunlu payload alanları:**
- `wallet_no` (üyenin members.member_no'su)
- `customer_name` (case-insensitive normalize)
- `amount` (numeric, > 0)
- `merchant_ref` — idempotency
- `signature` — HMAC-SHA256
- `timestamp` — ± 5 dk

**Öneri ek alanlar:**
- `member_phone_last4` — yüksek tutarlarda ek doğrulama
- `merchant_user_id` — merchant'ın kendi tarafındaki üye ID (audit izi)
- `transfer_reason` — merchant'ın etiketi ("kazanç çekimi", "prim", vs. — sadece görüntü)

---

## 3. AKIŞ C — Üye **Para Yatır** → Dış finans merchant'ı (topup)

**Senaryo:** Üye cüzdanına para yüklemek istiyor. Bizim sistemimizden başlar, dış finans merchant'ının domain'ine yönlendirilir, ödemeyi orada tamamlar, callback ile bize döner.

```
Üye uygulamamızda
─────────────────────
1. "Para Yatır" → AKTİF YÖNTEM TİPLERİ listesi
   (havale, kart, kripto, vs. — TYPE bazında, merchant adı YOK)
2. Üye yöntem seçer: "havale"
3. Biz arkada (BO ayarına göre) routing yaparız:
   • Bu type için aktif merchant'ları çek
   • BO'da admin'in tanımladığı **% ağırlıklarına** göre bir merchant seç
     (round-robin değil, ağırlıklı load balancing)
   • Merchant'ın günlük cap'i / per-tx limiti uygunsa devam
4. Biz seçilen merchant'a init API call yaparız:
   POST <merchant_init_url>/start
   { internal_ref, amount, customer_name, return_url, callback_url }
5. Merchant cevabında deposit redirect URL'i döner.
6. **Üye o URL'e yönlendirilir — bizim domain'den ÇIKAR.**
   (yeni sekme veya tam yönlendirme; üye merchant'ın domain'inde
    ödemeyi tamamlar; biz ödeme verisini GÖRMEYİZ)
7. Üye merchant ekranında işlemi bitirir → merchant kendi `return_url`
   ile üyeyi bizim "işlem durumu" sayfamıza geri gönderir.
8. Asıl finalizasyon callback ile gelir:
   POST /merchant-api/topup-callback
   (Aninda ailesi için: POST /webhooks/aninda/deposit)
   { internal_ref, merchant_ref, amount, status,
     customer_name?, payment_method_detail?,
     external_tx_id?, failure_reason?, note? }
9. Biz doğrular + finalizeTopupCallback service'i çağırır
10. Üye bakiyesi yükselir; provider komisyonu sistem maliyeti olarak
    `provider_ledger`'a düşer.
```

**Routing kararı (BO'dan ayarlanır):**
```
payment_routing_rules
─────────────────────
method_type | merchant_id | weight_pct | is_active
'havale'    | M1          | 70         | true
'havale'    | M2          | 30         | true
'kart'      | M3          | 100        | true
```
Toplam % 100 olmalı (BO validation).

**Anti-leak garantileri:**
- Üyeye merchant adı/ID'si gösterilmez (sadece "Havale ile yatır" gibi tip)
- Routing kararı **server-side**; client URL'de merchant ID görmez
- `internal_ref` bizim ürettiğimiz uuid → merchant'ın `merchant_ref`i ile pair
- Callback HMAC ile imzalanır + signature doğrulanmazsa drop
- Üye dışarı çıkar ama BO loglarında redirect URL + zaman + IP saklanır

**Geri dönüş kullanıcı deneyimi:**
- `return_url` → bizim "İşlem durumu" sayfamız (`/topup/status?ref=<internal_ref>`)
- Sayfa polling ile callback'in gelip gelmediğini kontrol eder
- Callback gelene kadar "İşleminiz onaylanıyor…" görünür
- Timeout (örn. 10 dk) sonrası "Geç gelirse otomatik yatırılacak" mesajı
- Background cron 24 saat sonra hala beklemede olan tx'leri admin'e flag

**Sonuç:**
- `accounts.balance` artar (gross = net, üyeye komisyon yok)
- `transactions` `type='topup'` satır
- `provider_ledger.direction='deposit'` satır (merchant'ın bize yatırdığı). **Batch L sonrası:** `provider_method_id` `services/provider-ledger.service.ts::resolveProviderMethodId` üzerinden `merchant_provider_method_map` (mig 0012) tablosundan çözülür. Eşleşme yoksa `writeProviderLedger` `logger.warn` ile SKIP yapar (cash_pool_log + settlement_log reconcile edilebilir kalır); admin RPC'leri `admin_set_provider_method_map` / `admin_list_provider_method_map` / `admin_disable_provider_method_map` ile mapping eklenir/silinir.
- Finance merchant kasasına işlenen tutar `amount - commission_fee`; provider komisyonu sistem maliyeti olarak kayıt
- Üye para yatırmadan puan kazanmaz; puan ticari iş yeri ödemelerinde kazanılır.

**Zorunlu doğrulama alanları (callback):**
- `merchant_ref` — idempotency
- `amount` — net tutar
- `customer_name` — normalize edip karşılaştır
- `status` — 'success' / 'failed' / 'pending'
- `signature` — HMAC
- `timestamp` — STALE_TIMESTAMP

**Öneri (eklenmesi gereken):**
- `original_amount` (kur değişimi varsa)
- `provider_fee` (merchant'ın aldığı komisyon — provider_ledger için)
- `payment_method_detail` (örn: "Garanti BBVA havale", "Bitcoin BTC", BO görsün)
- `merchant_session_id` — debug ve refund izi için
- `failure_reason` — status='failed' geldiğinde

---

## 4. AKIŞ D — Üye **Para Çek** → Dış finans merchant'ı (withdraw)

**Senaryo:** Üye cüzdanından dış hesabına para çekecek. Biz arkada merchant kasalarını yönetip uygun olana yönlendiririz.

```
Üye uygulamamızda
─────────────────────
1. "Para Çek" → AKTİF YÖNTEM TİPLERİ listesi
   (üye sadece havale/kripto vs. görür, merchant adı YOK)
2. Üye tutar + yöntem seçer
3. Biz arkada **kasa kontrolü + öncelik** yaparız:
   a. O type'ta aktif merchant'lar
   b. **Kasa müsait olanlar** (merchants.available_balance >= amount)
   c. Müsaitler arasından **çekim süresi en hızlı** olanı seç
      (ölçülen `merchants.avg_withdraw_seconds` performans metriği)
   d. Eşitlikte: yük dengeleme (en az tx alan)
4. Üyenin tutarı **rezerve edilir** (accounts.reserved_balance += amount)
   transactions.status = 'pending'
5. Merchant'a API push:
   POST <merchant_callback>/withdraw
   { wallet_no, customer_name, amount, merchant_ref, signature }
6. Merchant ya senkron ya callback ile cevap döner:
   • SUCCESS → bakiye düşer, rezerve kalkar, transaction.status='completed'
   • FAILED  → rezerve serbest, transaction.status='failed', üyeye notify
   • TIMEOUT → cron retries; timeout aşılırsa farklı merchant'a route
```

**Kasa yönetim (DİKKAT — iki ayrı bakiye var):**
```
merchants
─────────
... + balance numeric        -- bizim defterimizdeki merchant'ın net pozisyonu
                                (signed; akış B/D ortak — settlement defteri)
    + credit_limit numeric   -- merchant'ın negatife inebilme tavanı (admin)
    + cash_pool numeric      -- merchant'ın KENDİ banka hesabındaki nakit
                                (akış D'ye özel; cron ile sync; finance only)
    + cash_pool_updated_at timestamptz
    + avg_withdraw_seconds int
    + last_failure_at timestamptz
    + failure_rate_pct numeric
```

> **Önemli ayrım:**
> • `balance` → bizim defterimizdeki settlement pozisyonu (Akış B'de düşer, Akış D'de artar)
> • `cash_pool` → merchant'ın kendi banka kasasındaki nakit (Akış D'de "üyeye havale yapabilecek mi?" kontrolü için kullanılır; merchant API'sinden ya da cron sync ile gelir)

**Routing önceliği:**
1. `is_active = true`
2. `cash_pool >= amount` (merchant gerçekten ödeme yapabilecek mi?)
3. `cash_pool_updated_at >= now() - interval '15 min'` (stale değilse)
4. `failure_rate_pct < 5%` (son 24 saat)
5. `daily_limit` ve `per_tx_limit` aşımı yoksa
6. ORDER BY `avg_withdraw_seconds ASC, last_used_at ASC`
7. Tek bir merchant döner (LIMIT 1)

**Akış D settlement etkisi:**
- Biz merchant'a push ettiğimizde `merchant.balance += amount` (merchant bizden alacaklı oldu)
- Merchant fiili havaleyi yapıp success döndüğünde de aynı (alacak hesabını biz settlement ile kapatırız)
- Failed/timeout'ta: rezerve serbest, balance değişmez

**Rezerve garantileri:**
- Merchant'tan SUCCESS gelene kadar tutar `reserved_balance`'da
- Cron her N dakikada timeout'u geçen tx'leri kontrol eder
- Timeout aşılırsa: ya retry başka merchant'a ya admin'e suggestion

**Sonuç (success):**
- `accounts.balance` düşer, `reserved_balance` düşer
- `transactions` `type='merchant_withdraw'` `status='completed'`
- `provider_ledger.direction='withdraw'` satır (bizim merchant'tan çektiğimiz). **Batch L sonrası:** Topup ile aynı resolver yolu — `merchant_provider_method_map`'dan `provider_method_id` çözülür, eşleşme yoksa SKIP + warn (cash_pool ve settlement defterleri reconcile edilebilir kalır).
- Finance merchant kasasına işlenen çıkış `amount - commission_fee`; `transactions.amount` gross, `transactions.fee` komisyon
- Withdraw progressive penalty puanı uygulanır (loyalty v2)

**Zorunlu doğrulama (callback):**
- `merchant_ref` — bizim push ettiğimiz ref ile eşleşmeli
- `status` — 'success' / 'failed'
- `external_tx_id` — merchant'ın kendi tarafındaki ID
- `signature` — HMAC
- `timestamp` — STALE_TIMESTAMP

**Öneri:**
- `payout_destination_masked` — örn: "TR12 **** **** **** 1234" (audit için)
- `executed_at` — merchant'ın gerçek transfer zamanı
- `failure_code` — failed olursa standart kod (INSUFFICIENT_PROVIDER_BALANCE vb.)

---

## 4.5. Merchant Settlement (her merchant için ortak defter)

**`merchants.balance` — signed, atomik, FOR UPDATE ile lock:**
- `+` → merchant bize prepaid yatırmış (alacaklı)
- `0` → nötr
- `-` → merchant bize borçlu (`outstanding_credit = abs(balance)`)

**Hareket eden işlemler:**
| Akış | balance etkisi | Anlam |
|------|----------------|-------|
| B (credit_to_member) | `-= amount` | Üye merchant'taki bakiyesini bize çekti; merchant bize ödemeli |
| D (push_to_merchant) | `+= amount` | Biz merchant'a havale push ettik; merchant bizden alacaklı |
| Manuel settlement (admin) | `+= deposit` veya `-= withdrawal` | Banka transferi ile defter kapatılır |

**Constraint:**
```sql
ALTER TABLE merchants
  ADD CONSTRAINT chk_balance_within_credit
  CHECK (balance >= -credit_limit);
```

**Her hareket için:**
- `merchant_settlement_log` tablosuna satır (atomik, append-only)
  - `id, merchant_id, change_amount, balance_before, balance_after,
     reason, reference_type, reference_id, created_at, created_by`
- Provider_ledger'dan ayrı tutmak şart — merchant'lar burayı görür, kullanıcı görmez

---

## 4.6. Merchant Portal (Merchant BO)

**Amaç:** Her merchant'a kendi finansal işlemlerini görüp yönetebileceği ayrı bir BO sun.

**Subdomain:** `merchant.wallet-domain.com` veya path-based `/merchant/*`
(Üye paneli ve admin BO ile aynı oturum sistemini paylaşmaz — ayrı login.)

**Yetkilendirme:**
- `merchant_users` tablosu (merchant başına 1+ kullanıcı; `role` = `owner` / `accountant` / `read_only`)
- Login: aynı `users` tablosundaki kayıt, fakat staff/admin/affiliate JWT'lerinden ayrı bir `requireMerchant` middleware'i tarafından kontrol edilir (`apps/api/src/middleware/auth.ts`)
- Scope: her merchant BO sorgusu service katmanında `req.merchantUserCtx.merchantId` ile filtrelenir; Postgres RLS yoktur

**Ekranlar (v1):**
1. **Dashboard** — bugünkü hacim, settlement balance, açık tx sayısı, kasa durumu
2. **Hesap defteri** (`merchant_settlement_log`) — tüm balance hareketleri
3. **API çağrıları** (`merchant_api_calls`) — gelen/giden tüm istekler, response code, duration
4. **Üye işlemleri** — bu merchant'a gelen spend / bu merchant'tan çıkan credit
5. **Settlement** — açık borç görüntüsü, banka havalesi yapıldığında "ödedim" bildirimi
6. **API anahtarları** — kendi anahtarını rotate edebilir; secret bir kez gösterilir
7. **Webhook ayarları** — callback URL'i, IP whitelist, signature secret
8. **Onboarding & doküman** — KYB belgeleri, vergi numarası

**Görmediği şeyler:**
- Diğer merchant'ların verileri
- Üye PII'si (sadece anonim ID + amount)
- Bizim provider_ledger detayları
- Bizim BO ayarları, BO kullanıcıları

**Veri izolasyon örneği (service katmanı):**
```ts
// apps/api/src/services/merchant/self.service.ts
const merchantId = ctx.merchantUserCtx.merchantId;
const rows = await db
  .select()
  .from(merchantSettlementLog)
  .where(eq(merchantSettlementLog.merchantId, merchantId))
  .orderBy(desc(merchantSettlementLog.createdAt));
```

`requireMerchant` middleware (`apps/api/src/middleware/auth.ts`) hidrate eder; servis fonksiyonları `merchantId` argümanı almadan asla sorgu çekmez.

---

## 5. Kritik Garantiler (tüm akışlarda)

### Idempotency
Her merchant API call için `merchant_ref` veya `external_ref` zorunlu. Aynı ref ikinci kez gelirse → DUPLICATE_REF döneriz, **eylemi tekrarlamayız**.

### Signature
Her merchant call HMAC-SHA256 ile imzalanır. `api_secret` her merchant için unique.
```
signature = HMAC_SHA256(api_secret, timestamp + ':' + canonicalized_body)
```

### Timestamp
İstek timestamp'i ± 5 dakikalık pencerede olmalı (replay attack koruması).

### Audit
Her merchant call `merchant_api_calls` tablosuna log'lanır:
- endpoint, method, ip, payload_hash, response_code, duration_ms
- Bu kayıt **kullanıcı görmez** ama BO'da arama/sorgulanabilir.

### Webhook'lar (callback'ler)
- Her başarısız callback retry edilir (exponential backoff)
- Maks 5 deneme sonrası dead-letter queue → admin'e suggestion

### Refund
**Merchant API'lerinde refund endpoint'i YOKTUR.** Bunun yerine:
- Round-trip farming detection (`scheduler.ts` içindeki `scan_round_trip_farming` job)
- Şüpheli pattern'lerde admin'e suggestion
- Manuel düzeltme: admin merchant detayından `adjust_merchant_balance` (RPC shim üzerinden) veya doğrudan ledger düzeltme

---

## 6. Akış-Tablo Eşleşmesi

| Akış | `tx_type` | Yan ledger | Bakiye etkisi | Borç / settlement |
|------|-----------|------------|---------------|-------------------|
| A. Spend (commerce'a ödeme) | `spend` | `merchant_settlement_log` (`pay_to_merchant`) | `accounts.balance` ↓ | Biz → commerce merchant net alacaklı (`amount - fee`) |
| B. Self-transfer (üye merchant'taki bakiyesini bize çeker) | `merchant_credit` | `merchant_settlement_log` (`credit_to_member`) | `accounts.balance` ↑ | Commerce merchant → bize settlement borcu (`amount + fee`) |
| C. Topup (havale/kart/kripto) | `topup` | `merchant_cash_pool_log` (`topup_received`) + `provider_ledger` (`deposit`) | `accounts.balance` ↑ | Finance merchant → bize alacaklı (net) |
| D. Withdraw (havale/kart/kripto) | `merchant_withdraw` | `merchant_cash_pool_log` (`withdraw_paid`) + `provider_ledger` (`withdraw`) | `accounts.balance` ↓ | Biz → finance merchant ödedi (kasa eksildi) |

---

## 7. Uygulama referansı

| Konu | Servis / route |
|------|----------------|
| Public merchant API (HMAC) | `apps/api/src/routes/merchant-public.routes.ts` (`/merchant-api/charge`, `/merchant-api/credit`, `/merchant-api/topup-callback`, `/merchant-api/withdraw-callback`) |
| HMAC + idempotency middleware | `apps/api/src/lib/merchant-hmac.ts` |
| Akış A | `apps/api/src/services/payment-code.service.ts` |
| Akış B | `apps/api/src/services/merchant-credit.service.ts` |
| Akış C | `apps/api/src/services/topup-init.service.ts` + `topup.service.ts` |
| Akış D | `apps/api/src/services/withdraw.service.ts` |
| Aninda finance entegrasyonu (deposit + withdraw) | `apps/api/src/integrations/aninda.ts` + `apps/api/src/routes/webhooks.routes.ts` |
| Cron scheduler | `apps/api/src/workers/scheduler.ts` |
| Drizzle şema | `apps/api/src/db/schema/transactions.ts`, `merchants.ts`, `topup-withdraw.ts` |
