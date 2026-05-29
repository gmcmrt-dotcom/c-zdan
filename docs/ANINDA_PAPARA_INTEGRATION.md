# Aninda Papara

BO yöntem tipi: **`papara`** — tek Aninda finance merchant'ı (`integration_adapter = 'aninda'`) tarafından servis edilir.

Admin **Yöntemler** sekmesi `merchant_methods` tablosundan okur (routing ayrıdır). Papara satırı seed ile gelir; komisyon ve limitleri BO'dan düzenleyebilirsiniz.

Portal: [integration.nndin.com/main/aninda-papara](https://integration.nndin.com/main/aninda-papara)

## API (test-api)

| Akış | Endpoint | Not |
|------|----------|-----|
| Yatırma | `POST {ANINDA_API_BASE}/trader/get-deposit-url` | `Amount` zorunlu; **`BankID` yok** (havale'den fark). Üye-yüzü: iframe (`/topup`, domain'den çıkmadan) |
| Çekim | `POST {ANINDA_API_BASE}/trader/set-withdraw` | `CryptoType=PAPARA`, `AccountNumber` = Papara hesap no (10+ hane) |

Callback'ler kripto/banka ile aynı: `POST /webhooks/aninda/deposit`, `POST /webhooks/aninda/withdraw`.

## Environment

| Var | Default | Açıklama |
|-----|---------|----------|
| `ANINDA_PAPARA_PAYMENT_METHOD_ID` | `ANINDA_PAYMENT_METHOD_ID` fallback | Aninda panelinden alınan Papara PaymentMethodID |

## Test

```bash
# API ayakta olmalı (npm run dev)
node scripts/smoke-all.mjs
```

(Smoke runner her üç Aninda kanalı için aynı MD5 doğrulamasını test eder.)
