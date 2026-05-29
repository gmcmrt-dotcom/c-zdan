# Ticari Merchant API — Entegrasyon Kılavuzu

> **Kime?** E-ticaret / mağaza entegrasyonu yapan **ticari (commerce)** merchant teknik ekibi — **entegrasyonu karşı taraf (siz) yaparsınız.**  
> **Ne değil?** **Finance** merchant (havale/kart/kripto yatır-çek): bu akışları **her zaman Wallet ekibi** entegre eder; finance sağlayıcılarına bu kılavuz veya benzeri self-service API dokümanı verilmez.

---

## 1. Özet — Wallet sizin için ne yapar?

Üyeler **Yıldız Cüzdan** uygulamasında bakiye tutar. Sizin sitenizde iki tip işlem vardır:

| Akış | Ne olur? | Sizin API çağrınız |
|------|----------|-------------------|
| **A — Ödeme** | Üye cüzdandan size ödeme yapar (QR / ödeme kodu) | `merchant-charge` |
| **B — Cüzdana aktarım** | Üyenin **sizin sistemdeki** bakiyesini kendi cüzdanına çeker | `merchant-credit` |

**Önemli:**
- Akış B **iade değildir** — üye satın aldığını geri vermiyor; kendi kazancını cüzdana alıyor.
- Üyeye **komisyon yansıtılmaz**; komisyon sizinle Wallet arasında muhasebe kaydıdır.
- Üye ekranında **sizin mağaza adınız görünmez** (sadece “Ödeme”, “Cüzdana giriş” gibi genel ifadeler).

---

## 2. Başlamadan önce

### 2.1 Size verilen bilgiler

Wallet ekibi kurulum sonrası şunları iletir:

| Bilgi | Açıklama |
|-------|----------|
| **API Base URL** | `https://wallet.example.com/merchant-api` (kurulumdaki gerçek host + sabit `/merchant-api` path) |
| **API Key** | `x-merchant-key` header’ında — kimlik |
| **Signing Secret** | HMAC imzası için — **kimseyle paylaşmayın** |
| **IP whitelist** | (varsa) sadece bu IP’lerden istek kabul edilir |

### 2.2 Çok şubeli / bayi yapısı (parent + child)

Büyük entegrasyonlarda:

- **Parent** = ana hesap (grup). Bayi tanımlar, secret’ı sizde kalır.
- **Child (bayi)** = her mağaza/şube. **Kendi API key** ile işlem yapar; imza **parent secret** ile hesaplanır.

```
Parent merchant
  ├── signing_secret  ← HMAC hep bununla
  ├── IP whitelist    ← Tüm bayiler için geçerli
  └── Child: Mağaza A  → api_key_A  (işlem bu key ile)
      Child: Mağaza B  → api_key_B
```

Akış A ve B çağrılarında **bayinin API key’ini** kullanın; imzayı **parent signing secret** ile üretin.

Bayi kaydı: parent hesabı `merchant-child-upsert` endpoint’ini kullanır (Bölüm 6).

---

## 3. Ortak kurallar (tüm istekler)

### 3.1 HTTP

- Yöntem: **POST**
- `Content-Type: application/json`
- Body: UTF-8 JSON

### 3.2 Zorunlu header’lar

| Header | Zorunlu | Açıklama |
|--------|---------|----------|
| `x-merchant-key` | Evet | Size verilen API key |
| `x-merchant-timestamp` | Evet | Unix saniye (ör. `1716192000`) |
| `x-merchant-signature` | Evet | HMAC-SHA256 hex (aşağıda) |
| `x-merchant-ref` | Önerilir | Sizin işlem ID’niz — **aynı ref tekrar gelirse aynı cevap döner** |

### 3.3 İmza nasıl hesaplanır?

```
message = timestamp + ":" + body
signature = HMAC_SHA256_HEX(signing_secret, message)
```

- `timestamp` = header’daki değerle **aynı** string olmalı.
- `body` = ham JSON metni (boşluk/format değişirse imza bozulur).
- Saat farkı en fazla **±5 dakika**; aksi halde `STALE_TIMESTAMP`.

### 3.4 Idempotency (çift tıklama koruması)

Aynı `x-merchant-ref` ile ikinci istek:

- İşlem **tekrar yapılmaz**.
- İlk başarılı/başarısız cevap **aynı şekilde** döner.

Her sipariş / transfer için **benzersiz** ref kullanın (ör. `ORDER-20260520-88421`).

### 3.5 Başarılı cevap ortak alanlar

```json
{
  "success": true,
  "transaction_id": "uuid-internal",
  "wallet_tx_no": "P-20260520-000123",
  "merchant_ref": "ORDER-12345"
}
```

| Alan | Anlam |
|------|--------|
| `wallet_tx_no` | İnsan okur işlem no — destekte kullanın |
| `transaction_id` | Sistem içi UUID |
| `merchant_ref` | Sizin gönderdiğiniz ref |

---

## 4. Akış A — Üye ödemesi (merchant-charge)

### 4.1 Kullanıcı deneyimi

1. Üye Wallet uygulamasında **ödeme kodu** üretir (tutar + ad soyad sabitlenir).
2. Sizin ödeme ekranınızda kodu girer.
3. Siz API ile kodu **tüketirsiniz** → bakiye düşer, sipariş tamamlanır.

### 4.2 Endpoint

```
POST /merchant-api/charge
```

### 4.3 İstek gövdesi

```json
{
  "code": "AB12CD34",
  "amount": 250.00,
  "customer_name": "Ali Yılmaz",
  "note": "Sipariş #88421"
}
```

| Alan | Zorunlu | Kurallar |
|------|---------|----------|
| `code` | Evet | 8 karakter, üyenin ürettiği kod |
| `amount` | Evet | Kod üretilirken belirlenen tutarla **birebir** aynı (TRY) |
| `customer_name` | Evet | Kod üretilirken yazılan ad soyadla **aynı** (büyük/küçük harf normalize edilir) |
| `note` | Hayır | En fazla 500 karakter — sadece sizin panelinizde görünür |

### 4.4 Başarılı cevap

```json
{
  "success": true,
  "transaction_id": "…",
  "wallet_tx_no": "P-20260520-000123",
  "merchant_ref": "ORDER-88421"
}
```

### 4.5 Sık hatalar

| Kod | Anlam | Ne yapmalı? |
|-----|--------|-------------|
| `CODE_NOT_FOUND` | Kod yok | Kodu kontrol et |
| `CODE_EXPIRED` | Süre dolmuş | Üyeden yeni kod iste |
| `CODE_USED` | Kod kullanılmış | Siparişi zaten tamamlanmış say |
| `AMOUNT_MISMATCH` | Tutar uyuşmuyor | `amount` = kod tutarı |
| `NAME_MISMATCH` | İsim uyuşmuyor | `customer_name` = kod ismi |
| `INSUFFICIENT_FUNDS` | Üye bakiyesi yetmez | Ödeme reddedilir |
| `LIMIT_EXCEEDED` | İşlem limiti aşıldı | BO’daki `per_tx_limit` |
| `DUPLICATE_REF` | Aynı ref farklı body | Ref’i değiştir veya cache cevabını kullan |

---

## 5. Akış B — Üye bakiyesini cüzdana aktarma (merchant-credit)

### 5.1 Kullanıcı deneyimi

1. Üyenin **sizin platformunuzda** çekilebilir bakiyesi vardır (kazanç, bonus vb.).
2. “Wallet’a aktar” seçer; **cüzdan numarası** + **ad soyad** + tutar girer.
3. Siz API çağırırsınız → üye cüzdan bakiyesi artar.

### 5.2 Endpoint

```
POST /merchant-api/credit
```

### 5.3 İstek gövdesi

```json
{
  "wallet_no": "00010001",
  "customer_name": "Ali Yılmaz",
  "amount": 500.00,
  "merchant_ref": "WD-20260520-991",
  "note": "Haftalık kazanç aktarımı"
}
```

| Alan | Zorunlu | Kurallar |
|------|---------|----------|
| `wallet_no` | Evet | Üyenin cüzdan numarası (`member_no`) |
| `customer_name` | Evet | Wallet profilindeki ad soyad ile **aynı** |
| `amount` | Evet | Pozitif TRY tutarı |
| `merchant_ref` | Önerilir | Header `x-merchant-ref` ile de gönderilebilir; header öncelikli |
| `note` | Hayır | En fazla 500 karakter |

### 5.4 Başarılı cevap

```json
{
  "success": true,
  "transaction_id": "…",
  "wallet_tx_no": "C-20260520-000045",
  "merchant_ref": "WD-20260520-991",
  "new_member_balance": 1250.50,
  "merchant_outstanding": 0
}
```

| Alan | Anlam |
|------|--------|
| `new_member_balance` | İşlem sonrası üye cüzdan bakiyesi |
| `merchant_outstanding` | Sizin settlement defterinizdeki “tahsil edilebilir” pozisyon özeti (≥0) |

### 5.5 Sık hatalar

| Kod | Anlam | Ne yapmalı? |
|-----|--------|-------------|
| `MEMBER_NOT_FOUND` | Cüzdan no yok | Numarayı doğrula |
| `NAME_MISMATCH` | Ad soyad uyuşmuyor | Profille birebir eşleştir |
| `MEMBER_FROZEN` | Üye hesabı dondurulmuş | İşlem yapılamaz |
| `INSUFFICIENT_MERCHANT_BALANCE` | Sizin settlement limitiniz yetmez | Wallet ile limit / bakiye konuşun |
| `DUPLICATE_REF` | Aynı ref tekrar | İlk cevabı kullan |

**Muhasebe:** Bu işlemde sizin Wallet’taki settlement bakiyeniz **azalır** (üyeye fon transfer etmiş olursunuz). Periyodik mutabakat ile kapatırsınız.

---

## 6. Bayi kaydı (sadece parent hesap)

Parent merchant, alt mağazaları tek seferde veya güncelleme olarak bildirir.

```
POST /merchant-api/child-upsert
```

**Zorunlu:** `x-merchant-ref` (batch idempotency için).

```json
{
  "children": [
    {
      "external_sub_merchant_ref": "STORE-IST-01",
      "name": "İstanbul Mağaza",
      "commission_pct": 2.5,
      "per_tx_limit": 50000,
      "daily_limit": 500000,
      "is_active": true
    }
  ]
}
```

**Cevap (özet):** Her bayi için `api_key` döner. **Yeni signing secret verilmez** — imza parent secret ile kalır.

| Alan | Not |
|------|-----|
| `external_sub_merchant_ref` | Sizin şube kodunuz (opsiyonel ama önerilir) |
| `commission_pct` | Zorunlu — Akış A komisyon oranı (%) |

---

## 7. Genel hata kodları (güvenlik / teknik)

| Kod | HTTP | Anlam |
|-----|------|--------|
| `INVALID_KEY` | 401 | API key hatalı |
| `INVALID_SIGNATURE` | 401 | İmza hatalı |
| `STALE_TIMESTAMP` | 401 | Saat senkronu bozuk |
| `MERCHANT_INACTIVE` | 403 | Hesap pasif |
| `WRONG_MERCHANT_TYPE` | 403 | Finance merchant bu endpoint’i kullanamaz |
| `BAD_JSON` / `BAD_BODY` | 400 | JSON veya alan hatası |
| `METHOD` | 405 | Sadece POST |

Tam liste için cevaptaki `error_code` alanını loglayın; destek ekibine `wallet_tx_no` veya `merchant_ref` iletin.

---

## 8. Örnek entegrasyon

### 8.1 cURL — Ödeme (Akış A)

```bash
BASE="https://wallet.example.com/merchant-api"
KEY="your_api_key"
SECRET="your_signing_secret"
TS=$(date +%s)
BODY='{"code":"AB12CD34","amount":100,"customer_name":"Ali Yılmaz"}'
SIG=$(printf '%s:%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -sS -X POST "$BASE/charge" \
  -H "Content-Type: application/json" \
  -H "x-merchant-key: $KEY" \
  -H "x-merchant-timestamp: $TS" \
  -H "x-merchant-signature: $SIG" \
  -H "x-merchant-ref: ORDER-10001" \
  -d "$BODY"
```

### 8.2 Node.js — İmza helper

```javascript
import crypto from "crypto";

function signRequest(secret, timestamp, bodyString) {
  const message = `${timestamp}:${bodyString}`;
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

async function merchantCharge({ apiKey, secret, baseUrl, code, amount, customerName, merchantRef }) {
  const body = JSON.stringify({ code, amount, customer_name: customerName });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signRequest(secret, timestamp, body);

  const res = await fetch(`${baseUrl}/charge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-merchant-key": apiKey,
      "x-merchant-timestamp": timestamp,
      "x-merchant-signature": signature,
      "x-merchant-ref": merchantRef,
    },
    body,
  });
  return res.json();
}
```

### 8.3 PHP — İmza helper

```php
function wallet_sign(string $secret, string $timestamp, string $body): string {
    return hash_hmac('sha256', $timestamp . ':' . $body, $secret);
}

// Kullanım: $body = json_encode([...]); $ts = (string) time();
// $sig = wallet_sign($secret, $ts, $body);
```

---

## 9. Entegrasyon kontrol listesi

| # | Madde |
|---|--------|
| 1 | API key + signing secret güvenli ortamda (env / vault) |
| 2 | Sunucu saati NTP ile senkron |
| 3 | Her istekte benzersiz `x-merchant-ref` |
| 4 | Akış A: kod + tutar + isim üçlüsü üye ekranıyla aynı |
| 5 | Akış B: `wallet_no` + profil adı doğrulaması |
| 6 | `success: false` → siparişi tamamlama; kullanıcıya net mesaj |
| 7 | `wallet_tx_no` kendi logunuza yazın |
| 8 | Test: küçük tutarla mutlu yol + DUPLICATE_REF replay |
| 9 | Çok şubeli ise: child `api_key` + parent `signing_secret` |

---

## 10. Sık sorulan sorular

**İade (refund) var mı?**  
Hayır. Üye iadesi merchant API’sinde yok. Anlaşmazlıklar operasyon ile çözülür.

**Üye komisyon görür mü?**  
Hayır. `amount` üyenin gördüğü brüt tutardır.

**Kod ne kadar geçerli?**  
Kod üretiminden sonra kısa süre (süresi dolunca `CODE_EXPIRED`). Tam süre Wallet ayarlarından gelir.

**Aynı ref ile farklı tutar gönderirsem?**  
`DUPLICATE_REF` veya güvenlik kuralına takılırsınız — ref’i işlem bazında unique tutun.

**Sandbox var mı?**  
Wallet ekibi staging URL + test key verir. Canlı key’i test ortamında kullanmayın.

---

## 11. Destek

İletişimde şunları paylaşın:

- `merchant_ref` veya `wallet_tx_no`
- İstek zamanı (UTC)
- `error_code` (varsa)
- **İmza / secret / tam body loglamayın** (güvenlik)

Teknik detay (iç ekip): `docs/ARCHITECTURE_FLOWS.md`, `docs/HARD_RULES.md`

---

*Wallet commerce API — parent/child credential modeli dahil.*
