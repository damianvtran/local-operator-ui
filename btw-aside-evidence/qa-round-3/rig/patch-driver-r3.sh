#!/usr/bin/env bash
# Builds scripts/renderer-driver-qa3.mjs in the QA worktree: a COPY of the driver at
# the PR head + round 1/2's helper layer + round 2's scenes + round 3's scene, with
# dispatch arms added. The shipped driver and the app source are not modified.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TREE="$1"
python3 - "$TREE/scripts/renderer-driver.mjs" "$TREE/scripts/renderer-driver-qa3.mjs" "$HERE" <<'PY'
import sys
src, dst, here = sys.argv[1:]
s = open(src).read()
anchor = '\t\t\telse if (SCENE === "new-chat") await sceneNewChat(cdp);\n'
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + '\t\t\telse if (SCENE === "btw-r2") await sceneBtwR2(cdp);\n\t\t\telse if (SCENE === "btw-r2-compat") await sceneBtwR2Compat(cdp);\n\t\t\telse if (SCENE === "btw-r3") await sceneBtwR3(cdp);\n\t\t\telse if (SCENE === "r3-479") await sceneR3OneMoment(cdp);\n')
for f in ("helpers-r1.js", "scene-r2.js", "scene-r3.js", "scene-r3-479.js"):
    s += "\n" + open(f"{here}/{f}").read() + "\n"
open(dst, "w").write(s)
PY
node --check "$TREE/scripts/renderer-driver-qa3.mjs" && shasum -a 256 "$TREE/scripts/renderer-driver-qa3.mjs" "$HERE"/scene-r3.js
