#!/usr/bin/env bash
# Builds scripts/renderer-driver-qa2.mjs in the QA worktree: a COPY of the
# driver at the PR head + round 1's helper layer + the round 2 scenes, with two
# dispatch arms added. The shipped driver and the app source are not modified.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TREE="$1"
SRC="$TREE/scripts/renderer-driver.mjs"
DST="$TREE/scripts/renderer-driver-qa2.mjs"
python3 - "$SRC" "$DST" "$HERE" <<'PY'
import sys
src, dst, here = sys.argv[1:]
s = open(src).read()
anchor = '\t\t\telse if (SCENE === "btw-aside") await sceneBtwAside(cdp);\n'
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + '\t\t\telse if (SCENE === "btw-r2") await sceneBtwR2(cdp);\n\t\t\telse if (SCENE === "btw-r2-compat") await sceneBtwR2Compat(cdp);\n')
s += "\n" + open(f"{here}/helpers-r1.js").read() + "\n" + open(f"{here}/scene-r2.js").read()
open(dst, "w").write(s)
PY
node --check "$DST" && shasum -a 256 "$DST" "$HERE/scene-r2.js" "$HERE/helpers-r1.js"
