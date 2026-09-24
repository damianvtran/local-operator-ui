#!/bin/bash
# QA r5 PR 490: build one worktree the build:npm way (no bytecode), stub API URL, placeholder OAuth vars.
w=$1
cd "$HOME/local-operator-ui-worktrees/qa490r5-$w-ca83b1" || exit 2
export LOCAL_OPERATOR_UI_NO_BYTECODE=true
export VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:46711
export VITE_DISABLE_BACKEND_MANAGER=true
export VITE_GOOGLE_CLIENT_ID=qa-placeholder VITE_GOOGLE_CLIENT_SECRET=qa-placeholder
export VITE_MICROSOFT_CLIENT_ID=qa-placeholder VITE_MICROSOFT_TENANT_ID=qa-placeholder
./node_modules/.bin/electron-vite build > "$LOCAL_OPERATOR_SCRATCHPAD/r4/build-$w.log" 2>&1
echo "build $w rc=$?"
