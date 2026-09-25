#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"
while ! grep -q 'chain7b done' chain7b.log 2>/dev/null; do sleep 15; done
R=$PWD/switch
mkdir -p "$R/home" "$R/tmp"
TREE=/Users/damian/local-operator-ui-worktrees/qa-482-r7
echo "===== chain7c start $(date -u +%H:%M:%S) ====="
cd "$TREE" || exit 1
env -i HOME=$R/home PATH="$PATH" TMPDIR=$R/tmp TERM=xterm-256color \
  GIT_CONFIG_SYSTEM=/dev/null GIT_TERMINAL_PROMPT=0 \
  nohup pnpm exec vite --config scripts/session-switch.vite.mjs --port 5211 --strictPort > "$R/vite.log" 2>&1 &
VITE_PID=$!
for _ in $(seq 1 200); do lsof -nP -iTCP:5211 -sTCP:LISTEN -t >/dev/null 2>&1 && break; sleep 0.5; done
lsof -nP -iTCP:5211 -sTCP:LISTEN -t >/dev/null 2>&1 || { echo "vite never listened on 5211"; cat "$R/vite.log" | tail -20; kill $VITE_PID 2>/dev/null; exit 1; }
echo "vite up pid $VITE_PID on 5211"
env -i HOME=$R/home PATH="$PATH" TMPDIR=$R/tmp TERM=xterm-256color \
  GIT_CONFIG_SYSTEM=/dev/null GIT_TERMINAL_PROMPT=0 \
  node scripts/session-switch-latency.mjs --held-leave --stream=2500 --json > "$R/held-leave.json" 2>&1
echo "held-leave exit $?"
env -i HOME=$R/home PATH="$PATH" TMPDIR=$R/tmp TERM=xterm-256color \
  GIT_CONFIG_SYSTEM=/dev/null GIT_TERMINAL_PROMPT=0 \
  node scripts/session-switch-latency.mjs --held-stay --stream=2500 --json > "$R/held-stay.json" 2>&1
echo "held-stay exit $?"
kill $VITE_PID 2>/dev/null; sleep 1; kill -9 $VITE_PID 2>/dev/null
lsof -nP -iTCP:5211 -sTCP:LISTEN -t 2>/dev/null | head -1
echo "===== chain7c done $(date -u +%H:%M:%S) ====="
