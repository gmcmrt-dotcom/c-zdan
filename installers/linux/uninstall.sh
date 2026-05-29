#!/usr/bin/env bash
# ╭───────────────────────────────────────────────────────────────────╮
# │  Wallet — uninstall (Rocky Linux 9)                               │
# │                                                                   │
# │  Removes:                                                         │
# │    • wallet-api systemd unit                                      │
# │    • nginx site config (/etc/nginx/conf.d/wallet.conf)            │
# │    • the wallet database + role                                   │
# │    • node_modules folders                                         │
# │    • generated .env files                                         │
# │    • storage/ + apps/api/logs/                                    │
# │                                                                   │
# │  Does NOT remove:                                                 │
# │    • Node.js, PostgreSQL, or nginx packages themselves            │
# │    • The 'wallet' system user (kept so logs stay attributable)    │
# │    • The repository code itself                                   │
# │                                                                   │
# │  After this script runs you can re-run install.sh to start fresh. │
# ╰───────────────────────────────────────────────────────────────────╯

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "${SCRIPT_DIR}/lib/common.sh"
require_root
cd "$REPO_ROOT" || die "Cannot enter repo root: $REPO_ROOT"

banner "Wallet — uninstall"
warn "This will WIPE the local database and remove generated files."
warn "Node.js / PostgreSQL / nginx themselves are kept."
printf '%s' "Type ${C_BOLD}YES${C_RESET} to continue: "
read -r CONFIRM || CONFIRM=""
[ "$CONFIRM" = "YES" ] || die "Aborted."
echo

# 1) systemd unit
banner "1/5  Stop + remove wallet-api.service"
if systemctl list-unit-files 2>/dev/null | grep -q '^wallet-api\.service'; then
  systemctl disable --now wallet-api.service >/dev/null 2>&1 || true
  rm -f "$SYSTEMD_UNIT"
  systemctl daemon-reload
  ok "wallet-api.service removed"
else
  info "wallet-api.service was not installed"
fi
echo

# 2) nginx site
banner "2/5  Remove nginx site config"
if [ -f "$NGINX_CONF" ]; then
  rm -f "$NGINX_CONF"
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx >/dev/null 2>&1 || true
    ok "Removed $NGINX_CONF and reloaded nginx"
  else
    warn "$NGINX_CONF removed but nginx -t failed (other configs?)."
  fi
else
  info "$NGINX_CONF was not present"
fi
echo

# 3) Database + role
banner "3/5  Wallet database + role"
if pg_is_ready; then
  if pg_psql_admin -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" 2>/dev/null | grep -q 1; then
    info "Dropping database ${PG_DB}..."
    # Terminate any open connections first
    pg_psql_admin -d postgres -v ON_ERROR_STOP=1 \
      -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${PG_DB}' AND pid <> pg_backend_pid();" \
      >/dev/null 2>&1 || true
    pg_psql_admin -d postgres -c "DROP DATABASE IF EXISTS \"${PG_DB}\";" \
      && ok "Database dropped" || warn "DROP DATABASE failed"
  else
    info "Database ${PG_DB} did not exist"
  fi
  if pg_psql_admin -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='${PG_USER}'" 2>/dev/null | grep -q 1; then
    info "Dropping role ${PG_USER}..."
    pg_psql_admin -d postgres -c "DROP ROLE IF EXISTS \"${PG_USER}\";" \
      && ok "Role dropped" || warn "DROP ROLE failed (objects still owned?)"
  else
    info "Role ${PG_USER} did not exist"
  fi
else
  warn "PostgreSQL is not running — skipping DB cleanup."
fi
echo

# 4) node_modules
banner "4/5  node_modules"
for dir in node_modules apps/*/node_modules packages/*/node_modules; do
  if [ -d "$REPO_ROOT/$dir" ]; then
    rm -rf "$REPO_ROOT/$dir" && ok "Removed $dir"
  fi
done
echo

# 5) Generated files
banner "5/5  Generated env / storage / logs"
for f in .env apps/api/.env apps/web/.env.local; do
  if [ -f "$REPO_ROOT/$f" ]; then
    rm -f "$REPO_ROOT/$f" && ok "Removed $f"
  fi
done
[ -d "$REPO_ROOT/storage" ]          && rm -rf "$REPO_ROOT/storage"          && ok "Removed storage/"
[ -d "$REPO_ROOT/apps/api/logs" ]    && rm -rf "$REPO_ROOT/apps/api/logs"    && ok "Removed apps/api/logs/"
[ -d "$REPO_ROOT/apps/api/dist" ]    && rm -rf "$REPO_ROOT/apps/api/dist"    && ok "Removed apps/api/dist/"
[ -d "$REPO_ROOT/apps/web/dist" ]    && rm -rf "$REPO_ROOT/apps/web/dist"    && ok "Removed apps/web/dist/"
[ -d "$LOG_DIR" ]                    && rm -rf "$LOG_DIR"                    && ok "Removed installer logs"
echo

hr
ok "Uninstall complete. Run install.sh to start fresh."
hr
