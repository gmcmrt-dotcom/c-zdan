#!/usr/bin/env bash
# ╭───────────────────────────────────────────────────────────────────╮
# │  Wallet — Rocky Linux 9 install (one-time)                        │
# │                                                                   │
# │  Run as root from inside the repo:                                │
# │    sudo ./installers/linux/install.sh                             │
# │                                                                   │
# │  It will:                                                         │
# │    1. Install system packages (curl, git, openssl, nginx, ...)    │
# │    2. Install Node.js 20 (NodeSource repo)                        │
# │    3. Install PostgreSQL 16 (PGDG repo) on port 5433              │
# │    4. Create a 'wallet' system user that owns the repo            │
# │    5. Install project dependencies (npm install)                  │
# │    6. Generate fresh secrets in .env files                        │
# │    7. Create the database + role                                  │
# │    8. Migrate schema + seed reference data                        │
# │    9. Build the API + Web for production                          │
# │   10. Create the admin account (admin@wallet.local / Admin1234)   │
# │   11. Install the wallet-api systemd unit + nginx site            │
# │   12. Configure SELinux + firewalld                               │
# │                                                                   │
# │  Re-running this script is safe — every step is idempotent.       │
# ╰───────────────────────────────────────────────────────────────────╯

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "${SCRIPT_DIR}/lib/common.sh"

require_root
require_rocky9
mkdir -p "$LOG_DIR"
INSTALL_LOG="${LOG_DIR}/install-$(date '+%Y%m%d-%H%M%S').log"
exec > >(tee -a "$INSTALL_LOG") 2>&1

cd "$REPO_ROOT" || die "Cannot enter repo root: $REPO_ROOT"

# Pick development vs production. Asks the operator interactively if
# WALLET_ENV is empty; honors the env var otherwise.
prompt_wallet_env

# Convenience flags for the rest of the script.
if [ "$WALLET_ENV" = "production" ]; then
  IS_PROD=true
  NODE_ENV_VALUE=production
  INSTALL_SYSTEMD=true
else
  IS_PROD=false
  NODE_ENV_VALUE=development
  # In dev mode we never install nginx or the systemd unit — the operator
  # runs `npm run dev` from the repo themselves.
  INSTALL_SYSTEMD=false
  INSTALL_NGINX=false
fi

# Generate a Postgres password now if the caller didn't supply one.
if [ -z "$PG_PASS" ]; then
  PG_PASS="$(gen_pg_pass)"
  PG_PASS_GENERATED=true
else
  PG_PASS_GENERATED=false
fi

# ADMIN password handling depends on the install profile:
#   - production: bootstrap-admin enforces >=12 chars / no-weak-prefix /
#     != "Admin1234" (apps/api/src/db/bootstrap-admin.ts P0-10). We always
#     generate a strong random password unless the operator pre-set one.
#   - development: the dev guard short-circuits, so the legacy "Admin1234"
#     is fine. We still honor an operator-supplied ADMIN_PASS for parity.
if [ "$IS_PROD" = true ]; then
  if [ -z "$ADMIN_PASS" ]; then
    ADMIN_PASS="$(gen_admin_pass)"
    ADMIN_PASS_GENERATED=true
  else
    ADMIN_PASS_GENERATED=false
  fi
else
  if [ -z "$ADMIN_PASS" ]; then
    ADMIN_PASS="$ADMIN_PASS_DEFAULT"
    ADMIN_PASS_GENERATED=false
  else
    ADMIN_PASS_GENERATED=false
  fi
fi

# Detect a database dump to restore. `find_dump_to_import` honors $IMPORT_DUMP
# first, then auto-detects the newest backups/wallet-*.sql[.gz].
IMPORT_DUMP_PATH="$(find_dump_to_import)"

banner "Wallet — Rocky Linux 9 installer"
info "Profile        : ${WALLET_ENV} (NODE_ENV=${NODE_ENV_VALUE})"
info "Repo root      : $REPO_ROOT"
info "Deploy user    : $DEPLOY_USER"
info "API host:port  : 127.0.0.1:$API_PORT  $([ "$IS_PROD" = true ] && echo '(loopback — nginx fronts it)' || echo '(direct, dev mode)')"
info "Web host:port  : 0.0.0.0:$WEB_PORT    $([ "$IS_PROD" = true ] && echo '(nginx)' || echo '(unused — Vite serves :8080 in dev)')"
info "PG host:port   : 127.0.0.1:$POSTGRES_PORT  (database = $PG_DB, role = $PG_USER)"
if [ -n "$IMPORT_DUMP_PATH" ]; then
  info "DB import      : ${IMPORT_DUMP_PATH}"
else
  info "DB import      : (none — running migrate + seed for a fresh schema)"
fi
info "Log file       : $INSTALL_LOG"
echo

# ─── 1) System packages ───────────────────────────────────────────────────────
banner "1/12  System packages (dnf)"
dnf -y -q install \
  curl git openssl perl tar gzip make gcc gcc-c++ \
  policycoreutils-python-utils firewalld nginx \
  iproute procps-ng \
  || die "dnf install of base packages failed"
ok "Base packages installed"
echo

# ─── 2) Node.js 20 (NodeSource) ───────────────────────────────────────────────
banner "2/12  Node.js (>=${NODE_VERSION_REQUIRED})"
CURRENT_MAJOR="$(node_major)"
if [ "$CURRENT_MAJOR" -ge "$NODE_VERSION_REQUIRED" ]; then
  ok "Already installed: $(node -v)"
else
  info "Installing Node.js 20 from NodeSource..."
  curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null \
    || die "NodeSource setup failed"
  dnf -y -q install nodejs || die "nodejs install failed"
  ok "Node installed: $(node -v)"
fi
echo

# ─── 3) PostgreSQL 16 (PGDG) ──────────────────────────────────────────────────
banner "3/12  PostgreSQL 16 (PGDG repo)"
if rpm -q pgdg-redhat-repo >/dev/null 2>&1; then
  ok "PGDG repo already present"
else
  info "Adding PGDG repo..."
  dnf -y -q install \
    https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-x86_64/pgdg-redhat-repo-latest.noarch.rpm \
    || die "Could not add PGDG repo"
fi

# RHEL9 ships a PG module that conflicts with PGDG; disable it (idempotent).
dnf -y -qm disable postgresql >/dev/null 2>&1 || true

if rpm -q postgresql16-server >/dev/null 2>&1; then
  ok "postgresql16-server already installed"
else
  info "Installing postgresql16-server + contrib..."
  dnf -y -q install postgresql16-server postgresql16-contrib \
    || die "postgresql16-server install failed"
fi

# Initialize the cluster if needed
if [ ! -s "${PG_DATA_DIR}/PG_VERSION" ]; then
  info "Initializing PostgreSQL 16 cluster..."
  /usr/pgsql-16/bin/postgresql-16-setup initdb \
    || die "initdb failed"
  ok "Cluster initialized at ${PG_DATA_DIR}"
fi

# Pin the listen port to ${POSTGRES_PORT}
if grep -Eq "^[# ]*port[[:space:]]*=" "$PG_CONF"; then
  perl -i -pe "s|^[# ]*port\\s*=.*|port = ${POSTGRES_PORT}|" "$PG_CONF"
else
  printf '\nport = %s\n' "$POSTGRES_PORT" >> "$PG_CONF"
fi
# Bind to loopback only
if grep -Eq "^[# ]*listen_addresses[[:space:]]*=" "$PG_CONF"; then
  perl -i -pe "s|^[# ]*listen_addresses\\s*=.*|listen_addresses = '127.0.0.1'|" "$PG_CONF"
else
  printf "listen_addresses = '127.0.0.1'\n" >> "$PG_CONF"
fi

# pg_hba: require md5 for the wallet user from loopback
if ! grep -Eq "^host[[:space:]]+${PG_DB}[[:space:]]+${PG_USER}[[:space:]]+127\\.0\\.0\\.1/32[[:space:]]+(scram-sha-256|md5)" "$PG_HBA"; then
  printf 'host    %s    %s    127.0.0.1/32    scram-sha-256\n' \
    "$PG_DB" "$PG_USER" >> "$PG_HBA"
fi

chown postgres:postgres "$PG_CONF" "$PG_HBA"
chmod 600 "$PG_CONF" "$PG_HBA"
ok "Configured PostgreSQL to listen on 127.0.0.1:${POSTGRES_PORT}"

# SELinux: allow Postgres to bind to non-default port (idempotent)
if have_cmd semanage; then
  if ! semanage port -l 2>/dev/null | awk '$1=="postgresql_port_t"{print $0}' | grep -qw "$POSTGRES_PORT"; then
    info "Adding SELinux label for postgresql on :${POSTGRES_PORT}..."
    semanage port -a -t postgresql_port_t -p tcp "$POSTGRES_PORT" \
      || semanage port -m -t postgresql_port_t -p tcp "$POSTGRES_PORT" \
      || warn "semanage port failed — if SELinux blocks PG, run:  semanage port -a -t postgresql_port_t -p tcp $POSTGRES_PORT"
  fi
fi

systemctl enable --now postgresql-16 >/dev/null 2>&1 || systemctl restart postgresql-16
wait_for_pg 30 || die "PostgreSQL didn't come up — check: journalctl -u postgresql-16"
ok "PostgreSQL running on :${POSTGRES_PORT}"
echo

# ─── 4) Deploy user ───────────────────────────────────────────────────────────
banner "4/12  Deploy user (${DEPLOY_USER})"
if id "$DEPLOY_USER" >/dev/null 2>&1; then
  ok "User ${DEPLOY_USER} already exists"
else
  info "Creating system user ${DEPLOY_USER}..."
  useradd --system --create-home --shell /bin/bash --home-dir "/var/lib/${DEPLOY_USER}" "$DEPLOY_USER" \
    || die "useradd failed"
  ok "User ${DEPLOY_USER} created"
fi
info "Setting ownership of ${REPO_ROOT} to ${DEPLOY_USER}:${DEPLOY_USER}..."
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "$REPO_ROOT"
ok "Repo owned by ${DEPLOY_USER}"
echo

# ─── 5) Dependencies (npm install) ────────────────────────────────────────────
banner "5/12  Project dependencies (npm install)"
info "Running npm install as ${DEPLOY_USER} (first run downloads ~600 MB)..."
as_deploy_user "cd '$REPO_ROOT' && npm install --no-audit --no-fund" \
  || die "npm install failed"
ok "node_modules ready"
echo

# ─── 6) Environment files ─────────────────────────────────────────────────────
banner "6/12  Environment files (.env)"
generate_env() {
  local target="$1" mode="$2"  # mode: api | web
  if [ -f "$target" ]; then
    ok "Already present: $target"
    return
  fi
  info "Creating $target with fresh secrets..."
  cp "$REPO_ROOT/.env.example" "$target"

  local jwt_a jwt_r mfa storage merchant cashout
  jwt_a="$(gen_secret_hex)"
  jwt_r="$(gen_secret_hex)"
  mfa="$(gen_secret_hex)"
  storage="$(gen_secret_hex)"
  merchant="$(gen_secret_hex)"
  cashout="$(gen_secret_hex)"

  perl -i -pe "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=${jwt_a}|" "$target"
  perl -i -pe "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=${jwt_r}|" "$target"
  perl -i -pe "s|^MFA_ENCRYPTION_KEY=.*|MFA_ENCRYPTION_KEY=${mfa}|" "$target"
  perl -i -pe "s|^STORAGE_SIGNING_SECRET=.*|STORAGE_SIGNING_SECRET=${storage}|" "$target"
  perl -i -pe "s|^MERCHANT_HMAC_PEPPER=.*|MERCHANT_HMAC_PEPPER=${merchant}|" "$target"
  perl -i -pe "s|^MERCHANT_CASHOUT_CALLBACK_SECRET=.*|MERCHANT_CASHOUT_CALLBACK_SECRET=${cashout}|" "$target"

  if [ "$mode" = "api" ]; then
    # Profile-dependent tweaks for API .env. Both profiles bind to loopback
    # by default — production fronts via nginx, development is consumed by
    # Vite's /api proxy on http://localhost:8080.
    perl -i -pe "s|^NODE_ENV=.*|NODE_ENV=${NODE_ENV_VALUE}|"     "$target"
    perl -i -pe "s|^HOST=.*|HOST=127.0.0.1|"                     "$target"
    perl -i -pe "s|^DATABASE_URL=.*|DATABASE_URL=postgres://${PG_USER}:${PG_PASS}@127.0.0.1:${POSTGRES_PORT}/${PG_DB}|" "$target"
    # CORS: allow the appropriate origins per profile.
    local origin
    if [ "$IS_PROD" = true ]; then
      if [ "$WEB_SERVER_NAME" = "_" ]; then
        origin="http://localhost,http://$(hostname -f 2>/dev/null || hostname)"
      else
        origin="http://${WEB_SERVER_NAME}"
      fi
    else
      origin="http://localhost:8080"
    fi
    perl -i -pe "s|^CORS_ORIGINS=.*|CORS_ORIGINS=${origin}|"     "$target"
  fi

  chown "${DEPLOY_USER}:${DEPLOY_USER}" "$target"
  chmod 600 "$target"
  ok "Wrote $target"
}

# Web .env.local: VITE_* are baked into the build, so we just need defaults.
# VITE_MFA_ENFORCEMENT is on by default in production (H5: staff funnelled
# to /auth/mfa/setup) and off in development to keep the dev login flow
# friction-free. VITE_API_PROXY_TARGET only matters in dev (Vite reads it
# at `npm run dev` time); production builds bake VITE_API_BASE_URL=/api.
generate_web_env() {
  local target="$REPO_ROOT/apps/web/.env.local"
  if [ -f "$target" ]; then
    ok "Already present: $target"
    return
  fi
  info "Creating $target..."
  local mfa_enforce="true"
  [ "$IS_PROD" = true ] || mfa_enforce="false"
  cat > "$target" <<EOF
VITE_API_BASE_URL=/api
VITE_SOCKET_URL=/ws
VITE_API_PROXY_TARGET=http://127.0.0.1:${API_PORT}
VITE_SCOPE_STRICT=false
VITE_ADMIN_HOST=admin.
VITE_MERCHANT_HOST=merchant.
VITE_AFFILIATE_ENABLED=false
VITE_MFA_ENFORCEMENT=${mfa_enforce}
EOF
  chown "${DEPLOY_USER}:${DEPLOY_USER}" "$target"
  chmod 644 "$target"
  ok "Wrote $target"
}

mkdir -p "$REPO_ROOT/apps/api" "$REPO_ROOT/apps/web"
generate_env     "$REPO_ROOT/.env"             api
generate_env     "$REPO_ROOT/apps/api/.env"    api
generate_web_env
echo

# ─── 7) Database + role ───────────────────────────────────────────────────────
banner "7/12  Create database + role"
if pg_psql_admin -d postgres -tAc \
     "SELECT 1 FROM pg_roles WHERE rolname='${PG_USER}'" 2>/dev/null | grep -q 1; then
  ok "Role ${PG_USER} already exists — updating password"
  pg_psql_admin -d postgres -v ON_ERROR_STOP=1 \
    -c "ALTER ROLE \"${PG_USER}\" WITH LOGIN PASSWORD '${PG_PASS}';" \
    || die "ALTER ROLE failed"
else
  info "Creating role ${PG_USER}..."
  pg_psql_admin -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE ROLE \"${PG_USER}\" WITH LOGIN PASSWORD '${PG_PASS}';" \
    || die "CREATE ROLE failed"
  ok "Role ${PG_USER} created"
fi

if pg_psql_admin -d postgres -tAc \
     "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" 2>/dev/null | grep -q 1; then
  ok "Database ${PG_DB} already exists"
else
  info "Creating database ${PG_DB} (owner ${PG_USER})..."
  pg_psql_admin -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE \"${PG_DB}\" OWNER \"${PG_USER}\";" \
    || die "CREATE DATABASE failed"
  ok "Database ${PG_DB} created"
fi

# Verify wallet user can connect over TCP
if PGPASSWORD="$PG_PASS" /usr/pgsql-16/bin/psql \
     -h 127.0.0.1 -p "$POSTGRES_PORT" -U "$PG_USER" -d "$PG_DB" -c "SELECT 1" >/dev/null 2>&1; then
  ok "Verified: ${PG_USER} can connect to ${PG_DB} on 127.0.0.1:${POSTGRES_PORT}"
else
  # pg_hba may need a reload after our edit above
  systemctl reload postgresql-16
  sleep 1
  PGPASSWORD="$PG_PASS" /usr/pgsql-16/bin/psql \
    -h 127.0.0.1 -p "$POSTGRES_PORT" -U "$PG_USER" -d "$PG_DB" -c "SELECT 1" >/dev/null 2>&1 \
    || die "${PG_USER} cannot connect — check pg_hba.conf or password mismatch."
  ok "Verified after reload: ${PG_USER} can connect to ${PG_DB}"
fi
echo

# ─── 8) Schema + (dump restore | seed) ────────────────────────────────────────
banner "8/12  Database schema"

# Detect whether the DB is empty so we can decide the safe path:
#   - empty + dump present  → restore from dump (DDL + data come from dump)
#   - empty + no dump       → migrate + seed (fresh schema with reference data)
#   - non-empty             → migrate only (idempotent), never restore on top
DB_TABLE_COUNT="$(PGPASSWORD="$PG_PASS" /usr/pgsql-16/bin/psql \
  -h 127.0.0.1 -p "$POSTGRES_PORT" -U "$PG_USER" -d "$PG_DB" \
  -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'" 2>/dev/null \
  | tr -d ' ' || echo 0)"
DB_TABLE_COUNT="${DB_TABLE_COUNT:-0}"
info "Existing tables in '${PG_DB}': ${DB_TABLE_COUNT}"

if [ -n "$IMPORT_DUMP_PATH" ] && [ "$DB_TABLE_COUNT" = "0" ]; then
  info "Restoring database from ${IMPORT_DUMP_PATH}..."
  case "$IMPORT_DUMP_PATH" in
    *.sql.gz)
      gunzip -c "$IMPORT_DUMP_PATH" | \
        PGPASSWORD="$PG_PASS" /usr/pgsql-16/bin/psql \
          -h 127.0.0.1 -p "$POSTGRES_PORT" -U "$PG_USER" -d "$PG_DB" \
          -v ON_ERROR_STOP=1 \
        || die "Dump restore failed (gunzip|psql)"
      ;;
    *.sql)
      PGPASSWORD="$PG_PASS" /usr/pgsql-16/bin/psql \
        -h 127.0.0.1 -p "$POSTGRES_PORT" -U "$PG_USER" -d "$PG_DB" \
        -v ON_ERROR_STOP=1 -f "$IMPORT_DUMP_PATH" \
        || die "Dump restore failed (psql -f)"
      ;;
    *) die "Unsupported dump extension: $IMPORT_DUMP_PATH (expected .sql or .sql.gz)" ;;
  esac
  ok "Dump restored"

  # Defensive: still run db:migrate so a newer code release with pending
  # migrations advances the schema past whatever the dump captured. The
  # drizzle migrator is idempotent and only applies missing migrations.
  info "Applying any pending Drizzle migrations on top of the dump..."
  as_deploy_user "cd '$REPO_ROOT' && npm run db:migrate" \
    || die "Post-restore migrate failed (dump may pre-date current schema)"
  ok "Schema is now at HEAD"

elif [ "$DB_TABLE_COUNT" != "0" ]; then
  warn "Database is non-empty — skipping dump-restore even if a dump exists."
  info "Applying any pending Drizzle migrations..."
  as_deploy_user "cd '$REPO_ROOT' && npm run db:migrate" \
    || die "Schema migration failed"
  ok "Schema is at HEAD"

else
  info "Applying Drizzle migrations..."
  # P0-30 — `|| db:push` fallback was deliberately removed. drizzle-kit push
  # silently DROP/ALTERs columns; on a real DB that's destructive. If migrate
  # fails the installer must stop and a human must investigate.
  as_deploy_user "cd '$REPO_ROOT' && npm run db:migrate" \
    || die "Schema migration failed"
  ok "Schema applied"

  info "Seeding reference data..."
  as_deploy_user "cd '$REPO_ROOT' && npm run db:seed" || die "Seed failed"
  ok "Seed complete"
fi
echo

# ─── 9) Build (API + Web) ─────────────────────────────────────────────────────
# Both profiles run the build:
#   - production: required for the systemd unit + nginx static SPA.
#   - development: harmless; gives the operator a `dist/` to fall back on
#     if `npm run dev` fails for any reason, and matches the user's request
#     to keep the post-install state immediately usable.
banner "9/12  Build (API + Web)"
info "Building shared → api → web..."
as_deploy_user "cd '$REPO_ROOT' && npm run build" || die "Build failed"
ok "Built: apps/api/dist + apps/web/dist"
echo

# ─── 10) Admin account ────────────────────────────────────────────────────────
banner "10/12  Admin account"
# bootstrap-admin is idempotent: if a user with the same email already exists
# (typically because step 8 restored a dump that already contains an admin),
# it just ensures the admin role binding and exits without changing the
# password. P0-10 production guard requires ALLOW_ADMIN_BOOTSTRAP=true and a
# strong ADMIN_PASS — both are passed inline. Inlining the password leaks it
# to a momentary `ps` row, but the install host is by definition trusted at
# this stage (already root); the alternative — writing ADMIN_PASS into
# apps/api/.env — leaves the bootstrap secret on disk after first-login
# rotation makes it irrelevant.
if [ "$IS_PROD" = true ]; then
  as_deploy_user "cd '$REPO_ROOT' && \
    ALLOW_ADMIN_BOOTSTRAP=true \
    ADMIN_EMAIL='${ADMIN_EMAIL}' \
    ADMIN_PASS='${ADMIN_PASS}' \
    npm run admin:bootstrap" \
    || die "Admin bootstrap failed"
else
  # Dev profile: bootstrap-admin's production guard is a no-op, so
  # ALLOW_ADMIN_BOOTSTRAP / strong-password rules don't apply. We still
  # pass ADMIN_EMAIL and ADMIN_PASS so a re-run with operator overrides
  # is honored.
  as_deploy_user "cd '$REPO_ROOT' && \
    ADMIN_EMAIL='${ADMIN_EMAIL}' \
    ADMIN_PASS='${ADMIN_PASS}' \
    npm run admin:bootstrap" \
    || die "Admin bootstrap failed"
fi
echo

# ─── 11) systemd unit ─────────────────────────────────────────────────────────
banner "11/12  systemd unit (wallet-api.service)"

# Always create runtime dirs (needed in both profiles).
mkdir -p "$REPO_ROOT/storage" "$REPO_ROOT/apps/api/logs"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "$REPO_ROOT/storage" "$REPO_ROOT/apps/api/logs"

if [ "$INSTALL_SYSTEMD" = true ]; then
  API_ENTRY="$REPO_ROOT/apps/api/dist/apps/api/src/index.js"
  if [ ! -f "$API_ENTRY" ]; then
    die "Built API entry not found at $API_ENTRY — did the build fail silently?"
  fi

  cat > "$SYSTEMD_UNIT" <<EOF
[Unit]
Description=Wallet API
After=network-online.target postgresql-16.service
Wants=network-online.target postgresql-16.service

[Service]
Type=simple
User=${DEPLOY_USER}
Group=${DEPLOY_USER}
WorkingDirectory=${REPO_ROOT}/apps/api
EnvironmentFile=${REPO_ROOT}/apps/api/.env
ExecStart=/usr/bin/node ${API_ENTRY}
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal
SyslogIdentifier=wallet-api

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=${REPO_ROOT}/storage ${REPO_ROOT}/apps/api/logs

[Install]
WantedBy=multi-user.target
EOF
  chmod 644 "$SYSTEMD_UNIT"
  ok "Wrote $SYSTEMD_UNIT"

  systemctl daemon-reload
  systemctl enable --now wallet-api.service >/dev/null
  sleep 2
  wait_for_url "API" "http://127.0.0.1:${API_PORT}/health" 30 \
    || die "API failed to start — see: journalctl -u wallet-api -n 80"
  ok "wallet-api.service is running"
else
  # Dev profile: do not install or enable a system unit. Remove a stale unit
  # from a previous prod-profile install on the same box so the operator's
  # `npm run dev` doesn't race with a leftover daemon on :${API_PORT}.
  if [ -f "$SYSTEMD_UNIT" ]; then
    info "Disabling stale wallet-api.service from a previous install..."
    systemctl disable --now wallet-api.service >/dev/null 2>&1 || true
    rm -f "$SYSTEMD_UNIT"
    systemctl daemon-reload
    ok "Removed $SYSTEMD_UNIT"
  else
    ok "Dev profile — skipped (no system unit installed)"
  fi
fi
echo

# ─── 12) nginx + firewalld + SELinux ──────────────────────────────────────────
banner "12/12  nginx + firewalld + SELinux"

if [ "$INSTALL_NGINX" = true ]; then
  WEB_DIST="$REPO_ROOT/apps/web/dist"
  [ -f "$WEB_DIST/index.html" ] || die "Web dist not found at $WEB_DIST"

  # SELinux: label the dist files as web content + permit nginx → upstream
  if have_cmd semanage; then
    semanage fcontext -a -t httpd_sys_content_t "${REPO_ROOT}(/.*)?" >/dev/null 2>&1 || \
      semanage fcontext -m -t httpd_sys_content_t "${REPO_ROOT}(/.*)?" >/dev/null 2>&1 || true
    restorecon -R "$REPO_ROOT" >/dev/null 2>&1 || true
  fi
  if have_cmd setsebool; then
    setsebool -P httpd_can_network_connect 1 >/dev/null 2>&1 || \
      warn "Could not setsebool httpd_can_network_connect — nginx may fail to proxy."
  fi

  cat > "$NGINX_CONF" <<EOF
upstream wallet_api {
  server 127.0.0.1:${API_PORT};
  keepalive 32;
}

server {
  listen ${WEB_PORT} default_server;
  listen [::]:${WEB_PORT} default_server;
  server_name ${WEB_SERVER_NAME};

  # SPA root — Vite build output
  root ${REPO_ROOT}/apps/web/dist;
  index index.html;

  # Aggressive caching for hashed assets
  location /assets/ {
    try_files \$uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }

  # Reverse-proxy API endpoints
  location /api/ {
    proxy_pass http://wallet_api;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 90s;
    client_max_body_size 50m;
  }

  # Public merchant API (HMAC) — same upstream, mounted under /merchant-api
  location /merchant-api/ {
    proxy_pass http://wallet_api;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 90s;
    client_max_body_size 5m;
  }

  # Socket.IO websocket
  location /ws/ {
    proxy_pass http://wallet_api;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  }

  # HMAC-signed static downloads
  location /storage/ {
    proxy_pass http://wallet_api;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  }

  # Health endpoint — proxied (so external monitors can hit /health)
  location = /health {
    proxy_pass http://wallet_api;
  }

  # SPA fallback (must be LAST among location blocks)
  location / {
    try_files \$uri \$uri/ /index.html;
  }
}
EOF
  chmod 644 "$NGINX_CONF"
  ok "Wrote $NGINX_CONF"

  # nginx needs to traverse the repo path; ensure parent dirs are o+x
  parent="$REPO_ROOT"
  while [ "$parent" != "/" ] && [ -n "$parent" ]; do
    chmod o+x "$parent" 2>/dev/null || true
    parent="$(dirname "$parent")"
  done

  # SELinux booleans for nginx reading files in user home dirs
  if have_cmd setsebool; then
    setsebool -P httpd_read_user_content 1 >/dev/null 2>&1 || true
  fi

  if ! nginx -t >/dev/null 2>&1; then
    err "nginx config test failed — running 'nginx -t' for details:"
    nginx -t
    die "Fix nginx config and re-run."
  fi
  systemctl enable --now nginx >/dev/null
  systemctl reload nginx
  ok "nginx is running"
else
  warn "INSTALL_NGINX=false — skipping nginx config. The API is reachable on 127.0.0.1:${API_PORT} only."
fi

# firewalld — only relevant when nginx is exposing :${WEB_PORT}. In dev mode
# the API binds to loopback and the operator runs Vite (also loopback by
# default), so opening firewall ports would just confuse the security
# boundary.
if [ "$IS_PROD" = true ] && [ "$OPEN_FIREWALL" = true ]; then
  if systemctl is-active --quiet firewalld; then
    info "Configuring firewalld..."
  else
    info "Starting firewalld..."
    systemctl enable --now firewalld >/dev/null 2>&1 || warn "Could not start firewalld."
  fi
  if systemctl is-active --quiet firewalld; then
    if [ "$WEB_PORT" = "80" ]; then
      firewall-cmd --permanent --add-service=http >/dev/null 2>&1 || true
    else
      firewall-cmd --permanent --add-port="${WEB_PORT}/tcp" >/dev/null 2>&1 || true
    fi
    firewall-cmd --reload >/dev/null 2>&1 || true
    ok "firewalld: port ${WEB_PORT}/tcp open"
  fi
elif [ "$IS_PROD" = true ]; then
  warn "OPEN_FIREWALL=false — leaving firewalld untouched."
else
  ok "Dev profile — firewall left as-is (loopback only)"
fi
echo

# ─── Done ─────────────────────────────────────────────────────────────────────
hr
printf '%s\n' "${C_GREEN}${C_BOLD}  ✓ Installation complete!${C_RESET}"
hr

PUBLIC_HOST="$(hostname -f 2>/dev/null || hostname)"
cat <<EOF

  ${C_BOLD}Profile${C_RESET}
    ${WALLET_ENV} (NODE_ENV=${NODE_ENV_VALUE})
EOF

if [ "$IS_PROD" = true ]; then
  cat <<EOF

  ${C_BOLD}URLs${C_RESET}
    Web app    http://${PUBLIC_HOST}/         (nginx → built SPA)
    API        http://${PUBLIC_HOST}/api/     (proxied to 127.0.0.1:${API_PORT})
    Health     http://${PUBLIC_HOST}/health
EOF
else
  cat <<EOF

  ${C_BOLD}URLs (after you start the dev servers)${C_RESET}
    Web app    http://localhost:8080/      (Vite dev server)
    API        http://127.0.0.1:${API_PORT}/api/  (Vite proxies /api to it)
    Health     http://127.0.0.1:${API_PORT}/health

  ${C_BOLD}Start the dev servers${C_RESET}
    sudo -u ${DEPLOY_USER} bash -lc 'cd ${REPO_ROOT} && npm run dev'
    # API + Vite run in the foreground; Ctrl-C stops both.
EOF
fi

cat <<EOF

  ${C_BOLD}Sign in${C_RESET}
    Email      ${ADMIN_EMAIL}
    Password   ${ADMIN_PASS}
EOF

if [ "$IS_PROD" = true ]; then
  cat <<EOF
    ${C_YELLOW}must_change_password=true is set on this user — rotate the password on first login.${C_RESET}
EOF
else
  cat <<EOF
    ${C_DIM}Dev default — change it once you start working with real data.${C_RESET}
EOF
fi

if [ "$IS_PROD" = true ]; then
  cat <<EOF

  ${C_BOLD}Service control${C_RESET}
    systemctl status   wallet-api
    systemctl restart  wallet-api
    journalctl -u      wallet-api -f
    systemctl status   nginx
    systemctl status   postgresql-16
EOF
fi

cat <<EOF

  ${C_BOLD}PostgreSQL${C_RESET}
    Host       127.0.0.1
    Port       ${POSTGRES_PORT}
    Database   ${PG_DB}
    Role       ${PG_USER}
EOF

if [ "$PG_PASS_GENERATED" = true ]; then
  cat <<EOF
    Password   ${PG_PASS}
    ${C_YELLOW}This password is stored in:  ${REPO_ROOT}/apps/api/.env${C_RESET}
EOF
else
  echo "    Password   (as supplied via PG_PASS env var)"
fi

cat <<EOF

  ${C_BOLD}Files${C_RESET}
    Repo            ${REPO_ROOT}
    API env         ${REPO_ROOT}/apps/api/.env
EOF

if [ "$IS_PROD" = true ]; then
  cat <<EOF
    systemd unit    ${SYSTEMD_UNIT}
    nginx config    ${NGINX_CONF}
EOF
fi

cat <<EOF
    Install log     ${INSTALL_LOG}

  ${C_BOLD}Next${C_RESET}
EOF

if [ "$IS_PROD" = true ]; then
  cat <<EOF
    • Front the server with HTTPS (cookies are Secure in production —
      browsers will refuse them on a non-localhost http:// URL):
        sudo dnf install -y certbot python3-certbot-nginx
        sudo certbot --nginx -d ${WEB_SERVER_NAME}
    • Edit CORS_ORIGINS in ${REPO_ROOT}/apps/api/.env to your public hostname,
      then: sudo systemctl restart wallet-api
    • Helper scripts:
        ${SCRIPT_DIR}/status.sh        Read-only health check
        ${SCRIPT_DIR}/uninstall.sh     Tear everything down

EOF
else
  cat <<EOF
    • Start the dev servers (above) and visit http://localhost:8080.
    • Re-run this installer with WALLET_ENV=production any time you want to
      switch this box into a real deploy.
    • Helper scripts:
        ${SCRIPT_DIR}/status.sh        Read-only health check
        ${SCRIPT_DIR}/uninstall.sh     Tear everything down

EOF
fi
