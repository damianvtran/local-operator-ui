#!/bin/bash
# QA r3 PR 490: run each scenario on the given label/tree, serially (host memory).
cd "$LOCAL_OPERATOR_SCRATCHPAD/r4"; read H P < worktrees.txt
label=$1; shift
case $label in head) T=$H; PORT=46711;; prev) T=$P; PORT=46711;; esac
for s in "$@"; do
  env -u XPC_FLAGS node qa-rig-r3.mjs --tree "$T" --label $label --scen scen3/$s.json --out out --port $PORT 2>&1 | grep -v '^# ' >> out/console-$label.jsonl
done
