# Aninda Kripto integration

Finance merchant adapter for **Flow C** (crypto topup redirect) and **Flow D**
(crypto withdraw push + callback). The protocol differs from the generic
Wallet HMAC callback contract — Aninda uses an MD5 checksum + trailing password
and PascalCase field names.

Portal: [integration.nndin.com/main/aninda-kripto](https://integration.nndin.com/main/aninda-kripto)

## Architecture

```mermaid
flowchart TB
  subgraph topup [Akış C — Yatırma]
    MemberT[Üye Topup] --> TopupInit[topup-init service]
    TopupInit -->|adapter=aninda| AnindaDep[POST {ANINDA_API_BASE}/trader/get-deposit-url]
    AnindaDep --> Redirect[Anında ödeme sayfası]
    Redirect --> DepCB[POST /webhooks/aninda/deposit]
    DepCB --> FinalizeT[finalizeTopupCallback service]
  end
  subgraph withdraw [Akış D — Çekim]
    MemberW[Üye Withdraw crypto] --> ReqW[request_withdraw_v3 RPC shim]
    ReqW --> Push[withdraw push worker]
    Push --> AnindaW[POST {ANINDA_API_BASE}/trader/set-withdraw]
    AnindaW --> WCB[POST /webhooks/aninda/withdraw]
    WCB --> FinalizeW[finalizeWithdrawCallback service]
  end
```

| Standard Wallet finance merchant | Aninda Kripto |
|----------------------------------|---------------|
| HMAC `topup_init_url` | `POST {ANINDA_API_BASE}/trader/get-deposit-url` |
| IBAN inline or redirect | Deposit redirect rendered inside an iframe on `/topup` (unified `aninda` adapter) |
| `POST /merchant-api/topup-callback` | `POST /webhooks/aninda/deposit` |
| Custom withdraw push | `POST {ANINDA_API_BASE}/trader/set-withdraw` driven by the scheduler |
| `POST /merchant-api/withdraw-callback` | `POST /webhooks/aninda/withdraw` |
| HMAC-SHA256 | MD5 checksum + trailing password |

## Configuration

### Merchant row

```sql
UPDATE public.merchants
SET integration_adapter = 'aninda',
    signing_secret = '<Anında Password>',
    merchant_type = 'finance',
    is_active = true
WHERE id = '4672d54f-c768-4f67-9cb7-00d7509877e0';
```

- Outbound `Key` → `ANINDA_KEY` env var (default `admin`)
- `signing_secret` → Aninda `Password` (used as the MD5 suffix, **not** HMAC)
- `topup_init_url` — unused for this adapter
- The same merchant also serves **Havale/FAST** and **Papara** by adding `havale` / `papara` rows to `payment_routing_rules`

Legacy adapter values `aninda_kripto` / `aninda_banka` are still recognised; new
installs should use `aninda`.

### Environment variables (`apps/api/.env`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANINDA_API_BASE` | `https://test-api.nndin.com` | Test / live API host |
| `ANINDA_KEY` | `admin` | Aninda panel Key value (outbound) |
| `ANINDA_PAYMENT_METHOD_ID` | _(set per Aninda panel config)_ | Portal PaymentMethodID for crypto deposits |
| `ANINDA_BANKA_PAYMENT_METHOD_ID` | falls back to `ANINDA_PAYMENT_METHOD_ID` | FAST/EFT deposit |
| `ANINDA_PAPARA_PAYMENT_METHOD_ID` | falls back to `ANINDA_PAYMENT_METHOD_ID` | Papara deposit |
| `ANINDA_DEFAULT_BANK_ID` | _(only for FAST/EFT)_ | Bank ID for `get-deposit-url` |

### Aninda panel (do this on your side)

1. **Definitions → Callback URL** — point both deposit and withdraw to the live host:
   - Deposit: `https://wallet.example.com/webhooks/aninda/deposit`
   - Withdraw: `https://wallet.example.com/webhooks/aninda/withdraw`
2. **Resources → IP Addresses** — whitelist the wallet egress IPs (the host running the API).
3. **Live cutover** — swap Key / Password and set `ANINDA_API_BASE=https://api.anindakripto1.com` in `apps/api/.env`, then restart the API.

## Field mapping

### Deposit

| Aninda | Wallet |
|--------|--------|
| `TraderTransactionID` | `topup_sessions.id` (UUID) |
| `PlayerID` | `profiles.member_no` |
| `Description` | Blockchain TxID → `merchant_ref` |

### Withdraw create (`set-withdraw`)

| Aninda | Wallet |
|--------|--------|
| `TraderTransactionID` | `withdraw_sessions.id` |
| `AccountNumber` | `withdraw_sessions.payout_address` |
| `CryptoType` | `withdraw_sessions.crypto_type` |
| `Amount` | Session amount (string) |

### Withdraw callback

Same checksum scheme as the deposit callback. `merchant_ref` is taken from
`PaymentTransactionID` (fallback to `Description`).

## Routes / services

| Surface | Where |
|---------|-------|
| Outbound adapter (deposit + withdraw create) | `apps/api/src/integrations/aninda.ts` |
| Deposit init dispatcher | `apps/api/src/services/topup-init.service.ts` |
| Inbound deposit / withdraw callbacks | `apps/api/src/routes/webhooks.routes.ts` |
| Withdraw push worker | `apps/api/src/workers/scheduler.ts` |

## Tests

```bash
# API must be running locally (npm run dev)
node scripts/smoke-all.mjs
```

The smoke suite hits `/webhooks/aninda/deposit` and `/webhooks/aninda/withdraw`
with both valid and invalid Key / checksum combinations.

## Known limits

- Multiple deposit callbacks per session (different TxID): only the first
  `success` credits the wallet. Subsequent `success` callbacks are recorded in
  `merchant_api_calls` but ignored by `finalizeTopupCallback`.
- Aninda's documented sample callback checksum sometimes doesn't match a
  recomputation; the integration uses the same algorithm as the verified
  `set-withdraw` request hash and accepts it.

## Go-live checklist

| # | Item | Where |
|---|------|-------|
| 1 | `ANINDA_API_BASE=https://api.anindakripto1.com` | `apps/api/.env` (or environment) |
| 2 | Live `Key` → `merchants.api_key`, live `Password` → `merchants.signing_secret` | SQL or Admin BO |
| 3 | `integration_adapter='aninda'` | `merchants` row |
| 4 | Callback URLs (deposit + withdraw) on the Aninda panel | Aninda → Definitions |
| 5 | Wallet egress IP allow-listed | Aninda → Resources |
| 6 | `payment_method_types.crypto` (and any extra Aninda channels) enabled + `payment_routing_rules` for crypto topup/withdraw → this merchant | DB |
| 7 | `merchants.cash_pool` sized to expected withdraw demand (Flow D) | Admin BO → Finance Integrations |
| 8 | `MOCK_FNS_ENABLED=false` or unset | `apps/api/.env` |
| 9 | Frontend bundle rebuilt and deployed | `npm run build` + your static host |

### E2E live test (after go-live)

- [ ] Member crypto deposit: redirect → callback → balance up
- [ ] Member crypto withdraw: push → Aninda settles → success callback → balance down
- [ ] Admin Transactions / reconciliation match
