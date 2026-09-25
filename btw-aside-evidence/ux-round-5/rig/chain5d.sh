#!/usr/bin/env bash
# Round 5's final passes.
#
#  1. PASS B (btw-ux5b) once more, with the reader fixed: the current conversation is read
#     from the button that carries `aria-current`, and b04's wire reading now comes BEFORE
#     the fresh ask, because `ux4BaseWith` presses Esc on a panel that is up and that Esc is
#     a real close (which is why the last run's b04 saw the entry at 404).
#  2. round 3's scene THREE more times at this head. Its 6a step read the held-message lane
#     in the first run and not in the second, at the same head and with the same earlier
#     steps, so the state is intermittent and a rate needs more than one sample. Each run
#     also carries the band's own node structure, so a fire can be described from the DOM.
set -u
RIG=/Users/damian/.local-operator/sessions/bde1c5028625/scratchpad/ux5rig
TREE=/Users/damian/local-operator-ui-worktrees/ux482-r5-7c31f9
cd "$RIG" || exit 1
export UX5_UI_TREE=$TREE
export UX5_BACKEND_TREE=/Users/damian/local-operator-worktrees/ux482-r5-7c31f9

python3 - "$TREE/scripts/renderer-driver-ux5.mjs" <<'PYEOF'
import sys
p = sys.argv[1]
s = open(p).read()
old = '\tlog("6a the band\'s own structure at the press", await ux5bBandShape(cdp));\n'
assert s.count(old) == 1, f"probe anchor not unique ({s.count(old)})"
new = old + '''\tlog("6a what the wire says at the press", {
\t\tasidePosts: r3stats().asidePosts?.length ?? null,
\t\tmessagePosts: r3stats().messagePosts?.length ?? null,
\t\tasideOps: r3stats().asideOps?.length ?? null,
\t\tsendLabel: busy.sendLabel,
\t});
'''
if "6a what the wire says at the press" not in s:
    s = s.replace(old, new)
    open(p, "w").write(s)
    print("6a wire probe added")
else:
    print("6a wire probe already present")
PYEOF
node --check "$TREE/scripts/renderer-driver-ux5.mjs" || exit 1
bash ./patch-driver-ux5b.sh "$TREE" >/dev/null || exit 1
bash ./probe-band-ux5.sh "$TREE" >/dev/null || exit 1
node --check "$TREE/scripts/renderer-driver-ux5.mjs" || exit 1
echo "driver patched: $(grep -c 'function ux5bBandShape' "$TREE/scripts/renderer-driver-ux5.mjs") helper(s)"

run() { echo "### pass $2 ($1) at $(date -u +%H:%M:%S)"; bash ./run-ux5.sh "$1" "$2" "$3" 2>&1 | tail -5; }
run btw-ux5b ux5fold4   800x900
run btw-ux3  ux5r3wide4 1380x900
run btw-ux3  ux5r3wide5 1380x900
run btw-ux3  ux5r3wide6 1380x900
echo "### chain5d done at $(date -u +%H:%M:%S)"
