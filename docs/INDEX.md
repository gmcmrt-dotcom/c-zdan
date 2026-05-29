# Wallet — documentation index

| Topic | File |
|-------|------|
| **Session start (slim core)** | `../CLAUDE.md` |
| Open work / state | `SESSION_STATUS.md` |
| **Onaylı iş kararları (PS, L, P0)** | `BUSINESS_DECISIONS.md` |
| Product roadmap (loyalty, profit share backlog) | `ROADMAP.md` |
| Hard rules (23 invariants) | `HARD_RULES.md` |
| Money flows A/B/C/D | `ARCHITECTURE_FLOWS.md` |
| Member referral + merchant affiliate (E/F) | `AFFILIATE_SYSTEM.md` |
| Page contracts | `PAGE_CONTRACTS.md` |
| New feature workflow | `FEATURE_WORKFLOW.md` |
| Deploy + migrations (Drizzle) | `DEPLOY_WORKFLOW.md` |
| **Deploy "+" (tek komut, production)** | `DEPLOY_PLUS.md` |
| Feature flags | `DEPLOY_WORKFLOW.md` § Feature flags |
| Installer (Rocky Linux 9 / RHEL 9) | `../installers/linux/README.txt` |
| Installer (macOS, English) | `../installers/macos/README.txt` |
| Installer (macOS, Türkçe) | `MACOS_KURULUM.md` |
| Admin BO left nav + sensitive data | `ADMIN_BO_REGISTRY.md` |
| DB schema (source of truth) | `apps/api/src/db/schema/*.ts` |
| Merchant: commerce vs finance | `MERCHANT_TYPES.md` |
| Integration responsibility | `MERCHANT_TYPES.md` § Integration |
| **Commerce merchant API guide** (3rd-party integrator) | `COMMERCE_MERCHANT_API_GUIDE.md` |
| Commerce merchant API (English) | `COMMERCE_MERCHANT_API_GUIDE_EN.md` |
| Commerce merchant API (1-page) | `COMMERCE_MERCHANT_API_QUICKSTART.md` |
| Postman — commerce merchant | `../postman/Wallet-Commerce-Merchant.postman_collection.json` |
| Loyalty v3 | `LOYALTY_V3.md` |
| Kazanç Dağıtımı (profit share) — spek | `PROFIT_SHARE.md` |
| Kazanç Dağıtımı — yol haritası / backlog | `ROADMAP.md` § Kazanç Dağıtımı |
| Kazanç Dağıtımı — sayfa kontratı | `PAGE_CONTRACTS.md` § `/admin/profit-share` |
| Aninda crypto (finance) | `ANINDA_KRIPTO_INTEGRATION.md` |
| Aninda banka (FAST/EFT) | `ANINDA_BANKA_INTEGRATION.md` |
| Aninda Papara | `ANINDA_PAPARA_INTEGRATION.md` |

## Commands

| Purpose | Command |
|---------|---------|
| Run API + Web | `npm run dev` (root) |
| Typecheck both apps | `npm run typecheck` |
| Build (shared → api → web) | `npm run build` |
| Drizzle migrate | `npm run db:migrate` |
| Drizzle push (schema diff to DB) | `npm run db:push` |
| Seed reference data | `npm run db:seed` |
| Bootstrap first admin | `npm run admin:bootstrap` |
| End-to-end smoke (server must be up) | `node scripts/smoke-all.mjs` |
| API unit tests | `npm --workspace apps/api test` |
| Web unit tests | `npm --workspace apps/web test` |
| Lint | `npm run lint` |
| **Production deploy ("+")** | `npm run deploy` → `docs/DEPLOY_PLUS.md` |

## Schema

The Drizzle schema files in `apps/api/src/db/schema/` are the **single source of
truth** for tables, columns, indexes and constraints. To regenerate SQL after
changing a schema file:

```bash
npm --workspace apps/api run db:generate   # writes a new file under src/db/migrations/
npm run db:migrate                          # applies it
```
