# Ticari Merchant API — 1 Sayfa Özet

> **Ticari = karşı taraf entegre eder.** Finance yatır/çek = Wallet ekibi entegre eder (bu kılavuz finance için değildir).  
> Detaylı kılavuz: [`COMMERCE_MERCHANT_API_GUIDE.md`](COMMERCE_MERCHANT_API_GUIDE.md)

**Base URL:** `https://wallet.example.com/merchant-api` (gerçek host + sabit `/merchant-api`)

---

## Kimlik ve imza (her istek)

| Header | Değer |
|--------|--------|
| `x-merchant-key` | Size verilen API key |
| `x-merchant-timestamp` | Unix saniye (`1716192000`) |
| `x-merchant-signature` | `HMAC_SHA256(secret, timestamp + ":" + body)` hex |
| `x-merchant-ref` | Sizin benzersiz işlem ID (tekrar = aynı cevap) |

- Yöntem: **POST**, body: JSON
- Saat farkı: **±5 dakika**
- Bayi modeli: **child `api_key`** + **parent `signing_secret`** ile imza

---

## 1) Ödeme al — `POST /merchant-api/charge`

Üye Wallet’ta **8 haneli kod** üretir → siz tüketirsiniz.

```http
POST /merchant-api/charge
```

```json
{
  "code": "AB12CD34",
  "amount": 100,
  "customer_name": "Ali Yılmaz"
}
```

**Başarı:** `success: true`, `wallet_tx_no` (ör. `P-20260520-000123`)

**Sık hatalar:** `CODE_EXPIRED`, `CODE_USED`, `AMOUNT_MISMATCH`, `NAME_MISMATCH`, `INSUFFICIENT_FUNDS`

---

## 2) Cüzdana aktar — `POST /merchant-api/credit`

Üyenin **sizdeki bakiyesini** kendi cüzdanına gönderir (iade değil).

```http
POST /merchant-api/credit
```

```json
{
  "wallet_no": "00010001",
  "customer_name": "Ali Yılmaz",
  "amount": 500
}
```

**Başarı:** `success: true`, `wallet_tx_no` (ör. `C-20260520-000045`), `new_member_balance`

**Sık hatalar:** `MEMBER_NOT_FOUND`, `NAME_MISMATCH`, `INSUFFICIENT_MERCHANT_BALANCE`

---

## cURL şablonu

```bash
TS=$(date +%s)
BODY='{"code":"AB12CD34","amount":100,"customer_name":"Ali Yılmaz"}'
SIG=$(printf '%s:%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -X POST "$BASE/charge" \
  -H "Content-Type: application/json" \
  -H "x-merchant-key: $KEY" \
  -H "x-merchant-timestamp: $TS" \
  -H "x-merchant-signature: $SIG" \
  -H "x-merchant-ref: ORDER-001" \
  -d "$BODY"
```

---

## Kontrol (5 madde)

1. Secret güvenli sakla  
2. Her işlemde yeni `x-merchant-ref`  
3. Kod/tutar/isim üye ekranıyla aynı (A)  
4. Cüzdan no + ad soyad doğru (B)  
5. `wallet_tx_no` logla — destek için

**Destek:** `merchant_ref` veya `wallet_tx_no` + `error_code` (secret gönderme)
