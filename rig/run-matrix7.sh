#!/bin/bash
# QA r7 PR 490: run each scenario on the given label/tree, serially (host memory),
# each run in its own process group under a bound so a wedged run cannot hold the
# queue and nothing is ever killed by name. Scratch only.
#
# usage: run-matrix7.sh <head|prev> <bound-seconds> <scenario...>
S="$LOCAL_OPERATOR_SCRATCHPAD/r7"
cd "$S" || exit 2
label=$1; shift
bound=$1; shift
case $label in
  head) T="$HOME/local-operator-ui/.worktrees/qa490r7-head-40ac63";;
  prev) T="$HOME/local-operator-ui/.worktrees/qa490r7-prev-40ac63";;
  *) echo "usage: run-matrix7.sh <head|prev> <bound> <scenario...>"; exit 2;;
esac
mkdir -p "$S/out" "$S/console"
for s in "$@"; do
  echo "# $label $s start $(date +%H:%M:%S)"
  env -u XPC_FLAGS python3 "$S/bounded.py" "$bound" "$S" \
    node "$S/rig.mjs" --tree "$T" --label "$label" --scen "$S/scen3/$s.json" --out "$S/out" --port 46721 \
    >> "$S/console/console-$label.jsonl" 2>&1
  echo "# $label $s rc=$? $(date +%H:%M:%S)"
done
