# Wallet — Playwright E2E

Browser end-to-end tests for the member, admin, and merchant UI surfaces.

## Prerequisites

1. **PostgreSQL** running with migrations applied (`npm run db:migrate`).
2. **Admin bootstrap** (once per DB):
   ```bash
   npm run admin:bootstrap
   ```
   Creates `admin@wallet.local` / `Admin1234`.
3. **Test seed (Option A)** — required for member + merchant flows:
   ```bash
   npm run test:seed
   ```
   Expected accounts:
   | Role | Email | Password |
   |------|-------|----------|
   | Admin | `admin@wallet.local` | `Admin1234` |
   | Member | `member.funded@wallet.local` | `Test1234!` |
   | Merchant owner | `merchant.owner@wallet.local` | `Test1234!` |

   If Option A is not ready yet, member/merchant tests **skip gracefully** with a hint to run `test:seed`.

4. **Dev stack** on port 8080 (Vite proxies `/api` → API on 3000):
   ```bash
   npm run dev
   ```

5. **Chromium** (one-time):
   ```bash
   npx playwright install chromium
   ```

## Run

From repo root:

```bash
npm run test:e2e          # headless
npm run test:e2e:ui       # Playwright UI mode
```

Override base URL:

```bash
E2E_BASE_URL=http://localhost:8080 npm run test:e2e
```

## Layout

```
e2e/
  playwright.config.ts   # baseURL, timeouts, chromium project
  helpers/
    auth.ts              # login helpers + test account constants
    ui.ts                # tour dismiss, locale, reachability check
    fixtures.ts          # requireAuthRole + prepareAuthenticatedPage
  global-setup.ts        # one login per role → e2e/.auth/*.json (rate-limit safe)
  member/*.spec.ts       # member flows (5 files, 11 tests)
  admin/*.spec.ts        # admin BO (4 files, 8 tests)
  merchant/*.spec.ts     # merchant BO (3 files, 6 tests)
```

**Total: 25 tests** across 12 spec files.

## Notes

- Tests use Turkish UI strings (default locale).
- Auth uses HttpOnly cookies + CSRF like the real app; Playwright `request` context is not used for login — the UI form is exercised instead.
- Tests run **serially** (`workers: 1`) and reuse cookie jars from `global-setup.ts` (max 3 login API calls per run).
- If you hit `LOGIN_RATE_LIMIT` from earlier runs, restart `npm run dev` or wait ~15 minutes before re-running E2E.
- API smoke (172 endpoint cases) remains in `scripts/smoke-all.mjs`; E2E complements that with real browser flows.
