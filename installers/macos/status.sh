#!/usr/bin/env bash
# ╭───────────────────────────────────────────────────────────────────╮
# │  Wallet — status check                                            │
# │                                                                   │
# │  Reports the health of every moving part: PostgreSQL service,     │
# │  ports, API, Web. Read-only — changes nothing.                    │
# ╰───────────────────────────────────────────────────────────────────╯

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "${SCRIPT_DIR}/lib/common.sh"
require_macos
ensure_brew_in_path
cd "$REPO_ROOT" || die "Cannot enter repo root: $REPO_ROOT"

banner "Wallet — status"
echo "  Repo  : $REPO_ROOT"
echo

# ─── Tools ────────────────────────────────────────────────────────────────────
hr; printf '%b\n' "${C_BOLD}Tooling${C_RESET}"; hr
if have_cmd brew;   then ok "Homebrew     : $(brew --version | head -1)"; else err "Homebrew     : missing"; fi
if have_cmd node;   then ok "Node         : $(node -v)";                  else err "Node         : missing"; fi
if have_cmd npm;    then ok "npm          : $(npm -v)";                   else err "npm          : missing"; fi
if PSQL="$(pg_bin psql)" && [ -x "$PSQL" ]; then
  ok "PostgreSQL   : $("$PSQL" --version | head -1) (keg: $(pg_keg_prefix))"
else
  err "PostgreSQL   : missing — run ./install.sh"
fi
echo

# ─── PostgreSQL service ───────────────────────────────────────────────────────
hr; printf '%b\n' "${C_BOLD}PostgreSQL${C_RESET}"; hr
case "$(pg_service_status)" in
  started)
    ok "Service ${PG_FORMULA} is started"
    if pg_is_ready; then
      ok "Accepting connections on :${POSTGRES_PORT}"
    else
      warn "Service is up but :${POSTGRES_PORT} is not responding — try: brew services restart $PG_FORMULA"
    fi
    ;;
  stopped) warn "Service ${PG_FORMULA} is stopped — run ./start.sh to start it" ;;
  missing) err "Service ${PG_FORMULA} not installed — run ./install.sh" ;;
esac

# Database existence check
if pg_is_ready; then
  PSQL="$(pg_bin psql)"
  if PGPASSWORD="${PG_PASS}" "$PSQL" -h localhost -p "$POSTGRES_PORT" -U "${PG_USER}" -d "${PG_DB}" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'" 2>/dev/null | head -1 >/tmp/wallet-status-tables; then
    TABLE_COUNT="$(cat /tmp/wallet-status-tables)"
    rm -f /tmp/wallet-status-tables
    ok "Database '${PG_DB}' has ${TABLE_COUNT} tables (user=${PG_USER})"
  else
    warn "Database '${PG_DB}' or role '${PG_USER}' missing — re-run ./install.sh"
  fi
fi
echo

# ─── Ports ────────────────────────────────────────────────────────────────────
hr; printf '%b\n' "${C_BOLD}Ports${C_RESET}"; hr
for entry in \
  "${POSTGRES_PORT}:PostgreSQL" \
  "${API_PORT}:API" \
  "${WEB_PORT}:Web (Vite)"; do
  port="${entry%%:*}"
  label="${entry#*:}"
  if port_in_use "$port"; then
    ok "$(printf '%-12s' "$label") :$port"
  else
    info "$(printf '%-12s' "$label") :$port  (not listening)"
  fi
done
echo

# ─── Live HTTP probes ─────────────────────────────────────────────────────────
hr; printf '%b\n' "${C_BOLD}HTTP probes${C_RESET}"; hr
if curl -sSf --max-time 3 "http://localhost:${API_PORT}/health" >/dev/null 2>&1; then
  RESP="$(curl -sS --max-time 3 "http://localhost:${API_PORT}/health")"
  ok "API  /health → 200  $RESP"
else
  info "API  /health → not responding"
fi
if curl -sSf --max-time 3 -o /dev/null "http://localhost:${WEB_PORT}/"; then
  ok "Vite /        → 200"
else
  info "Vite /        → not responding"
fi
echo

# ─── Useful URLs ──────────────────────────────────────────────────────────────
hr; printf '%b\n' "${C_BOLD}Quick links${C_RESET}"; hr
echo "  Web app   http://localhost:${WEB_PORT}"
echo "  API       http://localhost:${API_PORT}"
echo "  Database  host=localhost  port=${POSTGRES_PORT}  user=${PG_USER}  pass=${PG_PASS}  db=${PG_DB}"
echo "            (open with TablePlus, Postico, pgAdmin, or any Postgres client)"
echo
printf '%b\n' "${C_DIM}Press Enter to close...${C_RESET}"
read -r _ || true
