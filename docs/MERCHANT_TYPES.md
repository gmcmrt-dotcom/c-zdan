# Merchant Tipleri ve Finansal Kavramlar Referansı

> Bu dokümana **commerce** ve **finance** merchant tiplerinin hangi finansal kavramı, hangi tabloyu, hangi akışta kullandığı referansıdır. UI yanıltıcı olmasın diye bakıldı.

---

## Entegrasyon sorumluluğu (sabit kural)

| Tip | Kim entegre eder? | Dış API kılavuzu |
|-----|-------------------|------------------|
| **commerce** | **Karşı taraf** (mağaza / e-ticaret teknik ekibi) | Evet — `POST /merchant-api/charge`, `POST /merchant-api/credit` ([kılavuz](COMMERCE_MERCHANT_API_GUIDE.md)) |
| **finance** | **Her zaman Wallet ekibi** (biz) | Hayır — merchant’a self-service entegrasyon dokümanı verilmez |

- Ticari merchant: API key + HMAC `signing_secret` alır, kendi backend’inden Akış A/B'yi `/merchant-api/*` üzerinden çağırır; Merchant BO’da **API Dokümantasyonu** sayfası var.
- Finance merchant: `topup_init_url`, callback URL, kasa sync vb. **admin BO** (`/admin/finance-integrations`) üzerinden Wallet tarafından kurulur; sağlayıcıyla teknik entegrasyon bizde kalır. Callback'ler Aninda ailesi için `POST /webhooks/aninda/deposit`, `POST /webhooks/aninda/withdraw`, generic HMAC merchant'lar için `POST /merchant-api/topup-callback`, `POST /merchant-api/withdraw-callback`.

---

## İki merchant tipi

### `commerce` — Mağaza / e-ticaret merchant'ı

- Kullanım: üye ödeme yapar veya merchant'taki bakiyesini cüzdana çeker.
- Akış A (`spend`) — üye merchant'a ödeme yapar
- Akış B (`merchant_credit`) — üye merchant'taki kendi bakiyesini cüzdana transfer eder

### `finance` — Finans sağlayıcı / ödeme servisi

- Kullanım: üye dış dünyadan para yatırır veya çeker.
- Akış C (`topup`) — üye finance üzerinden cüzdana para yatırır
- Akış D (`merchant_withdraw`) — üye cüzdandan finance üzerinden para çeker

---

## Finansal kavramlar — hangi merchant kullanır?

| Kavram | Tablo / Kolon | commerce | finance | Açıklama |
|--------|---------------|----------|---------|----------|
| **`balance`** | `merchants.balance` | ✅ aktif | ⚠️ var ama kullanılmaz | Settlement defteri pozisyonu (signed). Negatif: merchant bize borçlu. |
| **`credit_limit`** | `merchants.credit_limit` | ✅ aktif | ❌ kullanılmaz | Akış B borç tavanı — defter yetersizse negatife inebilme limiti; çekilebilir bakiye değildir. |
| **`cash_pool`** | `merchants.cash_pool` | ❌ NULL | ✅ aktif | Finance merchant'ın bize karşı tuttuğu net pozisyon. Topup arttırır, withdraw azaltır. |
| **`cash_pool_overdraft_enabled`** | aynı tablo | ❌ — | ✅ aktif | Finance kasası eksiye düşmesine izin verilsin mi (toggle). |
| **`cash_pool_overdraft_limit`** | aynı tablo | ❌ — | ✅ aktif | Aktifse kasa en fazla `-overdraft_limit`'e iner. |
| **`commission_pct`** | `merchants.commission_pct` | ✅ Akış A komisyonu | ✅ legacy fallback | Genel komisyon oranı. |
| **`deposit_commission_pct`** | aynı tablo | ❌ — | ✅ aktif | Akış C (topup) komisyonu. |
| **`withdraw_commission_pct`** | aynı tablo | ❌ — | ✅ aktif | Akış D (withdraw) komisyonu. |
| **`merchant_settlement_log`** | tablo | ✅ aktif | ⚠️ kullanılmaz | Balance hareketleri (Akış B credit, manuel settlement, credit_limit_change). |
| **`merchant_cash_pool_log`** | tablo | ❌ — | ✅ aktif | Kasa hareketleri (topup_received, withdraw_paid, manual_in/out, reverted). |

---

## Senaryolar

> **Terminoloji**:
> - "Bizim **kasamıza girer**" — komisyon kazancımız (üyeden veya merchant'tan kestiğimiz pay sistem geliri olur)
> - "Merchant **bizde alacaklı**" — settlement defterinde merchant'ın lehine bakiye, ileride biz merchant'a havale göndereceğiz
> - "Merchant'ın **bizdeki alacağı azalır**" — settlement defterindeki lehte bakiyeden düşülür
> - "Üyenin **bizdeki parası merchanta transfer edilir**" — üyenin cüzdanından düşen tutar, defterde merchant lehine yazılır (gerçek nakit değişimi mutabakat zamanı)

### Akış A — `spend` (commerce)

Üye QR ile merchant'ta ödeme yapar:
- `transactions.type = 'spend'`, `amount = gross`, `fee = komisyon`
- **Üye balance** −= gross
- **Komisyon** (`commission_pct × gross + fixed_fee`) **bizim kasamıza girer** (`commission_direction='earn'`, `transactions.fee` + metadata)
- **Merchant balance** += gross → **merchant bizde alacaklı** (full gross; komisyon settlement zamanı netleştirilir)
- `merchant_settlement_log`'a `pay_to_merchant` kaydı

**Akışta:** üye ödeme yapar, merchant bakiyesi artar, üyenin bizdeki parası merchanta transfer edilmiş olur (defterde), biz komisyon alırız.

### Akış B — `merchant_credit` (commerce)

Merchant kendi sisteminde müşterinin alacağı olduğunu görür ve cüzdana transfer eder:
- `transactions.type = 'merchant_credit'`
- **Üye balance** += amount (cüzdan dolar)
- **Merchant balance** −= amount → **merchant'ın bizdeki alacağı azalır** veya **bizdeki borcu artar**
- Kontrol: `balance >= -credit_limit` (DB CHECK constraint) — yetersizse `INSUFFICIENT_MERCHANT_BALANCE`
- `merchant_settlement_log`'a `credit_to_member` kaydı

**Akışta:** merchant kendi bizdeki alacağından (veya borçlanarak) üyenin cüzdanına transfer eder, biz aracılık ederiz.

### Akış C — `topup` (finance)

Üye finance üzerinden cüzdana para yatırır:
- `transactions.type = 'topup'`, `amount = gross`, `fee = komisyon`
- `topup_requests.gross_amount = 1000, provider_cost = 40 (komisyon), net_amount = 960`
- **Üye balance** += gross (cüzdana 1000 yüklenir — hard rule #8: üye gross görür)
- **Komisyon bizim kasamıza girer** (commission_direction='pay'; biz finance'a komisyon ödüyoruz, fakat platform tarafında muhasebede gider olarak görülür)
- **Finance cash_pool** += net (960) → **finance bizde alacaklı** (net; mutabakat zamanı havale alacağız)
- `merchant_cash_pool_log`'a `topup_received` kaydı

**Akışta:** üye finance üzerinden para yatırır, üyenin cüzdanı dolar (gross), finance kasası bizde alacaklı yazar (net), biz komisyon hesabını tutarız.

### Akış D — `merchant_withdraw` (finance)

Üye cüzdandan finance üzerinden para çeker:
- **Routing kontrolü** (`pick_withdraw_merchant`):
  - Overdraft kapalıysa: `cash_pool >= amount`
  - Overdraft açıksa: `cash_pool + overdraft_limit >= amount`
  - Yetersizse bir sonraki uygun finance merchant'a yönlendirilir
- `transactions.type = 'merchant_withdraw'`, `amount = gross`, `fee = withdraw komisyonu`
- **Üye balance** −= gross
- **Finance cash_pool** −= gross → **finance kasasından üyeye ödendi**, kasa eksildi
- `merchant_cash_pool_log`'a `withdraw_paid` kaydı

**Akışta:** üye cüzdandan çekim yapar, üyenin parası finance üzerinden hesabına gönderilir, finance kasası eksilir.

---

## UI gösterim kuralları

### Header stat'ları (`MerchantDetailPage`)

- **commerce** → "Settlement", "Borç tavanı (credit_limit)"
- **finance** → "Settlement" (genelde 0), "Kasa" (`cash_pool` ± renkli) + altında "−Limit: ₺X" (overdraft enabled)

### Tab'lar

| Tab | commerce | finance |
|-----|----------|---------|
| Özet | ✅ | ✅ |
| Yöntemler | ❌ | ✅ |
| Kasa (cash_pool + manuel + finansal özet) | ❌ | ✅ |
| Settlement defteri (balance + credit_limit + manual settlement) | ✅ | ❌ — gizlenir, yanıltıcı |
| Yetkili kullanıcılar | ✅ | ✅ |
| Üye İşlemleri | ✅ | ✅ |
| API Çağrıları | ✅ | ✅ |
| Komisyon | ✅ | ✅ |
| Bilgiler | ✅ | ✅ |

---

## DB tarafında "ortak kolon, mantıken farklı" durumları

Bu kolonlar her iki merchant tipinde de fiziksel olarak var ama **mantıken sadece bir tarafta kullanılır**:

- `credit_limit` (commerce only)
- `cash_pool`, `cash_pool_overdraft_*`, `cash_pool_updated_at` (finance only)
- `deposit_commission_pct`, `withdraw_commission_pct`, `deposit_fixed_fee`, `withdraw_fixed_fee` (finance only — Akış C/D)
- `commission_pct`, `fixed_fee` (commerce only — Akış A; finance için legacy fallback)

Yeni geliştirme yaparken bu ayrımı dikkate al — `merchant_type` koşullu render yap.
