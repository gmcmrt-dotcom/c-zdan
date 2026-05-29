════════════════════════════════════════════════════════════════════
  Wallet — Rocky Linux 9 installer
════════════════════════════════════════════════════════════════════

This folder contains a single-shot bash installer that turns a fresh
Rocky Linux 9 (or Alma 9 / RHEL 9) server into a running Wallet
deployment. No Docker, no VMs — everything runs natively on systemd.

After it finishes you'll have:

  • PostgreSQL 16              listening on 127.0.0.1:5433
  • Node.js 20                 system-wide
  • A 'wallet' system user     owning the repo + running the API
  • wallet-api.service         the API as a systemd unit
  • nginx                      serving the built React SPA + reverse-
                               proxying /api, /merchant-api, /ws, /storage
  • firewalld                  open port 80 (or whatever WEB_PORT is)
  • SELinux                    booleans set so nginx can proxy upstream

──────────────────────────────────────────────────────────────────
  PREREQUISITES
──────────────────────────────────────────────────────────────────

  • Rocky Linux 9, Alma 9, or RHEL 9 (x86_64 or aarch64)
  • root access (or sudo)
  • Internet access (for dnf, NodeSource, PGDG, npm)
  • The repository already cloned somewhere on the server
    (e.g. /opt/wallet or /srv/wallet — anywhere readable)

The script does NOT clone the repo for you. Clone it first:

    sudo dnf install -y git
    sudo git clone https://your.git.host/wallet /opt/wallet
    cd /opt/wallet


──────────────────────────────────────────────────────────────────
  FIRST TIME ONLY
──────────────────────────────────────────────────────────────────

    cd /opt/wallet
    sudo ./installers/linux/install.sh

The first thing the installer asks is which environment you want:

  1) development  → NODE_ENV=development, default admin password
                    Admin1234, no nginx / systemd / firewall changes.
                    After install, run the project yourself with
                    `sudo -u wallet bash -lc 'cd /opt/wallet && npm run dev'`.
                    Use this for code work / debugging on a Linux box.

  2) production   → NODE_ENV=production, GENERATED strong admin password
                    (printed once at the end of the install), wallet-api
                    systemd unit, nginx reverse proxy on :80, firewalld
                    + SELinux rules. This is the real-deploy path.

You can skip the prompt by exporting WALLET_ENV=development or
WALLET_ENV=production before running install.sh.

The installer walks through ~12 numbered steps and prints a summary
when finished, including the generated PostgreSQL password and the
admin credentials.

Re-running is safe. Every step is idempotent (it checks before it
acts). Switching profiles on the same box is also safe — when you
re-run with WALLET_ENV=development on a previously-prod machine the
installer disables and removes the wallet-api.service unit; when you
re-run with WALLET_ENV=production on a previously-dev machine it
reinstalls the unit + nginx config from scratch.

──────────────────────────────────────────────────────────────────
  IMPORTING AN EXISTING DATABASE (OPTIONAL)
──────────────────────────────────────────────────────────────────

If you copied a `pg_dump` from another wallet box into this repo's
`backups/` folder, the installer will detect it automatically.

  /opt/wallet/backups/wallet-20260528T123000Z.sql.gz   ← dropped here
  sudo ./installers/linux/install.sh                   ← installer
                                                       ←  detects + restores

Behavior:

  • If `backups/wallet-*.sql.gz` (or `.sql`) exists AND the wallet DB
    is empty → the installer runs `gunzip | psql` to restore the dump
    and then runs `npm run db:migrate` on top so the schema reaches
    HEAD even if the dump pre-dates a newer migration.
  • If the database is already non-empty → the installer skips the
    restore (defensive: no destructive overwrite) and just runs any
    pending migrations.
  • If no dump exists → the installer runs the standard
    `db:migrate` + `db:seed` and you start with a fresh schema +
    reference data.
  • Multiple dumps in `backups/` → the newest by mtime wins. Override
    with `IMPORT_DUMP=/explicit/path.sql.gz sudo ./install.sh`.

The matching backup script is `deploy/backup.sh.example`; install
that on the source machine via cron to produce dumps in the right
shape (`pg_dump --no-owner --no-privileges --format=plain | gzip`).


──────────────────────────────────────────────────────────────────
  CUSTOMIZING THE INSTALL
──────────────────────────────────────────────────────────────────

Override any of these by exporting them before running install.sh:

  PG_USER             default: wallet
  PG_DB               default: wallet
  PG_PASS             default: random 24-char string
  POSTGRES_PORT       default: 5433
  API_PORT            default: 3000
  WEB_PORT            default: 80
  WEB_SERVER_NAME     default: _   (nginx wildcard; set to your FQDN)
  DEPLOY_USER         default: wallet
  ADMIN_EMAIL         default: admin@wallet.local
  ADMIN_PASS          default: random 15-char alphanumeric (the installer
                               always generates a strong one because the API
                               runs in NODE_ENV=production and bootstrap-admin
                               refuses weak/default passwords there).
                               Override only if you want a known-good string.
  OPEN_FIREWALL       default: true
  INSTALL_NGINX       default: true

Example — install for a specific FQDN with a fixed PG password and a
known admin password:

    sudo \
      WEB_SERVER_NAME=wallet.example.com \
      PG_PASS='your-strong-pw-here' \
      ADMIN_PASS='YourStrongAdminPw1!' \
      ./installers/linux/install.sh

The admin password must be at least 12 characters and not start with
"admin", "password", or "changeme" (these are rejected by the
production-mode bootstrap-admin guard in apps/api/src/db/bootstrap-admin.ts).


──────────────────────────────────────────────────────────────────
  EVERYDAY OPERATIONS
──────────────────────────────────────────────────────────────────

Service control (the wallet-api unit + dependencies):

    sudo systemctl status   wallet-api
    sudo systemctl restart  wallet-api
    sudo systemctl status   postgresql-16
    sudo systemctl status   nginx
    sudo journalctl -u wallet-api -f          # live logs

Health check (read-only):

    sudo ./installers/linux/status.sh

Tear everything down (keeps Node/PG/nginx, drops DB + generated files):

    sudo ./installers/linux/uninstall.sh


──────────────────────────────────────────────────────────────────
  HTTPS / TLS
──────────────────────────────────────────────────────────────────

The installer leaves nginx on plain HTTP. To add TLS:

    sudo dnf install -y certbot python3-certbot-nginx
    sudo certbot --nginx -d wallet.example.com

certbot edits /etc/nginx/conf.d/wallet.conf in place. After it
finishes, also update apps/api/.env:

    CORS_ORIGINS=https://wallet.example.com

and restart the API:

    sudo systemctl restart wallet-api


──────────────────────────────────────────────────────────────────
  UPDATING THE CODE
──────────────────────────────────────────────────────────────────

Pull, reinstall deps if package.json changed, rebuild, restart:

    cd /opt/wallet
    sudo -u wallet git pull
    sudo -u wallet npm install --no-audit --no-fund
    sudo -u wallet npm run db:migrate          # if there are new migrations
    sudo -u wallet npm run build
    sudo systemctl restart wallet-api
    sudo systemctl reload  nginx               # only if web changed

If you don't want to remember the order, just re-run:

    sudo ./installers/linux/install.sh

It will detect what's already in place and only do what's needed.


──────────────────────────────────────────────────────────────────
  PORTS + NETWORK MAP
──────────────────────────────────────────────────────────────────

  External:
    :80  (or :WEB_PORT)        nginx — public

  Loopback only:
    :3000 (API_PORT)           wallet-api (Node)
    :5433 (POSTGRES_PORT)      PostgreSQL 16

The API and PostgreSQL are not reachable from outside the host. All
public traffic goes through nginx.


──────────────────────────────────────────────────────────────────
  FILES THE INSTALLER WRITES
──────────────────────────────────────────────────────────────────

System:
  /etc/systemd/system/wallet-api.service
  /etc/nginx/conf.d/wallet.conf
  /var/lib/wallet/                       (home dir of the wallet user)

Inside the repo:
  .env                                   (root duplicate, mirrors apps/api/.env)
  apps/api/.env                          (consumed by wallet-api.service)
  apps/web/.env.local                    (consumed at build time)
  apps/api/dist/                         (built API)
  apps/web/dist/                         (built React SPA, served by nginx)
  storage/                               (HMAC-signed uploads)
  apps/api/logs/                         (runtime logs, in addition to journal)
  installers/linux/logs/install-*.log    (this installer's transcript)


──────────────────────────────────────────────────────────────────
  TROUBLESHOOTING
──────────────────────────────────────────────────────────────────

API won't start
    sudo journalctl -u wallet-api -n 100 --no-pager
    # Often: DATABASE_URL wrong, secrets too short, port conflict.
    # The .env validator (apps/api/src/lib/env.ts) prints the exact field.

"connection refused" from nginx → 502
    sudo systemctl status wallet-api
    # If active, check SELinux:
    sudo getsebool httpd_can_network_connect
    sudo setsebool -P httpd_can_network_connect 1

"permission denied" reading the SPA
    nginx needs traverse (+x) on every parent directory of the repo,
    and read on the dist. The installer sets these. If you moved the
    repo, re-run:
        sudo ./installers/linux/install.sh

PostgreSQL not running
    sudo systemctl status postgresql-16
    sudo journalctl -u postgresql-16 -n 80 --no-pager
    # SELinux port label missing on 5433?
    sudo semanage port -a -t postgresql_port_t -p tcp 5433

Wrong PG password / lost it
    The installer wrote it to apps/api/.env (DATABASE_URL). To rotate:
        NEW_PW='another-strong-pw'
        sudo -u postgres /usr/pgsql-16/bin/psql -p 5433 -c \
          "ALTER ROLE wallet WITH PASSWORD '${NEW_PW}';"
        sudo sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgres://wallet:${NEW_PW}@127.0.0.1:5433/wallet|" \
          /opt/wallet/apps/api/.env
        sudo systemctl restart wallet-api

Firewall blocking external access
    sudo firewall-cmd --list-all
    sudo firewall-cmd --permanent --add-service=http
    sudo firewall-cmd --reload
