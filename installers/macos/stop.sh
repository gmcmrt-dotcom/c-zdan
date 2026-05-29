#!/usr/bin/env bash
# ╭───────────────────────────────────────────────────────────────────╮
# │  Wallet — stop the project                                        │
# │                                                                   │
# │  Stops the API and Web dev servers.                               │
# │                                                                   │
# │  PostgreSQL is left running because it auto-starts at login (and  │
# │  costs almost nothing to keep up). If you want to stop it too,    │
# │  run:                                                             │
# │     ./stop.sh --all                                               │
# ╰───────────────────────────────────────────────────────────────────╯

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "${SCRIPT_DIR}/lib/common.sh"
require_macos
ensure_brew_in_path
cd "$REPO_ROOT" || die "Cannot enter repo root: $REPO_ROOT"

STOP_ALL=false
[ "${1:-}" = "--all" ] && STOP_ALL=true

banner "Wallet — stop"

# 1) Dev servers
OLD_PID="$(read_pid)"
if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
  info "Stopping dev process tree (pid $OLD_PID)..."
  kill_pid_tree "$OLD_PID"
  ok "Dev servers stopped"
else
  info "No dev tree pidfile — checking ports anyway."
fi
clear_pid

# Defensive: kill anything still on :3000 / :8080
for p in "$API_PORT" "$WEB_PORT"; do
  if port_in_use "$p"; then
    info "Port :$p still in use — killing holders."
    PIDS="$(lsof -nP -iTCP:$p -sTCP:LISTEN -t 2>/dev/null || true)"
    for pid in $PIDS; do kill_pid_tree "$pid"; done
  fi
done

# 2) (Optional) stop Postgres too
if [ "$STOP_ALL" = true ]; then
  if [ "$(pg_service_status)" = "started" ]; then
    info "Stopping PostgreSQL service (--all)..."
    brew services stop "$PG_FORMULA" >/dev/null && ok "PostgreSQL stopped" || warn "Failed to stop PostgreSQL"
  else
    info "PostgreSQL was not running."
  fi
fi

# 3) Final port check
echo
hr
printf '%b\n' "${C_BOLD}Port status${C_RESET}"
hr
for port in "$API_PORT" "$WEB_PORT" "$POSTGRES_PORT"; do
  if port_in_use "$port"; then
    printf '  ${C_RED}●${C_RESET} %s still in use\n' ":$port"
  else
    printf '  ${C_GREEN}○${C_RESET} %s free\n' ":$port"
  fi
done
echo

if [ "$STOP_ALL" = false ] && [ "$(pg_service_status)" = "started" ]; then
  info "PostgreSQL is still running (it auto-starts at login)."
  info "To stop it too: ./stop.sh --all"
fi

info "All done. Run ./start.sh to bring it back up."
printf '%b\n' "${C_DIM}Press Enter to close...${C_RESET}"
read -r _ || true
