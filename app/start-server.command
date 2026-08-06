#!/bin/bash
# start-server.command
#
# Double-click this file in Finder to build the app and serve it over http,
# so it can be opened in a real browser (file:// does not work for ES module
# imports -- see index.html's own top comment).
#
# NOT safe to delete. This is the standing mechanism for live browser
# validation of this project: the Cowork sandbox cannot reach a server
# running on this machine, so every browser-validation pass runs through
# here. (The original header called this a one-off Phase 10.1 helper and
# said it was safe to delete; that stopped being true several waves ago.)
#
# Also usable as a report-only preflight, for pasting into a session that
# cannot see this machine:
#
#     ./start-server.command --diagnose
#
# ---------------------------------------------------------------------------
# Why this script has a diagnostic path at all
#
# 2026-07-30: the app appeared broken in the browser -- every request 404ed.
# The actual cause was a server left running on :8000 by an earlier session,
# rooted in a directory that no longer resolved to this app after the folder
# was moved. This script's own server could not bind, exited, and the browser
# silently talked to the stale one instead. Two things made that expensive to
# find: all output went to server.log (so a double-click produced an identical
# empty window whether it worked or not), and nothing distinguished "port
# busy" from "app broken."
#
# So: output goes to the window AND the log, and the port is resolved rather
# than assumed. A stale server belonging to THIS app is reclaimed
# automatically; an unrelated process holding the port is left alone and
# stepped around. Do not re-add the plain `> server.log 2>&1` redirect.
# ---------------------------------------------------------------------------

set -o pipefail
cd "$(dirname "$0")" || { echo "Could not enter the app directory. Aborting."; exit 1; }

DEFAULT_PORT=8000
PORT_SEARCH_LIMIT=10
LOG=server.log

DIAGNOSE_ONLY=0
[ "$1" = "--diagnose" ] && DIAGNOSE_ONLY=1

: > "$LOG"
say() { echo "$@" | tee -a "$LOG"; }
run() { "$@" 2>&1 | tee -a "$LOG"; return "${PIPESTATUS[0]}"; }

# Pause only when a human is watching (Finder double-click gives a tty;
# piped/automated runs do not, and would hang forever on `read`).
pause_if_interactive() {
  if [ -t 0 ]; then
    echo
    echo "Press Return to close this window."
    read -r
  fi
}

# --- process/port helpers -------------------------------------------------
# lsof emits one row per protocol family, so the same process can appear
# twice; -t plus sort -u collapses that.
listeners_on() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | sort -u; }
pid_cwd()      { lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1; }
pid_cmd()      { ps -o command= -p "$1" 2>/dev/null; }
# Compared by UID, not by name: `ps -o user=` truncates long usernames on
# macOS, which would make one of our own servers look like a stranger.
pid_uid()      { ps -o uid= -p "$1" 2>/dev/null | tr -d ' '; }

# mtime, printed the same way on macOS (BSD stat) and Linux (GNU stat).
# Note `date -r FILE` is GNU-only -- on macOS `-r` means "seconds since
# epoch" and would fail here. Do not simplify this back to `date -r`.
# The BSD attempt is validated by shape rather than by exit status: GNU stat
# accepts `-f` as "format" and exits 0 while printing filesystem gibberish,
# so a plain `bsd || gnu` fallback would emit that gibberish.
file_mtime() {
  local out
  out=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$1" 2>/dev/null)
  case "$out" in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-*) printf '%s\n' "$out"; return 0 ;;
  esac
  stat -c "%y" "$1" 2>/dev/null | cut -d. -f1
}

port_free() { [ -z "$(listeners_on "$1")" ]; }

# "Ours" means: our own uid, running this app's server (serve.py, or the
# pre-2026-08-01 bare http.server it replaced). That is precisely what
# `npm run serve` starts, and it is the only thing this script is willing
# to kill. Anything else on the port is somebody else's business.
is_our_server() {
  [ "$(pid_uid "$1")" = "$(id -u)" ] && case "$(pid_cmd "$1")" in *http.server*|*serve.py*) return 0;; esac
  return 1
}
pid_user() { ps -o user= -p "$1" 2>/dev/null; }

# Kill $1 (one of OUR servers) and wait for the port to free up.
reclaim_holder() {
  kill "$1" 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    port_free "$DEFAULT_PORT" && break
    sleep 0.5
  done
  if ! port_free "$DEFAULT_PORT"; then
    say "       did not exit on TERM; sending KILL"
    kill -9 "$1" 2>/dev/null
    sleep 1
  fi
}

# =========================== preflight ====================================
say "=== preflight: $(date) ==="
say "    directory: $(pwd)"

PREFLIGHT_FAIL=0
need() { # need <label> <path-or-cmd> <kind>
  case "$3" in
    file) [ -e "$2" ] && say "    ok      $1" || { say "    MISSING $1  ($2)"; PREFLIGHT_FAIL=1; } ;;
    cmd)  command -v "$2" >/dev/null 2>&1 && say "    ok      $1  ($(command -v "$2"))" \
            || { say "    MISSING $1  ($2 not on PATH)"; PREFLIGHT_FAIL=1; } ;;
  esac
}

need "index.html"            index.html                   file
need "package.json"          package.json                 file
need "TypeScript installed"  node_modules/typescript      file
need "node"                  node                         cmd
need "npm"                   npm                          cmd
need "python3"               python3                      cmd
need "lsof"                  lsof                         cmd

if [ "$PREFLIGHT_FAIL" -ne 0 ]; then
  say
  say "Preflight failed. Nothing was built and no server was started."
  say "If TypeScript is the missing piece, run:  npm install"
  pause_if_interactive
  exit 1
fi

# ======================= port diagnosis ===================================
say
say "=== port check ==="
PORT=""
REUSE_EXISTING=0

EXISTING=$(listeners_on "$DEFAULT_PORT")
if [ -z "$EXISTING" ]; then
  say "    :$DEFAULT_PORT is free"
  PORT=$DEFAULT_PORT
else
  for pid in $EXISTING; do
    say "    :$DEFAULT_PORT held by pid $pid  ($(pid_user "$pid"))"
    say "      cmd: $(pid_cmd "$pid")"
    say "      cwd: $(pid_cwd "$pid")"
  done

  # Single holder that is one of ours -- decide reuse vs. reclaim.
  HOLDER=$(echo "$EXISTING" | head -1)
  if [ "$(echo "$EXISTING" | wc -l | tr -d ' ')" = "1" ] && is_our_server "$HOLDER"; then
    if [ "$(pid_cwd "$HOLDER")" = "$(pwd)" ]; then
      case "$(pid_cmd "$HOLDER")" in
      *serve.py*)
        say "    -> that is this app's own server, already serving this folder."
        say "       Reusing it (a static server reads from disk, so it will pick"
        say "       up the fresh build automatically)."
        PORT=$DEFAULT_PORT
        REUSE_EXISTING=1
        ;;
      *)
        # 2026-08-01: an OLD bare `http.server` from before serve.py --
        # it sends no Cache-Control, which is the root of the
        # blank-first-refresh / needs-Cmd-Shift-R behavior. Replace it.
        say "    -> this app's OLD bare http.server (no Cache-Control -- the"
        say "       blank-first-refresh bug). Restarting it as serve.py."
        if [ "$DIAGNOSE_ONLY" -eq 1 ]; then
          say "       (--diagnose: not killing anything)"
          PORT=$DEFAULT_PORT
        else
          reclaim_holder "$HOLDER"
          if port_free "$DEFAULT_PORT"; then
            say "       reclaimed :$DEFAULT_PORT"
            PORT=$DEFAULT_PORT
          else
            say "       could not reclaim :$DEFAULT_PORT"
          fi
        fi
        ;;
      esac
    else
      say "    -> stale server from an earlier session, serving a different folder."
      say "       This is the 404 failure mode. Reclaiming the port."
      if [ "$DIAGNOSE_ONLY" -eq 1 ]; then
        say "       (--diagnose: not killing anything)"
        PORT=$DEFAULT_PORT
      else
        reclaim_holder "$HOLDER"
        if port_free "$DEFAULT_PORT"; then
          say "       reclaimed :$DEFAULT_PORT"
          PORT=$DEFAULT_PORT
        else
          say "       could not reclaim :$DEFAULT_PORT"
        fi
      fi
    fi
  else
    say "    -> not this app's server. Leaving it alone."
  fi

  # Unrelated process, or reclaim failed: step around it rather than stop.
  if [ -z "$PORT" ]; then
    candidate=$((DEFAULT_PORT + 1))
    limit=$((DEFAULT_PORT + PORT_SEARCH_LIMIT))
    while [ "$candidate" -le "$limit" ]; do
      if port_free "$candidate"; then PORT=$candidate; break; fi
      candidate=$((candidate + 1))
    done
    if [ -n "$PORT" ]; then
      say "    -> using :$PORT instead"
    else
      say "    -> no free port in $DEFAULT_PORT-$limit. Cannot start."
      pause_if_interactive
      exit 1
    fi
  fi
fi

# ============================ diagnose-only ===============================
if [ "$DIAGNOSE_ONLY" -eq 1 ]; then
  say
  say "=== dist/ state ==="
  if [ -f dist/ui/app.js ]; then
    say "    dist/ui/app.js  $(file_mtime dist/ui/app.js)"
    say "    src/ui/app.ts   $(file_mtime src/ui/app.ts)"
    if [ src/ui/app.ts -nt dist/ui/app.js ]; then
      say "    STALE: src is newer than dist. The browser would serve old code."
    else
      say "    dist is current relative to src/ui/app.ts"
    fi
  else
    say "    dist/ui/app.js missing -- never built"
  fi
  say
  say "=== typecheck ==="
  run npx tsc --noEmit && say "    tsc --noEmit clean" || say "    tsc --noEmit FAILED (above)"
  say
  say "=== verify suites present ==="
  say "    $(ls verify/*.ts 2>/dev/null | wc -l | tr -d ' ') suites in verify/"
  say
  say "Diagnose complete. Nothing was built, killed, or started."
  say "Full copy of this report: $(pwd)/$LOG"
  pause_if_interactive
  exit 0
fi

# =============================== build ====================================
say
say "=== build started: $(date) ==="
run npm run build
BUILD_EXIT=$?
say "=== build finished, exit code: $BUILD_EXIT ==="
if [ "$BUILD_EXIT" -ne 0 ]; then
  say "=== build failed, not starting server ==="
  pause_if_interactive
  exit 1
fi

# =============================== serve ====================================
say
if [ "$REUSE_EXISTING" -eq 1 ]; then
  say "=== reusing the server already running on :$PORT ==="
  say
  say "    Open:  http://localhost:$PORT/index.html"
  say
  say "The fresh build is live -- reload the browser (Cmd-Shift-R) to pick it up."
  say "This window can be closed; it does not own that server."
  pause_if_interactive
  exit 0
fi

say "=== serving $(pwd) on :$PORT ==="
say
say "    Open:  http://localhost:$PORT/index.html"
say
say "Leave this window open while validating. Ctrl-C here stops the server."
say

# Invoked directly rather than through `npm run serve` so the port can vary
# when :8000 is taken. package.json's "serve" script is the same command with
# the port hardcoded -- if that script changes, change this line to match.
# serve.py (2026-08-01) sends Cache-Control: no-cache so plain reloads are
# always version-consistent -- see its docstring for the bug this fixed.
run python3 serve.py "$PORT"
