#!/usr/bin/env bash
# Terminate only this project's Electron processes.
#
# `pkill -f "electron ."` does NOT match them: the real command line is
# .../Electron.app/Contents/MacOS/Electron, so that pattern silently no-ops and
# instances pile up until the single-instance lock blocks every new launch.
set -uo pipefail

# Matches three shapes: the packaged app, the Electron.app binary, and the
# `node .../.bin/electron` wrapper npm leaves behind. Missing the wrapper let
# stale processes hold the single-instance lock and block every new launch.
PATTERN="[B]iblePortal.*(node_modules/electron|node_modules/\\.bin/electron)|[B]iblePortal Studio\\.app"
count=$(ps aux | grep -cE "$PATTERN" || true)
export PPID

if [ "$count" -eq 0 ]; then echo "[stop] nothing running"; exit 0; fi

pids() {
  ps aux | grep -E "$PATTERN" | awk '{print $2}' \
    | grep -vx "$$" | grep -vx "$PPID" || true
}

pids | xargs -r kill -TERM 2>/dev/null || true
for _ in $(seq 1 10); do
  remaining=$(ps aux | grep -cE "$PATTERN" || true)
  [ "$remaining" -eq 0 ] && break
  sleep 1
done

remaining=$(ps aux | grep -cE "$PATTERN" || true)
if [ "$remaining" -gt 0 ]; then
  pids | xargs -r kill -KILL 2>/dev/null || true
fi
echo "[stop] terminated $count process(es)"
