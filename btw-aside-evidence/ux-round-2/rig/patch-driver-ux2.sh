#!/usr/bin/env bash
# Builds scripts/renderer-driver-ux2.mjs (UNTRACKED) in the review worktree: a COPY of
# the driver at the PR head + QA round 1's helper layer + this round's scene, with one
# dispatch arm added. The shipped driver and the app source are not modified.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TREE="$1"
python3 - "$TREE/scripts/renderer-driver.mjs" "$TREE/scripts/renderer-driver-ux2.mjs" "$HERE" <<'PY'
import sys
src, dst, here = sys.argv[1:]
s = open(src).read()
anchor = '\t\t\telse if (SCENE === "btw-aside") await sceneBtwAside(cdp);\n'
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + "\t\t\telse if (SCENE === \"btw-ux2\") await sceneBtwUx2(cdp);\n\t\t\telse if (SCENE === \"btw-ux2b\") await sceneBtwUx2b(cdp);\n\t\t\telse if (SCENE === \"btw-ux2c\") await sceneBtwUx2c(cdp);\n")
s += "\n" + open(f"{here}/ux-helpers.js").read() + "\n" + open(f"{here}/ux2-scene.js").read()
open(dst, "w").write(s)
PY
node --check "$TREE/scripts/renderer-driver-ux2.mjs" && shasum -a 256 "$TREE/scripts/renderer-driver-ux2.mjs" "$HERE/ux2-scene.js"
