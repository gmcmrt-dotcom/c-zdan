# Wallet

Multi-merchant wallet middleware platform.

> **One-shot installers**
> - **macOS** — see [`installers/macos/README.txt`](installers/macos/README.txt). `cd installers/macos && ./install.sh`.
> - **Rocky / Alma / RHEL 9 server** — see [`installers/linux/README.txt`](installers/linux/README.txt). `sudo ./installers/linux/install.sh` from inside the cloned repo. Includes systemd unit, nginx reverse proxy, firewalld + SELinux setup.

## Stack

- **Frontend** (`apps/web/`) — Vite + React 18 + TypeScript + Tailwind + shadcn/ui
- **Backend** (`apps/api/`) — Node.js + Express + TypeScript + Drizzle ORM
- **Database** — PostgreSQL 16 (native: Homebrew on macOS, `apt postgresql-16` on Linux)
- **Realtime** — Socket.IO
- **Storage** — local filesystem with HMAC-signed URLs
- **Auth** — bcrypt + jose (JWT) + otplib (TOTP MFA)
- **Shared** (`packages/shared/`) — zod DTO schemas + TS types

## Layout

```
apps/
  web/       Vite React app (was ./src/)
  api/       Express API server
packages/
  shared/    Cross-app zod schemas + types
```

## Local quickstart

### macOS — installer

```bash
cd installers/macos
./install.sh         # first time only
./start.sh           # every day
```

The installer ([`installers/macos/install.sh`](installers/macos/install.sh)) handles Xcode CLT, Homebrew, Node 20, **native PostgreSQL 16 as a launchd service**, npm install, env-file secret generation, Drizzle migrate + seed, and admin-user bootstrap. Re-running is idempotent.

### Rocky Linux 9 server — installer

```bash
cd /opt/wallet                                 # wherever you cloned the repo
sudo ./installers/linux/install.sh             # first time only
sudo systemctl status wallet-api               # everyday: standard systemd
```

The installer ([`installers/linux/install.sh`](installers/linux/install.sh)) provisions Node 20 (NodeSource), PostgreSQL 16 (PGDG) on `127.0.0.1:5433`, a dedicated `wallet` system user, the wallet DB + role with a generated password, secrets in `.env`, `db:migrate` + `db:seed` + `admin:bootstrap`, a production build of API + Web, a `wallet-api.service` systemd unit, an nginx reverse-proxy site, and the matching SELinux + firewalld rules. Re-running is idempotent.

### Linux (Debian/Ubuntu) / manual

```bash
# 1. PostgreSQL 16 — install natively and have it listening on :5433
sudo apt-get install -y postgresql-16
sudo -u postgres psql -c "CREATE USER wallet WITH SUPERUSER PASSWORD 'wallet';"
sudo -u postgres createdb -O wallet wallet
sudo sed -i "s/^#\?port = .*/port = 5433/" /etc/postgresql/16/main/postgresql.conf
sudo systemctl restart postgresql@16-main

# 2. Install dependencies (single root install drives all workspaces)
npm install

# 3. Copy env and fill in secrets (openssl rand -hex 32 for each long secret)
cp .env.example .env
cp .env.example apps/api/.env
cp .env.example apps/web/.env.local
# Important fields to fill: DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET,
# MFA_ENCRYPTION_KEY (64 hex chars), STORAGE_SIGNING_SECRET, MERCHANT_HMAC_PEPPER

# 4. Schema + seed + first admin
npm run db:migrate
npm run db:seed
npm run admin:bootstrap        # creates admin@wallet.local / Admin1234

# 5. Start API (:3000) and Web (:8080) in parallel
npm run dev
```

Web is served at <http://localhost:8080>, with `/api`, `/ws`, and `/storage` proxied to <http://localhost:3000>.

## Scripts (root)

| Script | What it does |
|---|---|
| `npm run dev` | Run API + Web in parallel |
| `npm run dev:api` | Only the API |
| `npm run dev:web` | Only the Web |
| `npm run db:migrate` | Apply Drizzle migrations |
| `npm run db:push` | Push Drizzle schema directly (dev convenience) |
| `npm run db:seed` | Reference data (loyalty tiers, BO permissions, …) |
| `npm run admin:bootstrap` | Create the first admin user (idempotent) |
| `npm run typecheck` | tsc --noEmit across web + api |
| `npm run build` | Build shared → api → web in order |

## Documentation

`docs/INDEX.md` is the catalog. The two required-reading files before touching
any money-flow code are [docs/ARCHITECTURE_FLOWS.md](docs/ARCHITECTURE_FLOWS.md)
and [docs/HARD_RULES.md](docs/HARD_RULES.md). For an agent session start, read
[CLAUDE.md](CLAUDE.md) first.

## Verifying a fresh install

After `./start.sh` (or `npm run dev`) the full integration suite can be run from a separate terminal:

```bash
node scripts/smoke-all.mjs          # 172 endpoint cases, runs in ~5s
```

It exercises auth, member reads, wallet flows, admin BO, public merchant-API (HMAC), webhooks, storage, RBAC, and every shim (`/api/rpc/*`, `/api/from/*`, `/api/fn/*`).
