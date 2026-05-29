#!/usr/bin/env bash
# ╭───────────────────────────────────────────────────────────────────╮
# │  Wallet — start the project                                       │
# │                                                                   │
# │  Run this from Terminal every time you want to work:              │
# │    cd installers/macos && ./start.sh                              │
# │                                                                   │
# │  It will:                                                         │
# │    1. Make sure PostgreSQL is running                             │
# │    2. Start the API server (port 3000) and Web app (port 8080)    │
# │    3. Open http://localhost:8080 in your browser                  │
# │    4. Tail the server log so you can see what's happening         │
# │                                                                   │
# │  Press Ctrl+C in this window to stop the servers.                 │
# │  PostgreSQL keeps running in the background (it's a launchd       │
# │  service). Use ./stop.sh to shut it down too.                     │
# ╰───────────────────────────────────────────────────────────────────╯

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "${SCRIPT_DIR}/lib/common.sh"

require_macos
ensure_brew_in_path
mkdir -p "$LOG_DIR"
DEV_LOG="${LOG_DIR}/dev.log"
cd "$REPO_ROOT" || die "Cannot enter repo root: $REPO_ROOT"

banner "Wallet — starting"
info "Repo root : $REPO_ROOT"
info "Dev log   : $DEV_LOG"
echo

# ─── 1) Preflight: have we ever installed? ────────────────────────────────────
if [ ! -d "$REPO_ROOT/node_modules" ] || [ ! -f "$REPO_ROOT/.env" ]; then
  warn "It looks like install.sh was never run."
  warn "Please run ./install.sh first (one-time setup)."
  printf '%b\n' "${C_DIM}Press Enter to close...${C_RESET}"
  read -r _ || true
  exit 1
fi

# ─── 2) PostgreSQL service ────────────────────────────────────────────────────
banner "1/3  PostgreSQL"
case "$(pg_service_status)" in
  started)
    if pg_is_ready; then
      ok "PostgreSQL is up on :${POSTGRES_PORT}"
    else
      warn "Service is 'started' but not accepting connections — restarting..."
      brew services restart "$PG_FORMULA" >/dev/null
      wait_for_pg 20 || die "PostgreSQL failed to restart. Run: brew services info $PG_FORMULA"
    fi
    ;;
  stopped)
    info "Starting PostgreSQL service..."
    brew services start "$PG_FORMULA" >/dev/null
    wait_for_pg 20 || die "PostgreSQL failed to start. Run: brew services info $PG_FORMULA"
    ok "PostgreSQL ready"
    ;;
  missing)
    die "PostgreSQL is not installed. Run ./install.sh first."
    ;;
esac
echo

# ─── 3) Stop any leftover dev tree from a previous run ────────────────────────
banner "2/3  Cleanup leftover processes"
OLD_PID="$(read_pid)"
if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
  info "Stopping previous dev tree (pid $OLD_PID)..."
  kill_pid_tree "$OLD_PID"
fi
clear_pid

if port_in_use "$API_PORT"; then
  warn "Port :$API_PORT is held by another process. Free it before starting."
  lsof -nP -iTCP:$API_PORT -sTCP:LISTEN
  die "Stop the conflicting process and try again."
fi
if port_in_use "$WEB_PORT"; then
  warn "Port :$WEB_PORT is held by another process. Free it before starting."
  lsof -nP -iTCP:$WEB_PORT -sTCP:LISTEN
  die "Stop the conflicting process and try again."
fi
ok "Ports :$API_PORT and :$WEB_PORT free"
echo

# ─── 4) Start API + Web ───────────────────────────────────────────────────────
banner "3/3  npm run dev (API + Web)"
info "Launching servers; logs stream below."
# Run in a fresh process group so we can kill the whole tree later.
( cd "$REPO_ROOT" && setsid -w npm run dev </dev/null >"$DEV_LOG" 2>&1 ) &
DEV_PID=$!
write_pid "$DEV_PID"
info "Dev process group leader pid: $DEV_PID"

# ─── 5) Wait for both ports ───────────────────────────────────────────────────
wait_for_url "API"  "http://localhost:${API_PORT}/health" 60 || {
  warn "API didn't come up. Tail of log:"
  tail -40 "$DEV_LOG"
  die "API failed to start. See full log: $DEV_LOG"
}
wait_for_port "Vite" "$WEB_PORT" 60 || {
  warn "Vite didn't come up. Tail of log:"
  tail -40 "$DEV_LOG"
  die "Vite failed to start. See full log: $DEV_LOG"
}
echo

# ─── 6) Open browser ──────────────────────────────────────────────────────────
hr
printf '%b\n' "${C_GREEN}${C_BOLD}  ✓ Wallet is running${C_RESET}"
hr
cat <<EOF

  ${C_BOLD}Web app${C_RESET}   http://localhost:${WEB_PORT}
  ${C_BOLD}API${C_RESET}       http://localhost:${API_PORT}

  Sign in:
    Email     ${ADMIN_EMAIL_DEFAULT}
    Password  ${ADMIN_PASS_DEFAULT}

  ${C_DIM}This window will keep showing live logs. To stop the servers:${C_RESET}
    • Press Ctrl+C, or
    • Run ./stop.sh from another terminal

EOF
open "http://localhost:${WEB_PORT}" 2>/dev/null || true

# ─── 7) Trap SIGINT/SIGTERM so closing the window kills the dev tree ──────────
on_exit() {
  echo
  info "Shutting down dev tree (pid $DEV_PID)..."
  kill_pid_tree "$DEV_PID"
  clear_pid
  ok "Servers stopped. (PostgreSQL is still running as a background service.)"
}
trap on_exit EXIT INT TERM

# ─── 8) Stream logs ───────────────────────────────────────────────────────────
hr
printf '%b\n' "${C_DIM}--- live logs (Ctrl+C to stop) ---${C_RESET}"
hr
tail -F "$DEV_LOG"
