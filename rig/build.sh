#!/bin/bash
# QA r7 PR 490: build one worktree (no bytecode), stub API URL, placeholder OAuth
# vars, no secrets. Scratch only; never part of the repo. rc recorded so a build
# killed mid-render is legible.
w=$1
# In-repo worktree, because the shared node_modules' internal pnpm links are
# relative paths that only resolve at this depth (see operator notes).
D="$HOME/local-operator-ui/.worktrees/qa490r7-$w-40ac63"
S="$LOCAL_OPERATOR_SCRATCHPAD/r7"
cd "$D" || exit 2
test -f node_modules/electron-vite/bin/electron-vite.js || { echo "tree $D: electron-vite unresolved"; exit 3; }
export LOCAL_OPERATOR_UI_NO_BYTECODE=true
export VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:46721
export VITE_DISABLE_BACKEND_MANAGER=true
export VITE_GOOGLE_CLIENT_ID=qa-placeholder VITE_GOOGLE_CLIENT_SECRET=qa-placeholder
export VITE_MICROSOFT_CLIENT_ID=qa-placeholder VITE_MICROSOFT_TENANT_ID=qa-placeholder
export NODE_OPTIONS=--max-old-space-size=6144
env -u XPC_FLAGS ./node_modules/.bin/electron-vite build > "$S/build-$w.log" 2>&1
rc=$?
echo "$rc $(date +%H:%M:%S)" > "$S/rc-$w.txt"
echo "build $w rc=$rc at $(date +%H:%M:%S)"
