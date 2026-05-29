#!/usr/bin/env bash
# Shared helpers for the macOS installer/launcher scripts.
# Sourced by install.sh, start.sh, stop.sh, status.sh, uninstall.sh.

set -uo pipefail

# ─── Repo root ────────────────────────────────────────────────────────────────
# Each script lives at installers/macos/*.sh — so the repo root is
# two directories up from this lib file.
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${LIB_DIR}/../../.." && pwd)"
export REPO_ROOT

# ─── Constants ────────────────────────────────────────────────────────────────
NODE_VERSION_REQUIRED=20
POSTGRES_PORT=5433
PG_FORMULA="postgresql@16"
PG_USER="wallet"
PG_PASS="wallet"
PG_DB="wallet"
API_PORT=3000
WEB_PORT=8080
ADMIN_EMAIL_DEFAULT="admin@wallet.local"
ADMIN_PASS_DEFAULT="Admin1234"
LOG_DIR="${REPO_ROOT}/installers/macos/logs"

# WALLET_ENV — install profile. Accepted values: development, production.
# May be set by env var before running install.sh; if empty, install.sh
# prompts the operator interactively (see prompt_wallet_env).
: "${WALLET_ENV:=}"

# ADMIN_EMAIL / ADMIN_PASS — operator overrides. If empty, install.sh uses
# the dev defaults in development mode and generates a strong random
# password in production mode (P0-10 guard requires it).
: "${ADMIN_EMAIL:=${ADMIN_EMAIL_DEFAULT}}"
: "${ADMIN_PASS:=}"

# IMPORT_DUMP — explicit dump path. If empty, install.sh auto-detects
# `backups/wallet-*.sql.gz` (newest by mtime).
: "${IMPORT_DUMP:=}"

# Production-mode launchd plist (only created when WALLET_ENV=production).
LAUNCHD_PLIST_USER="${HOME}/Library/LaunchAgents/com.wallet.api.plist"

# ─── Colors (only when stdout is a TTY) ───────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RED='\033[31m'
  C_GREEN='\033[32m'
  C_YELLOW='\033[33m'
  C_BLUE='\033[34m'
  C_DIM='\033[2m'
  C_BOLD='\033[1m'
  C_RESET='\033[0m'
else
  C_RED=''
  C_GREEN=''
  C_YELLOW=''
  C_BLUE=''
  C_DIM=''
  C_BOLD=''
  C_RESET=''
fi

# ─── Logging ──────────────────────────────────────────────────────────────────
log()       { printf '%b\n' "${C_DIM}[$(date '+%H:%M:%S')]${C_RESET} $*"; }
info()      { printf '%b\n' "${C_BLUE}ℹ${C_RESET}  $*"; }
ok()        { printf '%b\n' "${C_GREEN}✓${C_RESET}  $*"; }
warn()      { printf '%b\n' "${C_YELLOW}⚠${C_RESET}  $*" >&2; }
err()       { printf '%b\n' "${C_RED}✗${C_RESET}  $*" >&2; }
die()       { err "$*"; exit 1; }
hr()        { printf '%b\n' "${C_DIM}────────────────────────────────────────────────────────────────${C_RESET}"; }
banner()    {
  hr
  printf '%b\n' "${C_BOLD}$*${C_RESET}"
  hr
}

# ─── Platform / environment ───────────────────────────────────────────────────
require_macos() {
  if [ "$(uname -s)" != "Darwin" ]; then
    die "This script is for macOS only (you're on $(uname -s))."
  fi
}

is_apple_silicon() { [ "$(uname -m)" = "arm64" ]; }

brew_prefix() {
  if is_apple_silicon; then echo "/opt/homebrew"; else echo "/usr/local"; fi
}

ensure_brew_in_path() {
  local p; p="$(brew_prefix)/bin"
  case ":$PATH:" in
    *":$p:"*) ;;
    *) export PATH="$p:$PATH" ;;
  esac
}

# ─── Tool detection ───────────────────────────────────────────────────────────
have_cmd() { command -v "$1" >/dev/null 2>&1; }

node_major() {
  if have_cmd node; then
    node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo "0"
  else
    echo "0"
  fi
}

# ─── PostgreSQL (native, Homebrew) ────────────────────────────────────────────
# We pin to postgresql@16, listening on a non-default port so we don't clash
# with any pre-existing Postgres install. Everything below uses ABSOLUTE paths
# to the keg-only formula so we never depend on `brew link`.

pg_keg_prefix() {
  # `brew --prefix postgresql@16` works after the formula is installed.
  brew --prefix "$PG_FORMULA" 2>/dev/null || echo ""
}

pg_data_dir() {
  # Homebrew's standard data dir for keg-only postgresql@16
  echo "$(brew_prefix)/var/${PG_FORMULA}"
}

pg_conf_file() {
  echo "$(pg_data_dir)/postgresql.conf"
}

pg_bin() {
  local prefix; prefix="$(pg_keg_prefix)"
  [ -n "$prefix" ] && echo "${prefix}/bin/$1" || echo ""
}

pg_service_status() {
  # Prints "started", "stopped", or "missing"
  if ! have_cmd brew; then echo "missing"; return; fi
  if ! brew list --formula "$PG_FORMULA" >/dev/null 2>&1; then echo "missing"; return; fi
  if brew services list 2>/dev/null | awk -v n="$PG_FORMULA" '$1==n && $2=="started" {found=1} END{exit !found}'; then
    echo "started"
  else
    echo "stopped"
  fi
}

pg_is_ready() {
  local pgisready; pgisready="$(pg_bin pg_isready)"
  [ -z "$pgisready" ] && return 1
  "$pgisready" -h localhost -p "$POSTGRES_PORT" -d postgres -q >/dev/null 2>&1
}

# ─── Networking helpers ───────────────────────────────────────────────────────
port_in_use() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

wait_for_port() {
  local label="$1" port="$2" timeout="${3:-60}" elapsed=0
  printf "%s" "  waiting for $label on :$port ..."
  while ! port_in_use "$port"; do
    sleep 1
    elapsed=$((elapsed + 1))
    printf "."
    if [ "$elapsed" -ge "$timeout" ]; then
      printf " ${C_RED}timeout${C_RESET}\n"
      return 1
    fi
  done
  printf " ${C_GREEN}up${C_RESET}\n"
}

wait_for_url() {
  local label="$1" url="$2" timeout="${3:-60}" elapsed=0
  printf "%s" "  waiting for $label ($url) ..."
  while ! curl -sSf --max-time 2 "$url" >/dev/null 2>&1; do
    sleep 1
    elapsed=$((elapsed + 1))
    printf "."
    if [ "$elapsed" -ge "$timeout" ]; then
      printf " ${C_RED}timeout${C_RESET}\n"
      return 1
    fi
  done
  printf " ${C_GREEN}ok${C_RESET}\n"
}

wait_for_pg() {
  local timeout="${1:-30}" elapsed=0
  printf "%s" "  waiting for PostgreSQL on :${POSTGRES_PORT} ..."
  while ! pg_is_ready; do
    sleep 1
    elapsed=$((elapsed + 1))
    printf "."
    if [ "$elapsed" -ge "$timeout" ]; then
      printf " ${C_RED}timeout${C_RESET}\n"
      return 1
    fi
  done
  printf " ${C_GREEN}ready${C_RESET}\n"
}

# ─── Random secret generation ─────────────────────────────────────────────────
gen_secret_hex() {
  # 32 random bytes → 64 hex chars
  openssl rand -hex 32 2>/dev/null || (head -c 32 /dev/urandom | xxd -p -c 64)
}

gen_admin_pass() {
  # 15-char password ("Wk-" + 12 random alphanumerics). Must satisfy the
  # production guard in apps/api/src/db/bootstrap-admin.ts:
  #   - length >= 12
  #   - != "Admin1234"
  #   - does not match /^admin/i, /^password/i, /^changeme/i
  local body
  body="$(openssl rand -base64 24 2>/dev/null | tr -dc 'A-Za-z0-9' | cut -c1-12)"
  printf 'Wk-%s\n' "${body}"
}

# ─── Environment picker ───────────────────────────────────────────────────────
# Sets the global $WALLET_ENV to "development" or "production". Honors a
# pre-set value if valid, prompts on the controlling TTY, or falls back to
# "development" when running non-interactively.
prompt_wallet_env() {
  case "${WALLET_ENV:-}" in
    development|dev|d) WALLET_ENV=development; return ;;
    production|prod|p) WALLET_ENV=production; return ;;
    "") : ;;
    *)
      warn "Ignoring unrecognized WALLET_ENV='${WALLET_ENV}' — will prompt."
      WALLET_ENV=""
      ;;
  esac

  if [ ! -t 0 ]; then
    warn "No TTY available and WALLET_ENV not set — defaulting to 'development'."
    WALLET_ENV=development
    return
  fi

  hr
  printf '%b\n' "${C_BOLD}Which environment is this install for?${C_RESET}"
  hr
  cat <<EOF
  ${C_BOLD}1) development${C_RESET}  — NODE_ENV=development, default admin password
                    Admin1234, no auto-start. After install:
                    \`./start.sh\` (Vite + tsx watch in the foreground).
                    Use this for code work / debugging on a Mac laptop.

  ${C_BOLD}2) production${C_RESET}   — NODE_ENV=production, GENERATED strong admin
                    password, full \`npm run build\`, and a per-user launchd
                    plist (~/Library/LaunchAgents/com.wallet.api.plist) that
                    auto-starts the API on login. The Vite SPA is built into
                    apps/web/dist (serve it however you like, or use the
                    bundled launchd unit for a local prod-mode test).
EOF
  echo
  while :; do
    printf '%s' "  Choice [1=development / 2=production] (default: 1): "
    read -r reply || reply=""
    case "${reply:-1}" in
      1|d|dev|development|"") WALLET_ENV=development; break ;;
      2|p|prod|production)    WALLET_ENV=production;  break ;;
      *) warn "Invalid choice '${reply}'. Type 1 or 2." ;;
    esac
  done
  echo
  ok "Selected: WALLET_ENV=${WALLET_ENV}"
  echo
}

# ─── Database dump auto-detect ────────────────────────────────────────────────
# Echoes the absolute path of the dump to import, or empty string if none.
# Honors $IMPORT_DUMP if set, else picks the newest backups/wallet-*.sql.gz.
find_dump_to_import() {
  if [ -n "${IMPORT_DUMP:-}" ]; then
    if [ -f "$IMPORT_DUMP" ]; then
      printf '%s\n' "$IMPORT_DUMP"
      return 0
    else
      warn "IMPORT_DUMP=${IMPORT_DUMP} not found — falling back to auto-detect."
    fi
  fi
  shopt -s nullglob
  local matches=( "${REPO_ROOT}"/backups/wallet-*.sql.gz "${REPO_ROOT}"/backups/wallet-*.sql )
  shopt -u nullglob
  if [ ${#matches[@]} -eq 0 ]; then
    return 0
  fi
  # macOS `ls -t` matches GNU semantics for recency ordering.
  ls -1t "${matches[@]}" 2>/dev/null | head -1
}

# ─── PID file helpers ─────────────────────────────────────────────────────────
PID_FILE="${LOG_DIR}/dev.pid"

write_pid()   { mkdir -p "$LOG_DIR"; echo "$1" > "$PID_FILE"; }
read_pid()    { [ -f "$PID_FILE" ] && cat "$PID_FILE" || echo ""; }
clear_pid()   { rm -f "$PID_FILE"; }

kill_pid_tree() {
  local pid="$1"
  [ -z "$pid" ] && return 0
  if kill -0 "$pid" 2>/dev/null; then
    # children first, then the leader
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
    sleep 1
    pkill -KILL -P "$pid" 2>/dev/null || true
    kill -KILL "$pid" 2>/dev/null || true
  fi
}
