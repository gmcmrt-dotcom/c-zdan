#!/usr/bin/env bash
# Shared helpers for the Rocky Linux 9 installer/launcher scripts.
# Sourced by install.sh, status.sh, uninstall.sh.

set -uo pipefail

# ─── Repo root ────────────────────────────────────────────────────────────────
# Each script lives at installers/linux/*.sh — so the repo root is
# two directories up from this lib file.
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${LIB_DIR}/../../.." && pwd)"
export REPO_ROOT

# ─── Defaults (overridable via env before running install.sh) ─────────────────
: "${NODE_VERSION_REQUIRED:=20}"
: "${POSTGRES_PORT:=5433}"
: "${PG_USER:=wallet}"
: "${PG_DB:=wallet}"
: "${PG_PASS:=}"            # Empty → install.sh generates a random one
: "${API_PORT:=3000}"
: "${WEB_PORT:=80}"
: "${WEB_SERVER_NAME:=_}"   # nginx server_name; "_" matches anything
: "${ADMIN_EMAIL_DEFAULT:=admin@wallet.local}"
# ADMIN_PASS_DEFAULT (Admin1234) is the dev-mode default. In production mode
# bootstrap-admin rejects it (see apps/api/src/db/bootstrap-admin.ts P0-10),
# so install.sh generates a strong random ADMIN_PASS in production mode.
: "${ADMIN_PASS_DEFAULT:=Admin1234}"
: "${ADMIN_PASS:=}"        # If empty in prod mode, install.sh generates one
: "${ADMIN_EMAIL:=${ADMIN_EMAIL_DEFAULT}}"
: "${DEPLOY_USER:=wallet}"  # System user that owns the repo + runs the API
: "${OPEN_FIREWALL:=true}"
: "${INSTALL_NGINX:=true}"

# WALLET_ENV — install profile. Accepted values: development, production.
# May be set by env var before running install.sh; if empty, install.sh
# prompts the operator interactively (see prompt_wallet_env). The macOS
# common.sh has the matching default + helper.
: "${WALLET_ENV:=}"

# Optional: explicit dump path to import. If empty, install.sh auto-detects
# `backups/wallet-*.sql.gz` (newest by mtime).
: "${IMPORT_DUMP:=}"

LOG_DIR="${REPO_ROOT}/installers/linux/logs"
SYSTEMD_UNIT="/etc/systemd/system/wallet-api.service"
NGINX_CONF="/etc/nginx/conf.d/wallet.conf"
PG_DATA_DIR="/var/lib/pgsql/16/data"
PG_CONF="${PG_DATA_DIR}/postgresql.conf"
PG_HBA="${PG_DATA_DIR}/pg_hba.conf"

# ─── Colors (only when stdout is a TTY) ───────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'
  C_DIM=$'\033[2m'
  C_BOLD=$'\033[1m'
  C_RESET=$'\033[0m'
else
  C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''
  C_DIM=''; C_BOLD=''; C_RESET=''
fi

# ─── Logging ──────────────────────────────────────────────────────────────────
log()    { printf '%s\n' "${C_DIM}[$(date '+%H:%M:%S')]${C_RESET} $*"; }
info()   { printf '%s\n' "${C_BLUE}ℹ${C_RESET}  $*"; }
ok()     { printf '%s\n' "${C_GREEN}✓${C_RESET}  $*"; }
warn()   { printf '%s\n' "${C_YELLOW}⚠${C_RESET}  $*" >&2; }
err()    { printf '%s\n' "${C_RED}✗${C_RESET}  $*" >&2; }
die()    { err "$*"; exit 1; }
hr()     { printf '%s\n' "${C_DIM}────────────────────────────────────────────────────────────────${C_RESET}"; }
banner() {
  hr
  printf '%s\n' "${C_BOLD}$*${C_RESET}"
  hr
}

# ─── Platform checks ──────────────────────────────────────────────────────────
require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "This script must run as root. Try: sudo $0"
  fi
}

require_rocky9() {
  if [ ! -f /etc/os-release ]; then
    die "Cannot detect OS — /etc/os-release missing."
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in
    rocky|almalinux|rhel|centos)
      case "${VERSION_ID:-}" in
        9*) : ;;
        *) warn "Detected ${PRETTY_NAME:-unknown} — this installer targets RHEL 9 derivatives (Rocky 9 / Alma 9 / RHEL 9). Continuing anyway." ;;
      esac
      ;;
    *)
      die "This installer targets Rocky Linux 9 (or compatible). Detected: ${PRETTY_NAME:-unknown}."
      ;;
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

# ─── PostgreSQL helpers ───────────────────────────────────────────────────────
pg_is_ready() {
  /usr/pgsql-16/bin/pg_isready -h 127.0.0.1 -p "$POSTGRES_PORT" -d postgres -q >/dev/null 2>&1
}

wait_for_pg() {
  local timeout="${1:-30}" elapsed=0
  printf '  waiting for PostgreSQL on :%s ...' "$POSTGRES_PORT"
  while ! pg_is_ready; do
    sleep 1
    elapsed=$((elapsed + 1))
    printf '.'
    if [ "$elapsed" -ge "$timeout" ]; then
      printf ' %stimeout%s\n' "$C_RED" "$C_RESET"
      return 1
    fi
  done
  printf ' %sready%s\n' "$C_GREEN" "$C_RESET"
}

pg_psql_admin() {
  # Run psql as the OS postgres user (peer auth on the unix socket).
  sudo -u postgres /usr/pgsql-16/bin/psql -p "$POSTGRES_PORT" "$@"
}

# ─── Networking helpers ───────────────────────────────────────────────────────
port_in_use() {
  local port="$1"
  ss -ltn "sport = :$port" 2>/dev/null | tail -n +2 | grep -q .
}

wait_for_url() {
  local label="$1" url="$2" timeout="${3:-60}" elapsed=0
  printf '  waiting for %s (%s) ...' "$label" "$url"
  while ! curl -sSf --max-time 2 "$url" >/dev/null 2>&1; do
    sleep 1
    elapsed=$((elapsed + 1))
    printf '.'
    if [ "$elapsed" -ge "$timeout" ]; then
      printf ' %stimeout%s\n' "$C_RED" "$C_RESET"
      return 1
    fi
  done
  printf ' %sok%s\n' "$C_GREEN" "$C_RESET"
}

# ─── Random secret generation ─────────────────────────────────────────────────
gen_secret_hex() {
  # 32 random bytes → 64 hex chars
  openssl rand -hex 32 2>/dev/null || (head -c 32 /dev/urandom | xxd -p -c 64)
}

gen_pg_pass() {
  # URL-safe password (no @ : / characters that need URL-encoding in DATABASE_URL)
  openssl rand -base64 24 2>/dev/null | tr -d '+/=' | cut -c1-24
}

gen_admin_pass() {
  # 15-char password ("Wk-" + 12 random alphanumerics). Must meet
  # apps/api/src/db/bootstrap-admin.ts production guard:
  #   - length >= 12
  #   - != the dev default "Admin1234"
  #   - does not match the weak-prefix patterns /^admin/i, /^password/i,
  #     /^changeme/i
  # base64 may yield A-Z a-z 0-9 + / =; we strip the non-alphanumeric bytes,
  # then prepend "Wk-" so the prefix never collides with a weak-prefix regex
  # even if the trimmed bytes happened to start with "admin" / "password" /
  # "changeme" (vanishingly unlikely, but cheap to guarantee).
  local body
  body="$(openssl rand -base64 24 2>/dev/null | tr -dc 'A-Za-z0-9' | cut -c1-12)"
  printf 'Wk-%s\n' "${body}"
}

# ─── Run as the deploy user ───────────────────────────────────────────────────
as_deploy_user() {
  sudo -u "$DEPLOY_USER" -H bash -lc "$*"
}

# ─── Environment picker ───────────────────────────────────────────────────────
# Sets the global $WALLET_ENV to "development" or "production". Honors the
# pre-set env var if valid. Otherwise prompts on the controlling TTY.
# Falls back to "production" on non-interactive shells (CI / piped install).
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
    warn "No TTY available and WALLET_ENV not set — defaulting to 'production'."
    WALLET_ENV=production
    return
  fi

  hr
  printf '%s\n' "${C_BOLD}Which environment is this install for?${C_RESET}"
  hr
  cat <<EOF
  ${C_BOLD}1) development${C_RESET}  — NODE_ENV=development, default admin password
                    Admin1234, no nginx/systemd, skip auto-start.
                    After install: \`sudo -u ${DEPLOY_USER} npm run dev\`.
                    Use this for code work / debugging on a Linux box.

  ${C_BOLD}2) production${C_RESET}   — NODE_ENV=production, GENERATED strong admin
                    password, nginx reverse proxy on :${WEB_PORT},
                    wallet-api.service systemd unit, firewalld + SELinux.
                    Use this for a real deploy.
EOF
  echo
  while :; do
    printf '%s' "  Choice [1=development / 2=production] (default: 2): "
    read -r reply || reply=""
    case "${reply:-2}" in
      1|d|dev|development) WALLET_ENV=development; break ;;
      2|p|prod|production|"") WALLET_ENV=production; break ;;
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
  local candidate
  # Newest first; nullglob via shell builtin avoids surprises when nothing matches.
  shopt -s nullglob
  local matches=( "${REPO_ROOT}"/backups/wallet-*.sql.gz "${REPO_ROOT}"/backups/wallet-*.sql )
  shopt -u nullglob
  if [ ${#matches[@]} -eq 0 ]; then
    return 0
  fi
  # Sort by modification time, newest first. ls -t is portable enough for a
  # local installer; if you need ms precision pipe through stat instead.
  candidate="$(ls -1t "${matches[@]}" 2>/dev/null | head -1)"
  printf '%s\n' "${candidate}"
}
