# Deploy & migration workflow

Wallet runs as a Node monorepo (`apps/api`, `apps/web`, `packages/shared`) against a
PostgreSQL 16 database. Schema is owned by Drizzle, not Supabase.

---

## 1. Pre-deploy sanity

```bash
npm install
npm run typecheck       # tsc --noEmit on web + api
npm run lint            # eslint on web
npm run build           # shared → api → web (dist outputs)
npm --workspace apps/api test   # Vitest (services + integration)
```

If the API server is already running locally (`npm run dev`):

```bash
node scripts/smoke-all.mjs   # 172 endpoint cases, ~5s — exit code = unexpected failures
```

---

## 2. Database migrations (Drizzle)

The Drizzle schema files in `apps/api/src/db/schema/*.ts` are the **single source of truth**.

| Step | Command | Notes |
|------|---------|-------|
| Diff and write a new migration file | `npm --workspace apps/api run db:generate` | Output lands in `apps/api/src/db/migrations/<NNNN>_<name>.sql` plus a `meta/` snapshot. Review the SQL before committing. |
| Apply pending migrations to the configured DB | `npm run db:migrate` | Uses `DATABASE_URL` from `apps/api/.env` (or the root `.env` for the macOS installer). Idempotent — re-runs are no-ops. |
| Force schema-equal-to-files push (dev shortcut) | `npm run db:push` | **Local only.** Skips the migration history, so use it for prototyping and then regenerate a real migration before committing. |
| Reseed reference data | `npm run db:seed` | Loyalty tiers, payment method types, cashout methods, `bo_permissions`, referral_config, settings defaults. Safe to re-run (`onConflictDoNothing`). |
| Bootstrap the first admin user | `npm run admin:bootstrap` | Creates `admin@wallet.local / Admin1234` unless `ADMIN_EMAIL` / `ADMIN_PASSWORD` are exported. Idempotent. |

### Migration rules

- **Atomic** — keep a single migration to one logical change set, so a failure rolls back cleanly.
- **Backwards-compatible** — additive when possible. If a column has to be renamed or dropped, ship the destructive change in a follow-up migration after the code that still reads it is gone.
- **Re-runnable** — `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP TRIGGER IF EXISTS ... CASCADE`. Drizzle generates these by default; only hand-edit when you absolutely must.
- **No `DROP TABLE` in a hot migration** — gate it behind a follow-up cleanup migration and a feature flag.

---

## 3. Local Postgres setup

| Path | Notes |
|------|-------|
| **macOS (recommended)** | `cd installers/macos && ./install.sh`. It installs `postgresql@16` via Homebrew on port `5433`, creates the `wallet` role/database, writes secrets to `apps/api/.env` and `apps/web/.env.local`, runs `npm install`, then `db:migrate` + `db:seed` + `admin:bootstrap`. Idempotent. |
| **Rocky / Alma / RHEL 9** | `sudo ./installers/linux/install.sh` from inside the cloned repo. Provisions Node 20 (NodeSource), `postgresql16` (PGDG) on `127.0.0.1:5433`, a dedicated `wallet` system user, the wallet DB/role with a random password, `.env` secrets, schema + seed + admin, a production build, `wallet-api.service` systemd unit, nginx reverse proxy on `:80`, and matching SELinux + firewalld rules. Idempotent. See `installers/linux/README.txt` for env-var overrides. |
| **Linux (Debian/Ubuntu, manual)** | `sudo apt-get install -y postgresql-16`, then `sudo -u postgres psql -c "CREATE USER wallet WITH SUPERUSER PASSWORD 'wallet';"` and `sudo -u postgres createdb -O wallet wallet`. Switch the cluster to port `5433` via `/etc/postgresql/16/main/postgresql.conf` and `sudo systemctl restart postgresql@16-main`. Then `npm install`, copy `.env.example` to `.env` + `apps/api/.env` + `apps/web/.env.local`, fill in `JWT_*`, `MFA_ENCRYPTION_KEY`, `STORAGE_SIGNING_SECRET`, `MERCHANT_HMAC_PEPPER`, and run `npm run db:migrate && npm run db:seed && npm run admin:bootstrap`. |

---

## 4. Production deploy

Wallet is intended to ship as a single Node process behind nginx (TLS) with the
PostgreSQL database hosted on the same host or a managed Postgres provider.

```bash
# On the build host
git pull
npm ci
npm run typecheck && npm run build
npm run db:migrate     # apply any new migrations to PROD DB

# Restart the API
pm2 reload wallet-api  # or systemctl restart wallet-api

# Static web bundle
rsync -a --delete apps/web/dist/ /var/www/wallet/
sudo nginx -t && sudo systemctl reload nginx
```

The web bundle is fully static; nginx serves it directly and reverse-proxies
`/api`, `/ws`, `/storage`, `/merchant-api`, `/webhooks` to the API on
`localhost:3000`. A working nginx template lives at
`deploy/nginx-wallet.conf.example`, and `deploy/env.production.template` lists
every env var the API expects.

---

## 5. Feature flags

| Flag | Default | Where to set | Purpose |
|------|---------|--------------|---------|
| `VITE_AFFILIATE_ENABLED` | `false` | `apps/web/.env.local` (build-time) | Akış F (merchant affiliate). Hides UI, the registry filters the module out, server-side mutations return `AFFILIATE_DISABLED`. Member referrals (Akış E) are unaffected. |
| `VITE_MFA_ENFORCEMENT` | `false` | `apps/web/.env.local` (build-time) | Forces staff (admin/accounting/support) through TOTP. **Enroll every staff TOTP factor before turning this on**, otherwise you will lock the BO out. |
| `MOCK_FNS_ENABLED` | `true` in dev, **must be `false` in prod** | `apps/api/.env` | Mounts `/api/dev/mock-merchant-*` for local testing. The deploy refuses to start with `MOCK_FNS_ENABLED=true` and `NODE_ENV=production`. |
| `AFFILIATE_SYSTEM_ENABLED` | `false` | `apps/api/.env` + `settings.affiliate_system_enabled` row | Server-side master switch read by affiliate services. |
| `ANTHROPIC_API_KEY` | unset | `apps/api/.env` | If set, chat AI auto-reply runs. Default model `claude-3-5-sonnet-20241022` (override via `ANTHROPIC_MODEL`). |
| `AI_DAILY_BUDGET_USD` | `50` | `apps/api/.env` | Soft daily cap for AI spend (K6). Hourly `ai_budget_alert` cron logs `[AI_BUDGET_SOFT_ALERT]` error when today's `ai_cost_log` sum crosses 80%. Soft only — does NOT auto-pause Anthropic calls; the log forwarder turns it into a Telegram/email alert. |
| ~~`VIRUSTOTAL_API_KEY`~~ | **removed (K7)** | — | Was always a noop. For production malware scanning, mount a ClamAV sidecar that watches `STORAGE_LOCAL_DIR` and quarantines positive matches into a separate path (or runs `clamdscan` on file write before the storage write returns). The MIME magic-byte sniff in `storage.routes.ts` still rejects obvious binaries and SVG-with-script at upload time. |
| `TG_BOT_TOKEN` | unset | `apps/api/.env` | Telegram bot for chat notifications. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | unset | `apps/api/.env` | **Optional** (N). Outbound transactional email via nodemailer. `SMTP_PORT` defaults to `587` (STARTTLS); set `SMTP_SECURE=true` for port 465 implicit-TLS. If unset and `RESEND_API_KEY` is also unset, `sendEmail` returns `EMAIL_NOT_CONFIGURED` (debug-logged, never throws). For Gmail SMTP: host `smtp.gmail.com`, port `587`, `SMTP_USER` = Google account, `SMTP_PASS` = app password. |
| `NOTIFICATION_FROM_EMAIL` | unset | `apps/api/.env` | **Required for any email send** (with SMTP or Resend). Must be a verified sender for your transport. If unset, every email send returns `EMAIL_NOT_CONFIGURED`. |
| `RESEND_API_KEY` | unset | `apps/api/.env` | **Optional fallback** when SMTP isn't configured (N). Kept for back-compat. |

When a deploy is being prepared, surface the still-OFF flags above and confirm
before flipping any of them in production.

---

## 6. Secrets you must rotate per environment

| Env var | What |
|---------|------|
| `JWT_ACCESS_SECRET` | `openssl rand -hex 32`. Signs access JWTs (HS256). Rotating invalidates every access token in flight (refresh tokens still valid). |
| `JWT_REFRESH_SECRET` | `openssl rand -hex 32`. **Post-O.1 this value carries no auth power** — refresh tokens are opaque random blobs validated by DB hash lookup (`auth_refresh_tokens.token_hash = sha256(token)`). Kept in `.env` for back-compat with the deprecated `signRefreshToken` stub; can be rotated freely without invalidating sessions. |
| `MFA_ENCRYPTION_KEY` | **Exactly 64 lowercase hex characters (32 bytes).** Generate with `openssl rand -hex 32`. `env.ts` rejects all-zero placeholders, non-hex characters, and any length ≠ 64 at boot (H1). Encrypts `user_mfa_factors.secret_encrypted`. **Never rotate without re-enrolling all factors.** |
| `STORAGE_SIGNING_SECRET` | Signs download URLs for `/storage/...`. Rotate → previously emitted URLs stop working. v2 tokens also embed `userId` (H1) so a rotated secret automatically invalidates legacy tokens. |
| `MERCHANT_HMAC_PEPPER` | Mixed into the merchant `api_secret` hash on rotation. |
| `MERCHANT_CASHOUT_CALLBACK_SECRET` | HMAC for `/webhooks/merchant/cashout`. Share with the cashout provider. |

---

## 7. Operational notes (post-K/L/M/N/O/P/Q/R)

### Trust-proxy / real client IP (P0-44, I4)

`app.set("trust proxy", …)` is configured from the `TRUST_PROXY` env var, defaulting to `"1"` in production. This MUST match your deploy topology — otherwise `req.ip`, all rate-limit keys, the per-merchant IP allow-list, and `user_login_ips` will store the upstream proxy's IP (or worse, be spoofable via `X-Forwarded-For`):

| Topology | `TRUST_PROXY` value |
|----------|--------------------|
| API behind one nginx (default deploy) | `1` (default) |
| CDN → nginx → API | `2` |
| Direct exposure (no proxy) | `false` (disables XFF parsing entirely) |
| Local dev | `loopback` (default, only trusts 127.0.0.1) |

### Local geo on `user_login_ips` (K1-r, K8 rule 22)

Geo enrichment runs via **`geoip-lite`** (offline MaxMind GeoLite2 DB bundled in `node_modules`). No outbound network calls — `country` / `country_code` are reliable, `city` / `region` are best-effort.

Refresh the bundled DB quarterly in CI or on the deploy host:

```bash
npx geoip-lite-update
```

The DB ships as part of the npm package; no separate file to keep in sync, but the snapshot ages. Refresh after every Node `npm ci`.

### Local-only storage (K8 rule 22)

Chat attachments and uploads live on local disk at `STORAGE_LOCAL_DIR` (default `apps/api/storage/`). There is **no S3 / R2 backend** and no plan to add one — the design is single-host. For multi-host scale-out the documented path is a shared filesystem (NFS / EFS) or a sidecar that mirrors to object storage out-of-band. Backups are part of `deploy/backup.sh.example` alongside the DB dump.

### Observability (no APM, K8 rule 22)

APM is intentionally not wired. The Pino structured logs in `apps/api/logs/` (or stdout via systemd journal) are the source of truth. The deploy log forwarder (Telegram / email / SIEM of choice) is responsible for routing `error`-level lines as alerts. AI spend is tracked in `ai_cost_log` (K6) with a soft daily-budget alert.

### Force-logout-all after Batch O

The O.2 deploy SETS NEW HttpOnly auth cookies on every login/refresh/mfaChallenge response. Pre-O sessions still hold valid access JWTs (HS256, same signing secret) but their CSRF echo will be missing for the SPA's first state-changing POST — they'll hit `CSRF_INVALID` and fall through to a refresh, which mints fresh cookies. In practice this means **users re-authenticate exactly once at the deploy boundary**; the breaking-release framing in the plan file's `overview:` line captures that intent.

---

## 8. Rollback

There is no automatic down-migration. To roll back:

1. Revert the application deploy to the previous tag and restart the API.
2. If the failed migration needs to be undone, hand-write the inverse SQL or restore from the most recent PostgreSQL dump in `backups/` (the macOS installer prints a `pg_dump` snippet you can crib).
3. Re-run `npm run db:migrate` once the schema and code are back in sync.

The smoke runner is the fastest way to confirm a rolled-back environment is healthy: `node scripts/smoke-all.mjs`.
