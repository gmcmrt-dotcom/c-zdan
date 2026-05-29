════════════════════════════════════════════════════════════════════
  Wallet — macOS installer
════════════════════════════════════════════════════════════════════

This folder contains everything needed to run the Wallet project
on a Mac in localhost mode.

The installer uses native macOS tooling only — no Docker, no VMs,
no virtualization. PostgreSQL runs as a regular background service
that auto-starts when you log in.

──────────────────────────────────────────────────────────────────
  FIRST TIME ONLY
──────────────────────────────────────────────────────────────────

1. Open Terminal  (⌘+Space, type "Terminal", Enter).
2. cd into this folder, e.g.
       cd ~/Downloads/wallet/installers/macos
3. Run the installer:
       ./install.sh
4. The first thing it asks is which environment you want:

   1) development  → NODE_ENV=development, admin@wallet.local / Admin1234,
                     no auto-start. After install, you launch the project
                     yourself with `./start.sh` (Vite + tsx watch in the
                     foreground). This is what you want for code work.

   2) production   → NODE_ENV=production, GENERATED strong admin password
                     (printed once at the end), full `npm run build`, and a
                     per-user launchd plist that auto-starts the API on
                     login (~/Library/LaunchAgents/com.wallet.api.plist).
                     Useful for testing the prod-mode build locally.

   Skip the prompt by exporting WALLET_ENV=development or
   WALLET_ENV=production before running ./install.sh.

5. It walks through ~11 numbered steps:
       1/11  Xcode Command Line Tools  (only if missing)
       2/11  Homebrew                  (asks for macOS password once)
       3/11  Node.js 20+
       4/11  PostgreSQL 16             (Homebrew service, port 5433)
       5/11  npm install               (~600 MB download)
       6/11  .env files                (generates fresh secrets)
       7/11  Database + role           (creates wallet user/db)
       8/11  Schema + (dump restore | seed)
       9/11  Admin account
      10/11  Build (shared → api → web)
      11/11  Auto-start (launchd, production only)
6. When you see "✓ Installation complete!", you're done.

   Re-running ./install.sh is safe — every step is idempotent and switching
   profiles is supported (a stale launchd plist from a previous prod-profile
   install gets unloaded and removed when you re-run as development).

──────────────────────────────────────────────────────────────────
  IMPORTING AN EXISTING DATABASE (OPTIONAL)
──────────────────────────────────────────────────────────────────

Drop a `pg_dump` produced by `deploy/backup.sh.example` (or any
`pg_dump --no-owner --no-privileges --format=plain | gzip`) into the
repo's `backups/` folder and the installer will detect + restore it.

  ~/Downloads/wallet/backups/wallet-20260528T123000Z.sql.gz   ← drop here
  ./install.sh                                                 ← detects + restores

Rules:
  • Dump present + empty DB → restore from dump, then migrate to HEAD.
  • Dump present + non-empty DB → skip restore (defensive), migrate only.
  • No dump → standard migrate + seed (fresh schema + reference data).
  • Multiple dumps → newest by mtime wins.
  • Override with `IMPORT_DUMP=/explicit/path.sql.gz ./install.sh`.


──────────────────────────────────────────────────────────────────
  EVERY DAY YOU WANT TO WORK
──────────────────────────────────────────────────────────────────

  cd installers/macos
  ./start.sh

  • It makes sure PostgreSQL is up, then starts the API + Web servers.
  • It opens http://localhost:8080 in your default browser.
  • The terminal stays open showing live logs.
  • Sign in with:
        Email     admin@wallet.local
        Password  Admin1234
  • To stop the servers: press Ctrl+C in the start.sh window
    OR run ./stop.sh from another terminal.


──────────────────────────────────────────────────────────────────
  THE OTHER SCRIPTS
──────────────────────────────────────────────────────────────────

  ./stop.sh          Stops the dev servers. PostgreSQL keeps running
                     in the background (it costs almost nothing). To
                     stop PostgreSQL too:
                         ./stop.sh --all

  ./status.sh        Read-only health check — tells you what's
                     running, on which ports, and whether the API
                     is responding. Safe to run anytime.

  ./uninstall.sh     WIPES the local wallet database + node_modules
                     + generated .env files so you can start over
                     fresh. Asks you to type YES first. Does NOT
                     remove Homebrew, Node, or PostgreSQL themselves.


──────────────────────────────────────────────────────────────────
  WHAT GETS INSTALLED
──────────────────────────────────────────────────────────────────

System tools (managed by Homebrew, easy to remove):
  • Homebrew          /opt/homebrew  (Apple Silicon) or /usr/local (Intel)
  • Node.js 20        same prefix
  • PostgreSQL 16     same prefix; runs as a launchd service so it
                      auto-starts at login. Listens on port 5433.

Project artifacts (inside this repo):
  • node_modules/                      (~600 MB)
  • .env  +  apps/api/.env  +  apps/web/.env.local
  • storage/                            (chat attachments, etc.)
  • installers/macos/logs/install-*.log (install transcript)
  • installers/macos/logs/dev.log       (server output)

PostgreSQL data:
  • Cluster lives at $(brew --prefix)/var/postgresql@16/
  • Database name:    wallet
  • Role / password:  wallet / wallet
  • Port:             5433


──────────────────────────────────────────────────────────────────
  THE URLS
──────────────────────────────────────────────────────────────────

  Web app    http://localhost:8080
  API        http://localhost:3000        (proxied via Vite)


──────────────────────────────────────────────────────────────────
  BROWSING THE DATABASE
──────────────────────────────────────────────────────────────────

PostgreSQL is plain old PostgreSQL — any client works. Recommended:

  • TablePlus     https://tableplus.com/        (free tier, beautiful)
  • Postico 2     https://eggerapps.at/postico2/ (free, macOS-only)
  • pgAdmin 4     brew install --cask pgadmin4   (free, heavyweight)

Connection details:
  Host:     localhost
  Port:     5433
  User:     wallet
  Password: wallet
  Database: wallet

Or use the built-in psql in Terminal:
  $(brew --prefix postgresql@16)/bin/psql -h localhost -p 5433 -U wallet -d wallet


──────────────────────────────────────────────────────────────────
  TROUBLESHOOTING
──────────────────────────────────────────────────────────────────

"Permission denied" running ./install.sh
    chmod +x install.sh start.sh stop.sh status.sh uninstall.sh
    (Or run via bash: bash install.sh)

"Port 8080 is held by another process"
    Run ./stop.sh, wait 3 seconds, then ./start.sh again.
    If it persists, the offender is shown by lsof — kill it.

"Port 5433 is held by another process"
    Probably another Postgres install. Stop it, or change POSTGRES_PORT
    in installers/macos/lib/common.sh AND in your .env files.

"PostgreSQL service is not started"
    brew services restart postgresql@16
    brew services info postgresql@16   # show error if any

"Role 'wallet' does not exist" after install
    PostgreSQL may have started on a different port (e.g. you had
    another Postgres already). Run ./status.sh — if it reports
    port 5432 instead of 5433, edit the conf file and restart:
        $(brew --prefix)/var/postgresql@16/postgresql.conf
        change/add:  port = 5433
        brew services restart postgresql@16

Where are the logs?
    installers/macos/logs/install-*.log     install transcripts
    installers/macos/logs/dev.log           live server output

Where is the source code?
    apps/web/   the React frontend
    apps/api/   the Express backend
    See README.md at the repo root for architecture details.


──────────────────────────────────────────────────────────────────
  RUNNING DIRECTLY FROM npm (NO INSTALLER)
──────────────────────────────────────────────────────────────────

If PostgreSQL is already set up on localhost:5433 with a wallet
role/database, you can skip the installer entirely and use the
npm scripts from the repo root:

    npm install
    npm run db:migrate
    npm run db:seed
    npm run admin:bootstrap
    npm run dev               # API + Web in parallel
    npm run typecheck         # tsc for both apps
    node scripts/smoke-all.mjs   # 170+ endpoint integration tests
