#!/usr/bin/env bash
# ╭───────────────────────────────────────────────────────────────────╮
# │  Wallet — status check (Rocky Linux 9)                            │
# │                                                                   │
# │  Reports the health of every moving part: PostgreSQL, the API     │
# │  systemd unit, nginx, ports, and HTTP probes. Read-only.          │
# ╰───────────────────────────────────────────────────────────────────╯

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "${SCRIPT_DIR}/lib/common.sh"
cd "$REPO_ROOT" || die "Cannot enter repo root: $REPO_ROOT"

banner "Wallet — status"
echo "  Repo  : $REPO_ROOT"
echo

# ─── Tooling ──────────────────────────────────────────────────────────────────
hr; printf '%s\n' "${C_BOLD}Tooling${C_RESET}"; hr
if have_cmd node;  then ok "Node       : $(node -v)";  else err "Node       : missing"; fi
if have_cmd npm;   then ok "npm        : $(npm -v)";   else err "npm        : missing"; fi
if [ -x /usr/pgsql-16/bin/psql ]; then
  ok "PostgreSQL : $(/usr/pgsql-16/bin/psql --version | head -1)"
else
  err "PostgreSQL : missing — run install.sh"
fi
if have_cmd nginx; then ok "nginx      : $(nginx -v 2>&1 | head -1)"; else err "nginx      : missing"; fi
echo

# ─── Services ─────────────────────────────────────────────────────────────────
hr; printf '%s\n' "${C_BOLD}systemd services${C_RESET}"; hr
for svc in postgresql-16 wallet-api nginx; do
  if systemctl is-active --quiet "$svc"; then
    ok "$(printf '%-14s' "$svc") active"
  else
    state="$(systemctl is-active "$svc" 2>/dev/null || echo unknown)"
    warn "$(printf '%-14s' "$svc") $state"
  fi
done
echo

# ─── PostgreSQL connection ────────────────────────────────────────────────────
hr; printf '%s\n' "${C_BOLD}PostgreSQL${C_RESET}"; hr
if pg_is_ready; then
  ok "Accepting connections on :${POSTGRES_PORT}"
  # I4 — Prefer peer auth (`sudo -u postgres psql`) so the table-count
  # diagnostic doesn't have to read the password from `.env`. Falls back
  # to DATABASE_URL only if peer auth isn't available (e.g. running as
  # a non-root remote-status helper). The previous shape leaked the
  # password into shell history + ps args when the script ran from a
  # tmux or screen.
  TABLES=""
  if command -v sudo >/dev/null 2>&1 && sudo -n -u postgres true 2>/dev/null; then
    TABLES="$(sudo -u postgres PSQL_PAGER='' /usr/pgsql-16/bin/psql -d wallet -tAc \
      "SELECT count(*) FROM pg_tables WHERE schemaname='public'" 2>/dev/null || echo "")"
    [ -n "$TABLES" ] && ok "Database has ${TABLES} tables (via peer auth)"
  fi
  if [ -z "$TABLES" ] && [ -f "$REPO_ROOT/apps/api/.env" ]; then
    # Fallback: read DATABASE_URL but DO NOT echo it. Pass via env so the
    # password doesn't end up in `ps`.
    DB_URL="$(grep -E '^DATABASE_URL=' "$REPO_ROOT/apps/api/.env" | head -1 | sed 's/^DATABASE_URL=//')"
    if [ -n "$DB_URL" ]; then
      TABLES="$(PSQL_PAGER='' DATABASE_URL="$DB_URL" /usr/pgsql-16/bin/psql "$DB_URL" -tAc \
        "SELECT count(*) FROM pg_tables WHERE schemaname='public'" 2>/dev/null || echo "?")"
      ok "Database has ${TABLES} tables (via DATABASE_URL fallback — peer auth preferred)"
    fi
  fi
else
  err "Not accepting connections — try: sudo systemctl restart postgresql-16"
fi
echo

# ─── Ports ────────────────────────────────────────────────────────────────────
hr; printf '%s\n' "${C_BOLD}Ports${C_RESET}"; hr
for entry in \
  "${POSTGRES_PORT}:PostgreSQL" \
  "${API_PORT}:API" \
  "${WEB_PORT}:Web (nginx)"; do
  port="${entry%%:*}"
  label="${entry#*:}"
  if port_in_use "$port"; then
    ok "$(printf '%-14s' "$label") :$port"
  else
    info "$(printf '%-14s' "$label") :$port  (not listening)"
  fi
done
echo

# ─── HTTP probes ──────────────────────────────────────────────────────────────
hr; printf '%s\n' "${C_BOLD}HTTP probes${C_RESET}"; hr
if curl -sSf --max-time 3 "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; then
  RESP="$(curl -sS --max-time 3 "http://127.0.0.1:${API_PORT}/health")"
  ok "API   /health → 200  $RESP"
else
  info "API   /health → not responding"
fi
if curl -sSf --max-time 3 -o /dev/null "http://127.0.0.1:${WEB_PORT}/"; then
  ok "nginx /        → 200"
else
  info "nginx /        → not responding"
fi
echo

# ─── Firewall ─────────────────────────────────────────────────────────────────
hr; printf '%s\n' "${C_BOLD}firewalld${C_RESET}"; hr
if systemctl is-active --quiet firewalld; then
  ok "Active. Open services/ports in current zone:"
  firewall-cmd --list-services 2>/dev/null | sed 's/^/    services: /'
  firewall-cmd --list-ports    2>/dev/null | sed 's/^/    ports   : /'
else
  warn "firewalld not active"
fi
echo

# ─── Logs ─────────────────────────────────────────────────────────────────────
hr; printf '%s\n' "${C_BOLD}Recent API log (last 10 lines)${C_RESET}"; hr
journalctl -u wallet-api -n 10 --no-pager 2>/dev/null || warn "Cannot read journal (need sudo?)"
echo
