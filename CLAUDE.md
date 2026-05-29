# Wallet — Core (session-start, slim)

> **Index:** `docs/INDEX.md` — which file for which topic.
> **State:** `docs/SESSION_STATUS.md` — open work, written-to after every task.

---

## 1. Project summary

Multi-merchant wallet middleware: **member → wallet → merchant**. Two merchant
types — **commerce** (payment, **the merchant integrates against us**) and
**finance** (topup/withdraw, **we always integrate against them**).

**Stack**

| Layer | What |
|-------|------|
| Frontend | `apps/web/` — Vite + React 18 + TS + Tailwind + shadcn/ui + i18next (TR default) |
| Backend  | `apps/api/` — Node 20 + Express + Drizzle ORM + Postgres 16 + Socket.IO |
| Auth     | bcrypt + `jose` (JWT access + rotating refresh) + `otplib` (TOTP MFA) |
| Storage  | local FS at `apps/api/storage/` with HMAC-signed download URLs |
| Shared   | `packages/shared/` — zod DTOs + cross-app types |

No Supabase, no RLS, no Cloudflare Pages in the current runtime. JWT access
tokens carry `sub` + `role` + AAL; row-level scoping happens in the service
layer (`makeUserDb`, `requireStaff`, `requireMerchant` middleware).

---

## 2. Money flows (summary)

**Required reading:** `docs/ARCHITECTURE_FLOWS.md` (A/B/C/D). Referral / affiliate: `docs/AFFILIATE_SYSTEM.md`.

| Flow | Summary |
|------|---------|
| **A** | `spend` — member pays the merchant via payment code |
| **B** | `merchant_credit` — member pulls their merchant-side balance into the wallet (not a refund) |
| **C** | `topup` — member deposits via a finance merchant (inline, 1 open session, 20 min) |
| **D** | `merchant_withdraw` — member withdraws; routed by cash-pool priority + reserve |
| **E** | Member referral — `referral_bonus` |
| **F** | Merchant affiliate — **currently OFF** (`VITE_AFFILIATE_ENABLED=false`, `settings.affiliate_system_enabled=false`) |

**No refund.** Anti-farming runs in the node-cron scheduler.

---

## 3. Hard rules (summary — full list in `docs/HARD_RULES.md`, 23 invariants)

1. Idempotency + `merchant_ref` 2. HMAC ±5 min 3. Audit log (`merchant_api_calls`)
4. PII mask 5. Service-layer scope (no merchant data crosses tenant)
6. **No merchant name / ref shown to member** 7. No commission on the member
8. Net merchant accounting 9. Reserve pattern 10. Tier snapshot
11. Merchant cash-pool / credit-limit guard 12. `merchants.balance` ≠ `merchants.cash_pool`
13. Merchant BO isolation 14. `public_no` / `merchant_ref` / `external_tx_id`
15. Commerce parent/child 16. Commerce cashout
17. Session-state changes revoke all tokens (`revokeAllForUser`, J5)
18. Audit writes are transactional (`writeAudit({ trx, ip, userAgent })`, J1)
19. PCR integrity — first/last only, both branches audited, email approvals revoke (H1+J1)
20. Audit + chat retention is FOREVER (K8)
21. i18n `escapeValue: false` is intentional (K8)
22. Local-only storage / no APM / offline geo (`geoip-lite`, K8+K1-r)
23. MFA backup codes (8 one-time, sha256-hashed, K3)

---

## 4. Session state

**Single source of truth:** `docs/SESSION_STATUS.md`. Update it after every meaningful task.

---

## 5. UI (short)

`DetailPage`, row-click detail, `fmtTRY()`, `translateError()`, `<TxIdBadge />`. Never show fee or merchant name on the member-facing surface.

---

## 6. Dev discipline

| Topic | File / command |
|-------|----------------|
| Deploy + migrations | `docs/DEPLOY_WORKFLOW.md` |
| Schema (source of truth) | `apps/api/src/db/schema/*.ts` |
| New admin page | `docs/ADMIN_BO_REGISTRY.md` |
| New feature | `docs/FEATURE_WORKFLOW.md` + `docs/PAGE_CONTRACTS.md` |
| Loyalty | `docs/LOYALTY_V3.md` |
| Smoke (server up) | `node scripts/smoke-all.mjs` (172 endpoint cases, ~5 s) |
| Typecheck | `npm run typecheck` (root) |
| Build | `npm run build` (root — shared → api → web) |
| Lint | `npm run lint` |

**Workflow:** test → commit → push (only when the user asks for a commit).

---

## 7. RBAC

`bo_permissions` table is seeded by `npm run db:seed`. The frontend uses
`<Can>` + `useAuth().can()`. The single registry lives at
`apps/web/src/lib/admin-bo-registry.ts`.

---

## 8. Never list

- ❌ `t` shadowing (`useTranslation`)
- ❌ Commission charged to the member
- ❌ Merchant name leaked into a member-facing string
- ❌ Refund RPC
- ❌ Assuming a column name — open `apps/api/src/db/schema/` instead

---

## 9. Contract-first

New feature → `docs/FEATURE_WORKFLOW.md` → update `docs/PAGE_CONTRACTS.md`.

---

## 10. Important files

`docs/INDEX.md` — full list.
Code shortcuts: `apps/web/src/lib/format.ts`, `apps/web/src/lib/mask.ts`,
`apps/web/src/components/Can.tsx`, `apps/api/src/lib/merchant-hmac.ts`.
