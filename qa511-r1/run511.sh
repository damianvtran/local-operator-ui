#!/bin/bash
# QA r1 PR 511: run the named scenarios on one tree, serially, each in its own
# process group under a bound. Scratch only; nothing is killed by name.
# usage: run511.sh <head|prev> <bound-seconds> <scenario...>
S="$LOCAL_OPERATOR_SCRATCHPAD/qa511r1"
cd "$S" || exit 2
label=$1; shift
bound=$1; shift
case $label in
  head) T="$HOME/local-operator-ui-worktrees/qa511r1-9f3c-head";;
  prev) T="$HOME/local-operator-ui-worktrees/qa511r1-9f3c-prev";;
  *) echo "usage: run511.sh <head|prev> <bound> <scenario...>"; exit 2;;
esac
mkdir -p "$S/out" "$S/console"
for s in "$@"; do
  echo "# $label $s start $(date +%H:%M:%S)"
  env -u XPC_FLAGS python3 "$S/legacy490r7/rig/bounded.py" "$bound" "$S" \
    node "$S/rig511.mjs" --tree "$T" --label "$label" --scen "$S/scen511/$s.json" --out "$S/out" --port 46731 \
    > "$S/console/console-$label-$s.log" 2>&1
  echo "# $label $s rc=$? $(date +%H:%M:%S)"
done
echo "# $label done $(date +%H:%M:%S)"
