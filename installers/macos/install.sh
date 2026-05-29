#!/usr/bin/env bash
# ╭───────────────────────────────────────────────────────────────────╮
# │  Wallet — macOS install (one-time)                                │
# │                                                                   │
# │  Run this from Terminal:                                          │
# │    cd installers/macos && ./install.sh                            │
# │                                                                   │
# │  It will:                                                         │
# │    1. Install Xcode Command Line Tools (if missing)               │
# │    2. Install Homebrew (if missing)                               │
# │    3. Install Node.js 20+ (if missing)                            │
# │    4. Install PostgreSQL 16 as a background service               │
# │    5. Install project dependencies (npm install)                  │
# │    6. Generate fresh secrets in .env files                        │
# │    7. Create the database + role                                  │
# │    8. Migrate schema + seed reference data                        │
# │    9. Create the admin account (admin@wallet.local / Admin1234)   │
# │                                                                   │
# │  Re-running this script is safe — every step is idempotent.       │
# ╰───────────────────────────────────────────────────────────────────╯

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "${SCRIPT_DIR}/lib/common.sh"

require_macos
mkdir -p "$LOG_DIR"
INSTALL_LOG="${LOG_DIR}/install-$(date '+%Y%m%d-%H%M%S').log"
# Mirror everything to the log AND the terminal.
exec > >(tee -a "$INSTALL_LOG") 2>&1

cd "$REPO_ROOT" || die "Cannot enter repo root: $REPO_ROOT"

# Pick development vs production. Asks the operator interactively if
# WALLET_ENV is empty; honors the env var otherwise.
prompt_wallet_env

if [ "$WALLET_ENV" = "production" ]; then
  IS_PROD=true
  NODE_ENV_VALUE=production
else
  IS_PROD=false
  NODE_ENV_VALUE=development
fi

# ADMIN password handling. Production refuses Admin1234 (P0-10 guard).
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
  fi
  ADMIN_PASS_GENERATED=false
fi

# Detect a dump to import (honors IMPORT_DUMP, else newest backups/wallet-*.sql[.gz]).
IMPORT_DUMP_PATH="$(find_dump_to_import)"

banner "Wallet — macOS installer"
info "Profile        : ${WALLET_ENV} (NODE_ENV=${NODE_ENV_VALUE})"
info "Repo root      : $REPO_ROOT"
info "Architecture   : $(uname -m) ($(if is_apple_silicon; then echo "Apple Silicon"; else echo "Intel"; fi))"
if [ -n "$IMPORT_DUMP_PATH" ]; then
  info "DB import      : ${IMPORT_DUMP_PATH}"
else
  info "DB import      : (none — running migrate + seed for a fresh schema)"
fi
info "Log file       : $INSTALL_LOG"
echo

# ─── 1) Xcode Command Line Tools ──────────────────────────────────────────────
banner "1/9  Xcode Command Line Tools"
if xcode-select -p >/dev/null 2>&1; then
  ok "Already installed: $(xcode-select -p)"
else
  warn "Xcode Command Line Tools are missing — triggering the macOS installer."
  xcode-select --install 2>/dev/null || true
  warn "A system dialog should appear. Click 'Install' and wait for it to finish (it can take 10+ minutes)."
  warn "When the install is done, run ./install.sh again."
  exit 1
fi
echo

# ─── 2) Homebrew ──────────────────────────────────────────────────────────────
banner "2/9  Homebrew"
if have_cmd brew; then
  ensure_brew_in_path
  ok "Already installed: $(brew --version | head -1)"
else
  info "Installing Homebrew (you will be asked for your macOS password once)..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || die "Homebrew install failed."
  ensure_brew_in_path
  ok "Homebrew installed: $(brew --version | head -1)"
fi

# Make brew available in future shells too
SHELL_RC="${HOME}/.zprofile"
BREW_SHELLENV_LINE='eval "$('"$(brew_prefix)"'/bin/brew shellenv)"'
if [ -f "$SHELL_RC" ] && ! grep -Fq "$BREW_SHELLENV_LINE" "$SHELL_RC"; then
  printf '\n# Added by Wallet installer\n%s\n' "$BREW_SHELLENV_LINE" >> "$SHELL_RC"
  info "Added Homebrew to your shell startup (~/.zprofile)"
fi
echo

# ─── 3) Node.js 20+ ───────────────────────────────────────────────────────────
banner "3/9  Node.js (>=${NODE_VERSION_REQUIRED})"
CURRENT_MAJOR="$(node_major)"
if [ "$CURRENT_MAJOR" -ge "$NODE_VERSION_REQUIRED" ]; then
  ok "Already installed: $(node -v)"
else
  info "Installing Node.js 20 via Homebrew..."
  brew install node@20 || die "node@20 install failed"
  brew link --overwrite --force node@20 || die "node@20 link failed"
  ok "Node installed: $(node -v)"
fi
echo

# ─── 4) PostgreSQL 16 (native, as a background service) ───────────────────────
banner "4/9  PostgreSQL 16 (Homebrew service)"

# Install the formula
if brew list --formula "$PG_FORMULA" >/dev/null 2>&1; then
  ok "$PG_FORMULA already installed"
else
  info "Installing $PG_FORMULA (this also initializes the data directory)..."
  brew install "$PG_FORMULA" || die "$PG_FORMULA install failed"
fi

PG_CONF="$(pg_conf_file)"
PG_DATA="$(pg_data_dir)"
[ -d "$PG_DATA" ] || die "Postgres data dir missing at $PG_DATA — try: brew reinstall $PG_FORMULA"

# Pin port to ${POSTGRES_PORT} so we never clash with a system Postgres on 5432.
# Edit BEFORE starting so the very first start uses the right port.
if grep -Eq "^[# ]*port[[:space:]]*=" "$PG_CONF"; then
  perl -i -pe "s|^[# ]*port\\s*=.*|port = ${POSTGRES_PORT}|" "$PG_CONF"
else
  printf '\nport = %s\n' "$POSTGRES_PORT" >> "$PG_CONF"
fi
ok "Configured Postgres to listen on :${POSTGRES_PORT}"

# Start as a launchd service (auto-starts on login from now on)
case "$(pg_service_status)" in
  started) ok "Service already running" ;;
  stopped|missing)
    info "Starting service..."
    brew services start "$PG_FORMULA" >/dev/null || die "brew services start failed"
    ;;
esac

wait_for_pg 30 || die "Postgres didn't come up. Check: brew services info $PG_FORMULA"
ok "PostgreSQL ready on :${POSTGRES_PORT}"
echo

# ─── 5) Dependencies (npm install) ────────────────────────────────────────────
banner "5/9  Project dependencies (npm install)"
info "This downloads ~600 MB on first run. Subsequent runs are instant."
npm install --no-audit --no-fund || die "npm install failed"
ok "node_modules ready ($(du -sh node_modules 2>/dev/null | awk '{print $1}'))"
echo

# ─── 6) Environment files ─────────────────────────────────────────────────────
banner "6/9  Environment files (.env)"
generate_env() {
  local target="$1" mode="${2:-api}"  # mode: api | web
  if [ -f "$target" ]; then
    ok "Already present: $target"
    return
  fi
  info "Creating $target with fresh secrets..."
  local jwt_a jwt_r mfa storage merchant cashout
  jwt_a="$(gen_secret_hex)"
  jwt_r="$(gen_secret_hex)"
  mfa="$(gen_secret_hex)"
  storage="$(gen_secret_hex)"
  merchant="$(gen_secret_hex)"
  cashout="$(gen_secret_hex)"
  cp "$REPO_ROOT/.env.example" "$target"
  perl -i -pe "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=${jwt_a}|" "$target"
  perl -i -pe "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=${jwt_r}|" "$target"
  perl -i -pe "s|^MFA_ENCRYPTION_KEY=.*|MFA_ENCRYPTION_KEY=${mfa}|" "$target"
  perl -i -pe "s|^STORAGE_SIGNING_SECRET=.*|STORAGE_SIGNING_SECRET=${storage}|" "$target"
  perl -i -pe "s|^MERCHANT_HMAC_PEPPER=.*|MERCHANT_HMAC_PEPPER=${merchant}|" "$target"
  perl -i -pe "s|^MERCHANT_CASHOUT_CALLBACK_SECRET=.*|MERCHANT_CASHOUT_CALLBACK_SECRET=${cashout}|" "$target"

  if [ "$mode" = "api" ]; then
    perl -i -pe "s|^NODE_ENV=.*|NODE_ENV=${NODE_ENV_VALUE}|" "$target"
    # Cookies are Secure in production. localhost is treated as a secure
    # context so http://localhost still works, but we keep the API on
    # loopback either way.
    perl -i -pe "s|^HOST=.*|HOST=127.0.0.1|" "$target"
  fi

  ok "Wrote $target"
}

generate_web_env() {
  local target="$REPO_ROOT/apps/web/.env.local"
  if [ -f "$target" ]; then
    ok "Already present: $target"
    return
  fi
  info "Creating $target..."
  local mfa_enforce="false"
  [ "$IS_PROD" = true ] && mfa_enforce="true"
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
  ok "Wrote $target"
}

mkdir -p "$REPO_ROOT/apps/api" "$REPO_ROOT/apps/web"
generate_env "$REPO_ROOT/.env"           api
generate_env "$REPO_ROOT/apps/api/.env"  api
generate_web_env
echo

# ─── 7) Database + role ───────────────────────────────────────────────────────
banner "7/9  Create database + role"
PSQL="$(pg_bin psql)"
[ -x "$PSQL" ] || die "psql not found at $PSQL"

# Default DB to connect to is the macOS username's DB (auto-created by brew).
ME="$(id -un)"

# Create wallet role if missing (idempotent)
if "$PSQL" -h localhost -p "$POSTGRES_PORT" -d postgres -tAc \
     "SELECT 1 FROM pg_roles WHERE rolname='${PG_USER}'" 2>/dev/null | grep -q 1; then
  ok "Role ${PG_USER} already exists"
else
  info "Creating role ${PG_USER}..."
  "$PSQL" -h localhost -p "$POSTGRES_PORT" -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE ROLE ${PG_USER} LOGIN SUPERUSER PASSWORD '${PG_PASS}';" \
    || die "CREATE ROLE failed"
  ok "Role ${PG_USER} created"
fi

# Create wallet database if missing (idempotent)
if "$PSQL" -h localhost -p "$POSTGRES_PORT" -d postgres -tAc \
     "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" 2>/dev/null | grep -q 1; then
  ok "Database ${PG_DB} already exists"
else
  info "Creating database ${PG_DB}..."
  "$PSQL" -h localhost -p "$POSTGRES_PORT" -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE ${PG_DB} OWNER ${PG_USER};" \
    || die "CREATE DATABASE failed"
  ok "Database ${PG_DB} created"
fi

# Quick verification: can we log in as wallet?
if PGPASSWORD="${PG_PASS}" "$PSQL" -h localhost -p "$POSTGRES_PORT" -U "${PG_USER}" -d "${PG_DB}" -c "SELECT 1" >/dev/null 2>&1; then
  ok "Verified: wallet user can connect to ${PG_DB} on :${POSTGRES_PORT}"
else
  die "wallet user cannot connect — check pg_hba.conf or password mismatch."
fi
echo

# ─── 8) Schema + (dump restore | seed) ────────────────────────────────────────
banner "8/9  Database schema"

DB_TABLE_COUNT="$(PGPASSWORD="${PG_PASS}" "$PSQL" \
  -h localhost -p "$POSTGRES_PORT" -U "$PG_USER" -d "$PG_DB" \
  -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'" 2>/dev/null \
  | tr -d ' ' || echo 0)"
DB_TABLE_COUNT="${DB_TABLE_COUNT:-0}"
info "Existing tables in '${PG_DB}': ${DB_TABLE_COUNT}"

if [ -n "$IMPORT_DUMP_PATH" ] && [ "$DB_TABLE_COUNT" = "0" ]; then
  info "Restoring database from ${IMPORT_DUMP_PATH}..."
  case "$IMPORT_DUMP_PATH" in
    *.sql.gz)
      gunzip -c "$IMPORT_DUMP_PATH" | \
        PGPASSWORD="${PG_PASS}" "$PSQL" \
          -h localhost -p "$POSTGRES_PORT" -U "$PG_USER" -d "$PG_DB" \
          -v ON_ERROR_STOP=1 \
        || die "Dump restore failed (gunzip|psql)"
      ;;
    *.sql)
      PGPASSWORD="${PG_PASS}" "$PSQL" \
        -h localhost -p "$POSTGRES_PORT" -U "$PG_USER" -d "$PG_DB" \
        -v ON_ERROR_STOP=1 -f "$IMPORT_DUMP_PATH" \
        || die "Dump restore failed (psql -f)"
      ;;
    *) die "Unsupported dump extension: $IMPORT_DUMP_PATH" ;;
  esac
  ok "Dump restored"
  info "Applying any pending Drizzle migrations on top of the dump..."
  npm run db:migrate || die "Post-restore migrate failed"
  ok "Schema is at HEAD"
elif [ "$DB_TABLE_COUNT" != "0" ]; then
  warn "Database is non-empty — skipping dump-restore even if a dump exists."
  info "Applying any pending Drizzle migrations..."
  npm run db:migrate || die "Schema migration failed"
  ok "Schema is at HEAD"
else
  info "Applying Drizzle migrations..."
  # P0-30 — `|| db:push` fallback removed (push silently DROP/ALTERs columns).
  npm run db:migrate || die "Schema migration failed"
  ok "Schema applied"

  info "Seeding reference data (loyalty tiers, payment types, BO permissions, …)..."
  npm run db:seed || die "Seed failed"
  ok "Seed complete"
fi
echo

# ─── 9) Admin account ─────────────────────────────────────────────────────────
banner "9/9  Admin account"
# bootstrap-admin is idempotent: if a user with the same email already
# exists (e.g. restored from a dump), it just ensures the admin role binding.
if [ "$IS_PROD" = true ]; then
  ALLOW_ADMIN_BOOTSTRAP=true \
    ADMIN_EMAIL="$ADMIN_EMAIL" \
    ADMIN_PASS="$ADMIN_PASS" \
    npm run admin:bootstrap \
    || die "Admin bootstrap failed"
else
  ADMIN_EMAIL="$ADMIN_EMAIL" \
    ADMIN_PASS="$ADMIN_PASS" \
    npm run admin:bootstrap \
    || die "Admin bootstrap failed"
fi
echo

# ─── 10) Build (always, per operator request) ─────────────────────────────────
# In dev mode the build is precautionary: `start.sh` runs `npm run dev` from
# source, but a built dist/ is handy if the operator later switches to
# production with this same checkout.
banner "10/11  Build (shared → api → web)"
info "Running npm run build..."
npm run build || die "Build failed"
ok "Built: apps/api/dist + apps/web/dist"
echo

# ─── 11) launchd auto-start (production only) ─────────────────────────────────
banner "11/11  Auto-start (launchd)"
if [ "$IS_PROD" = true ]; then
  API_ENTRY="$REPO_ROOT/apps/api/dist/apps/api/src/index.js"
  if [ ! -f "$API_ENTRY" ]; then
    die "Built API entry not found at $API_ENTRY — did the build fail silently?"
  fi
  mkdir -p "$(dirname "$LAUNCHD_PLIST_USER")" "$REPO_ROOT/apps/api/logs" "$REPO_ROOT/storage"
  NODE_BIN="$(command -v node || true)"
  [ -x "$NODE_BIN" ] || die "node not found on PATH"

  cat > "$LAUNCHD_PLIST_USER" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.wallet.api</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${API_ENTRY}</string>
  </array>
  <key>WorkingDirectory</key><string>${REPO_ROOT}/apps/api</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${REPO_ROOT}/apps/api/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>${REPO_ROOT}/apps/api/logs/launchd.err.log</string>
</dict>
</plist>
EOF
  chmod 644 "$LAUNCHD_PLIST_USER"
  ok "Wrote $LAUNCHD_PLIST_USER"

  # Reload the agent so changes take effect now.
  launchctl unload "$LAUNCHD_PLIST_USER" 2>/dev/null || true
  launchctl load -w "$LAUNCHD_PLIST_USER" || die "launchctl load failed"
  sleep 2
  if curl -sSf --max-time 5 "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; then
    ok "API is running under launchd on http://127.0.0.1:${API_PORT}"
  else
    warn "API didn't respond on http://127.0.0.1:${API_PORT} within 5s — check logs:"
    warn "  tail -f ${REPO_ROOT}/apps/api/logs/launchd.err.log"
  fi
else
  # Remove a stale plist from a previous prod-profile install.
  if [ -f "$LAUNCHD_PLIST_USER" ]; then
    info "Removing stale launchd plist from a previous install..."
    launchctl unload "$LAUNCHD_PLIST_USER" 2>/dev/null || true
    rm -f "$LAUNCHD_PLIST_USER"
    ok "Removed $LAUNCHD_PLIST_USER"
  else
    ok "Dev profile — skipped (no auto-start)"
  fi
fi
echo

# ─── Done ─────────────────────────────────────────────────────────────────────
hr
printf '%b\n' "${C_GREEN}${C_BOLD}  ✓ Installation complete!${C_RESET}"
hr
cat <<EOF

  ${C_BOLD}Profile${C_RESET}
    ${WALLET_ENV} (NODE_ENV=${NODE_ENV_VALUE})
EOF

if [ "$IS_PROD" = true ]; then
  cat <<EOF

  ${C_BOLD}URLs${C_RESET}
    API        http://127.0.0.1:${API_PORT}/    (managed by launchd)
    Web app    serve apps/web/dist with any static server, e.g.
                 npx serve -s apps/web/dist -l ${WEB_PORT}
    Health     http://127.0.0.1:${API_PORT}/health

  ${C_BOLD}launchd${C_RESET}
    Plist      ${LAUNCHD_PLIST_USER}
    Reload     launchctl unload "${LAUNCHD_PLIST_USER}" && \\
               launchctl load -w "${LAUNCHD_PLIST_USER}"
    Logs       tail -f ${REPO_ROOT}/apps/api/logs/launchd.{out,err}.log
EOF
else
  cat <<EOF

  ${C_BOLD}Next step${C_RESET}
    ${C_BOLD}./start.sh${C_RESET}     # runs npm run dev (Vite + tsx watch),
                   opens http://localhost:${WEB_PORT}/, streams live logs.
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
fi

cat <<EOF

  ${C_BOLD}Helper scripts (all in installers/macos/)${C_RESET}
    ${C_BOLD}./start.sh${C_RESET}      Start the project (foreground; dev profile)
    ${C_BOLD}./stop.sh${C_RESET}       Stop the project
    ${C_BOLD}./status.sh${C_RESET}     Check what's running
    ${C_BOLD}./uninstall.sh${C_RESET}  Remove everything

  ${C_BOLD}PostgreSQL${C_RESET}
    Host:port  localhost:${POSTGRES_PORT}
    User/pass  ${PG_USER} / ${PG_PASS}
    Database   ${PG_DB}

  Install log saved to:
    $INSTALL_LOG

EOF
printf '%b\n' "${C_DIM}Press Enter to close this window...${C_RESET}"
read -r _ || true
