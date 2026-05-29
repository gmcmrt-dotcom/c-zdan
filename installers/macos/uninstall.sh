#!/usr/bin/env bash
# ╭───────────────────────────────────────────────────────────────────╮
# │  Wallet — uninstall                                               │
# │                                                                   │
# │  Removes:                                                         │
# │    • dev servers (if running)                                     │
# │    • the wallet database + role (in your local PostgreSQL)        │
# │    • node_modules folders                                         │
# │    • generated .env files (originals are not touched)             │
# │    • the local storage/ directory (chat uploads)                  │
# │                                                                   │
# │  Does NOT remove:                                                 │
# │    • Homebrew, Node, or PostgreSQL themselves                     │
# │    • The repository code itself                                   │
# │                                                                   │
# │  To also remove PostgreSQL itself:                                │
# │    brew services stop postgresql@16                               │
# │    brew uninstall postgresql@16                                   │
# │                                                                   │
# │  After this script runs you can start fresh with ./install.sh.    │
# ╰───────────────────────────────────────────────────────────────────╯

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "${SCRIPT_DIR}/lib/common.sh"
require_macos
ensure_brew_in_path
cd "$REPO_ROOT" || die "Cannot enter repo root: $REPO_ROOT"

banner "Wallet — uninstall"
warn "This will WIPE the local database and remove generated files."
warn "Homebrew / Node / PostgreSQL themselves are kept."
printf '%b' "Type ${C_BOLD}YES${C_RESET} to continue: "
read -r CONFIRM || CONFIRM=""
[ "$CONFIRM" = "YES" ] || die "Aborted."
echo

# 1) Dev servers + production launchd plist (whichever is in play)
banner "1/5  Dev servers + launchd plist"
OLD_PID="$(read_pid)"
if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
  kill_pid_tree "$OLD_PID"
fi
clear_pid
# Production launchd unit (created by install.sh in production profile).
if [ -f "$LAUNCHD_PLIST_USER" ]; then
  info "Unloading launchd plist $LAUNCHD_PLIST_USER..."
  launchctl unload "$LAUNCHD_PLIST_USER" 2>/dev/null || true
  rm -f "$LAUNCHD_PLIST_USER" && ok "Removed launchd plist"
fi
for p in "$API_PORT" "$WEB_PORT"; do
  PIDS="$(lsof -nP -iTCP:$p -sTCP:LISTEN -t 2>/dev/null || true)"
  for pid in $PIDS; do kill_pid_tree "$pid"; done
done
ok "Servers stopped"
echo

# 2) Database + role (THIS DELETES THE DATA)
banner "2/5  Wallet database + role"
PSQL="$(pg_bin psql)"
if [ -n "$PSQL" ] && [ -x "$PSQL" ] && pg_is_ready; then
  if "$PSQL" -h localhost -p "$POSTGRES_PORT" -d postgres -tAc \
       "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" 2>/dev/null | grep -q 1; then
    info "Dropping database ${PG_DB}..."
    "$PSQL" -h localhost -p "$POSTGRES_PORT" -d postgres -c "DROP DATABASE ${PG_DB};" \
      && ok "Database dropped" || warn "DROP DATABASE failed (active connections? Run brew services restart $PG_FORMULA and retry.)"
  else
    info "Database ${PG_DB} did not exist"
  fi
  if "$PSQL" -h localhost -p "$POSTGRES_PORT" -d postgres -tAc \
       "SELECT 1 FROM pg_roles WHERE rolname='${PG_USER}'" 2>/dev/null | grep -q 1; then
    info "Dropping role ${PG_USER}..."
    "$PSQL" -h localhost -p "$POSTGRES_PORT" -d postgres -c "DROP ROLE ${PG_USER};" \
      && ok "Role dropped" || warn "DROP ROLE failed (objects still owned?)"
  else
    info "Role ${PG_USER} did not exist"
  fi
else
  warn "PostgreSQL is not running — skipping DB cleanup. Start it later and run ./uninstall.sh again to clean."
fi
echo

# 3) node_modules
banner "3/5  node_modules"
for dir in node_modules apps/*/node_modules packages/*/node_modules; do
  if [ -d "$REPO_ROOT/$dir" ]; then
    rm -rf "$REPO_ROOT/$dir" && ok "Removed $dir"
  fi
done
echo

# 4) Generated .env files
banner "4/5  Generated env files"
for f in .env apps/api/.env apps/web/.env.local; do
  if [ -f "$REPO_ROOT/$f" ]; then
    rm -f "$REPO_ROOT/$f" && ok "Removed $f"
  fi
done
echo

# 5) Local storage / installer logs
banner "5/5  Local storage + logs"
[ -d "$REPO_ROOT/storage" ] && rm -rf "$REPO_ROOT/storage" && ok "Removed storage/"
[ -d "$LOG_DIR" ] && rm -rf "$LOG_DIR" && ok "Removed installer logs"
echo

hr
ok "Uninstall complete. Run ./install.sh to start fresh."
hr
printf '%b\n' "${C_DIM}Press Enter to close...${C_RESET}"
read -r _ || true
