#!/bin/bash
# QA r6 PR 490: build one worktree the build:npm way (no bytecode), stub API URL,
# placeholder OAuth vars. Scratch only; never part of the repo.
# rc is recorded in $S/rc-<tree>.txt so a build killed mid-render is legible.
w=$1
D="$HOME/local-operator-ui-worktrees/qa490r6-$w-e740e5"
S="$LOCAL_OPERATOR_SCRATCHPAD/r6"
cd "$D" || exit 2
export LOCAL_OPERATOR_UI_NO_BYTECODE=true
export VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:46711
export VITE_DISABLE_BACKEND_MANAGER=true
export VITE_GOOGLE_CLIENT_ID=[redacted] VITE_GOOGLE_CLIENT_SECRET=[redacted]
export VITE_MICROSOFT_CLIENT_ID=[redacted] VITE_MICROSOFT_TENANT_ID=[redacted]
export NODE_OPTIONS=--max-old-space-size=6144
env -u XPC_FLAGS ./node_modules/.bin/electron-vite build > "$S/build-$w.log" 2>&1
rc=$?
echo "$rc $(date +%H:%M:%S)" > "$S/rc-$w.txt"
echo "build $w rc=$rc at $(date +%H:%M:%S)"
