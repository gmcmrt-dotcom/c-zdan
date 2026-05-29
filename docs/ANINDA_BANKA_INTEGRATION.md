# Aninda Banka entegrasyonu (Havale/FAST)

BO yöntem tipi: **`havale`** (seed satırı: Havale / FAST).

Portal: [integration.nndin.com/main/aninda-banka](https://integration.nndin.com/main/aninda-banka)

## Akış

| Adım | Üye | Sistem |
|------|-----|--------|
| Yatırma | Para Yatır → Havale → tutar | `create_topup_session` (RPC shim) → `topup-init` service → `get-deposit-url` (BankID + Amount) → **iframe** (`/topup`, Papara/kripto ile aynı) |
| Callback | — | `POST /webhooks/aninda/deposit` → `finalizeTopupCallback` |
| Çekim | Para Çek → IBAN | `request_withdraw_v3` (RPC shim) → withdraw push worker → `set-withdraw` (CryptoType=`FAST`, AccountNumber=IBAN) |
| Callback | — | `POST /webhooks/aninda/withdraw` → `finalizeWithdrawCallback` |

Kripto ile aynı MD5 callback protokolü; tek finance merchant (`integration_adapter = 'aninda'`).

## Merchant kaydı

- `integration_adapter = 'aninda'` — kripto + havale `method_type` ile ayrılır
- `signing_secret` = Anında Password; outbound Key = `ANINDA_KEY`
- `payment_routing_rules`: `crypto` + `havale` (her ikisi de topup + withdraw için)

## Environment

| Var | Default | Açıklama |
|-----|---------|----------|
| `ANINDA_API_BASE` | `https://test-api.nndin.com` | Test API; live için `https://api.anindakripto1.com` |
| `ANINDA_KEY` | `admin` | Panel Key. `merchants.api_key` Wallet tarafında bu değerden bağımsız tutulur |
| `ANINDA_BANKA_PAYMENT_METHOD_ID` | `ANINDA_PAYMENT_METHOD_ID` fallback | Aninda panelinden alınan FAST/EFT PaymentMethodID |
| `ANINDA_DEFAULT_BANK_ID` | (gerekli) | Aninda panelinden alınan Bank ID (`get-deposit-url` çağrısı için) |

## Lokal geliştirme

1. `.env` + `apps/api/.env` doldur (`DATABASE_URL`, `JWT_*`, `ANINDA_*`).
2. `apps/web/.env.local` içinde `VITE_API_BASE_URL=/api`.
3. `npm run dev` → http://127.0.0.1:8080 (web) / http://localhost:3000 (api).
4. Havale yatırma testi: bu merchant'ta `integration_adapter='aninda'` + `payment_routing_rules` `method_type='havale'` aktif olmalı.
5. Mock IBAN fallback: `apps/api/.env` içinde `MOCK_FNS_ENABLED=true` ve `topup_init_url` boş olan finance merchant'lar için `/api/dev/mock-merchant-*` endpoint'leri devreye girer.

## Test

```bash
# API ayakta olmalı (npm run dev)
node scripts/smoke-all.mjs
```

## Üye-yüzü (iframe)

- `topup-init` servisi `{ flow: "iframe", redirect_url }` döner (Anında hosted sayfa)
- `/topup` içinde `TopupPaymentFrame.tsx`; CSP `frame-src` listesine `integration.nndin.com` ekli
- Sayfa yenilemede `get_pending_topup.redirect_url` ile devam
- Yedek: **Yeni sekmede aç**
