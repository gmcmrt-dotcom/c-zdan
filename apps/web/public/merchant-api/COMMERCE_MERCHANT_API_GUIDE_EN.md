# Commerce Merchant API — Integration Guide

> **Audience:** **Commerce** merchant technical teams — **you integrate** Flow A/B on your side.  
> **Not for:** **Finance** merchants (deposit/withdraw rails). Wallet **always** integrates finance providers internally; no self-service API guide is published to them.

Full Turkish version: [`COMMERCE_MERCHANT_API_GUIDE.md`](COMMERCE_MERCHANT_API_GUIDE.md)  
One-page summary: [`COMMERCE_MERCHANT_API_QUICKSTART.md`](COMMERCE_MERCHANT_API_QUICKSTART.md)

---

## 1. Overview

Members hold balance in the **Wallet** app. Your site uses two API flows:

| Flow | What happens | Endpoint |
|------|----------------|----------|
| **A — Payment** | Member pays you from Wallet (payment code) | `POST /merchant-api/charge` |
| **B — Transfer to Wallet** | Member moves **their balance on your platform** to their Wallet | `POST /merchant-api/credit` |

**Important:**
- Flow B is **not a refund** — the member is not returning a purchase; they withdraw earnings to Wallet.
- **No fee is charged to the member**; commission is between you and Wallet.
- Members never see your store name in Wallet UI (generic labels only).

---

## 2. Before you start

### 2.1 Credentials

| Item | Description |
|------|-------------|
| **API Base URL** | `https://wallet.example.com/merchant-api` (replace with your install's host + the fixed `/merchant-api` path) |
| **API Key** | Header `x-merchant-key` — identity |
| **Signing Secret** | HMAC signing — **keep confidential** |
| **IP whitelist** | (if set) only listed IPs are accepted |

### 2.2 Parent + child (multi-store)

- **Parent** = group account. Defines stores; holds signing secret.
- **Child (store)** = each branch. Uses **its own API key**; signs with **parent signing secret**.

```
Parent merchant
  ├── signing_secret  ← always used for HMAC
  ├── IP whitelist    ← applies to all stores
  └── Child: Store A  → api_key_A
      Child: Store B  → api_key_B
```

For Flow A/B: use the **child API key**; sign with **parent signing secret**.

Store registration: parent calls `POST /merchant-api/child-upsert` (Section 6).

---

## 3. Common rules (all requests)

### 3.1 HTTP

- Method: **POST**
- `Content-Type: application/json`
- Body: UTF-8 JSON

### 3.2 Required headers

| Header | Required | Description |
|--------|----------|-------------|
| `x-merchant-key` | Yes | Your API key |
| `x-merchant-timestamp` | Yes | Unix seconds (e.g. `1716192000`) |
| `x-merchant-signature` | Yes | HMAC-SHA256 hex (below) |
| `x-merchant-ref` | Recommended | Your transaction ID — **same ref returns cached response** |

### 3.3 Signature

```
message = timestamp + ":" + body
signature = HMAC_SHA256_HEX(signing_secret, message)
```

- `timestamp` must match the header exactly.
- `body` = raw JSON string (whitespace changes break the signature).
- Clock skew max **±5 minutes** or `STALE_TIMESTAMP`.

### 3.4 Idempotency

Same `x-merchant-ref` on retry:

- Transaction is **not executed twice**.
- First response is returned again.

Use a **unique** ref per order/transfer (e.g. `ORDER-20260520-88421`).

### 3.5 Success response fields

```json
{
  "success": true,
  "transaction_id": "uuid-internal",
  "wallet_tx_no": "P-20260520-000123",
  "merchant_ref": "ORDER-12345"
}
```

| Field | Meaning |
|-------|---------|
| `wallet_tx_no` | Human-readable TX ID for support |
| `transaction_id` | Internal UUID |
| `merchant_ref` | Your reference |

---

## 4. Flow A — Payment (`merchant-charge`)

### 4.1 User journey

1. Member generates a **payment code** in Wallet (amount + name locked).
2. Member enters the code on your checkout.
3. You **consume** the code via API → balance debited, order completes.

### 4.2 Endpoint

```
POST /merchant-api/charge
```

### 4.3 Request body

```json
{
  "code": "AB12CD34",
  "amount": 250.00,
  "customer_name": "Ali Yilmaz",
  "note": "Order #88421"
}
```

| Field | Required | Rules |
|-------|----------|-------|
| `code` | Yes | 8 characters from member |
| `amount` | Yes | Must match code amount exactly (TRY) |
| `customer_name` | Yes | Must match name on code |
| `note` | No | Max 500 chars — visible in your BO only |

### 4.4 Common errors

| Code | Meaning |
|------|---------|
| `CODE_NOT_FOUND` | Invalid code |
| `CODE_EXPIRED` | Code timed out |
| `CODE_USED` | Already consumed |
| `AMOUNT_MISMATCH` | Wrong amount |
| `NAME_MISMATCH` | Wrong name |
| `INSUFFICIENT_FUNDS` | Member balance too low |
| `LIMIT_EXCEEDED` | Exceeds per-tx limit |
| `DUPLICATE_REF` | Ref reused with different body |

---

## 5. Flow B — Credit member (`merchant-credit`)

### 5.1 User journey

1. Member has withdrawable balance on **your platform**.
2. They choose “Transfer to Wallet” with wallet number + name + amount.
3. You call API → member Wallet balance increases.

### 5.2 Endpoint

```
POST /merchant-api/credit
```

### 5.3 Request body

```json
{
  "wallet_no": "00010001",
  "customer_name": "Ali Yilmaz",
  "amount": 500.00,
  "merchant_ref": "WD-20260520-991"
}
```

| Field | Required | Rules |
|-------|----------|-------|
| `wallet_no` | Yes | Member wallet number (`member_no`) |
| `customer_name` | Yes | Must match Wallet profile name |
| `amount` | Yes | Positive TRY amount |
| `merchant_ref` | Recommended | Header `x-merchant-ref` takes precedence |

### 5.4 Common errors

| Code | Meaning |
|------|---------|
| `MEMBER_NOT_FOUND` | Unknown wallet number |
| `NAME_MISMATCH` | Name does not match profile |
| `MEMBER_FROZEN` | Account frozen |
| `INSUFFICIENT_MERCHANT_BALANCE` | Your settlement limit exceeded |
| `DUPLICATE_REF` | Ref already used |

**Accounting:** Your Wallet settlement balance **decreases** (you transferred funds to the member).

---

## 6. Child store upsert (parent only)

```
POST /merchant-api/child-upsert
```

**Required:** `x-merchant-ref` for batch idempotency.

Returns `api_key` per child. **No new signing secret** — parent secret is used for HMAC.

---

## 7. Security / technical errors

| Code | HTTP | Meaning |
|------|------|---------|
| `INVALID_KEY` | 401 | Bad API key |
| `INVALID_SIGNATURE` | 401 | Bad signature |
| `STALE_TIMESTAMP` | 401 | Clock skew |
| `MERCHANT_INACTIVE` | 403 | Account inactive |
| `WRONG_MERCHANT_TYPE` | 403 | Finance merchant cannot use this |

---

## 8. Examples

See Postman collection: `postman/Wallet-Commerce-Merchant.postman_collection.json`

### cURL — Payment

```bash
BASE="https://wallet.example.com/merchant-api"
KEY="your_api_key"
SECRET="your_signing_secret"
TS=$(date +%s)
BODY='{"code":"AB12CD34","amount":100,"customer_name":"Ali Yilmaz"}'
SIG=$(printf '%s:%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -sS -X POST "$BASE/charge" \
  -H "Content-Type: application/json" \
  -H "x-merchant-key: $KEY" \
  -H "x-merchant-timestamp: $TS" \
  -H "x-merchant-signature: $SIG" \
  -H "x-merchant-ref: ORDER-10001" \
  -d "$BODY"
```

---

## 9. Integration checklist

1. Store API key + secret securely (env / vault)
2. Sync server time (NTP)
3. Unique `x-merchant-ref` per operation
4. Flow A: code + amount + name match member app
5. Flow B: wallet_no + profile name validation
6. On `success: false` do not complete order
7. Log `wallet_tx_no`
8. Test happy path + idempotent replay
9. Multi-store: child key + parent secret

---

## 10. FAQ

**Refunds?** No merchant refund API. Handle operationally.

**Member sees commission?** No. `amount` is gross for the member.

**Sandbox?** Wallet team provides staging URL + test keys.

---

## 11. Support

Share with support (never send secrets):

- `merchant_ref` or `wallet_tx_no`
- Request time (UTC)
- `error_code` if any

---

*Wallet commerce API — parent/child credentials.*
