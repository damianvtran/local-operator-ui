#!/bin/bash
# QA round 2, PR 511: run the named scenarios on one tree, serially, each in its own
# process group under a bound. Scratch only; nothing is killed by name.
# usage: run2.sh <head|prev> <port> <bound-seconds> <scenario...>
S="$LOCAL_OPERATOR_SCRATCHPAD/r2"
cd "$S" || exit 2
label=$1; port=$2; shift 2
bound=$1; shift
case $label in
  head) T="$HOME/local-operator-ui-worktrees/qa511r2-9c41-head";;
  prev) T="$HOME/local-operator-ui-worktrees/qa511r2-9c41-prev";;
  parent) T="$HOME/local-operator-ui-worktrees/qa511r2-9c41-parent";;
  *) echo "usage: run2.sh <head|prev> <port> <bound> <scenario...>"; exit 2;;
esac
mkdir -p "$S/out" "$S/console"
for s in "$@"; do
  echo "# $label $s start $(date +%H:%M:%S)"
  env -u XPC_FLAGS python3 "$S/bounded.py" "$bound" "$S" \
    node "$S/r2rig.mjs" --tree "$T" --label "$label" --scen "$S/scen/$s.json" --out "$S/out" --port "$port" \
    > "$S/console/console-$label-$s.log" 2>&1
  echo "# $label $s rc=$? $(date +%H:%M:%S)"
done
echo "# $label done $(date +%H:%M:%S)"
