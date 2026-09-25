#!/usr/bin/env bash
# Append PASS B's scene to the driver copy and register its dispatch arm.
#
# The driver copy `$TREE/scripts/renderer-driver-ux5.mjs` is UNTRACKED and is built
# from the HEAD's own `scripts/renderer-driver.mjs` plus rounds 1-5's helper layers
# and scenes (see the note in capture-ux5.sh). This only adds the arm and the scene
# appended at the end, so it is idempotent: re-running it after a rebuild re-applies.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TREE="${1:?usage: patch-driver-ux5b.sh <UI worktree>}"
DRIVER="$TREE/scripts/renderer-driver-ux5.mjs"
[[ -f "$DRIVER" ]] || { echo "no driver copy at $DRIVER" >&2; exit 1; }
python3 - "$DRIVER" "$HERE/scene-ux5b.js" <<'PYEOF'
import sys
driver, scene = sys.argv[1], sys.argv[2]
s = open(driver).read()
body = open(scene).read()
arm = '\t\t\telse if (SCENE === "btw-ux5b") await sceneBtwUx5b(cdp);\n'
if arm in s:
    print("arm already present")
else:
    anchor = '\t\t\telse if (SCENE === "btw-ux5") await sceneBtwUx5(cdp);\n'
    assert s.count(anchor) == 1, f"anchor not unique ({s.count(anchor)})"
    s = s.replace(anchor, anchor + arm)
if "async function sceneBtwUx5b" in s:
    # Replace a previously appended copy: cut at PASS B's own banner and re-append.
    marker = "/* ===================================================================== *\n *   UX ROUND 5, PASS B"
    idx = s.index(marker)
    s = s[:idx]
    print("previous PASS B append removed")
s = s + body
open(driver, "w").write(s)
print(f"driver now {len(s)} bytes")
PYEOF
node --check "$DRIVER"
echo "driver syntax OK; arms: $(grep -c 'else if (SCENE === "btw-ux5b")' "$DRIVER")"
