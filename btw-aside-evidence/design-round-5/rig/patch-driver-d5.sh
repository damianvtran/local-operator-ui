#!/usr/bin/env bash
# Builds scripts/renderer-driver-d5.mjs in the design-round-5 worktree: a COPY of the
# driver at the PR head plus rounds 1-5's helper layer and scenes, design round 3's own
# scene, design round 4's own scene and round 5's scene. The shipped driver and the app
# source are not modified.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TREE="$1"
python3 - "$TREE/scripts/renderer-driver.mjs" "$TREE/scripts/renderer-driver-d5.mjs" "$HERE" <<'PY'
import sys
src, dst, here = sys.argv[1:]
s = open(src).read()
anchor = '\t\t\telse if (SCENE === "new-chat") await sceneNewChat(cdp);\n'
assert s.count(anchor) == 1
arms = '\t\t\telse if (SCENE === "btw-r2") await sceneBtwR2(cdp);\n\t\t\telse if (SCENE === "btw-r2-compat") await sceneBtwR2Compat(cdp);\n\t\t\telse if (SCENE === "btw-r3") await sceneBtwR3(cdp);\n\t\t\telse if (SCENE === "r3-479") await sceneR3OneMoment(cdp);\n\t\t\telse if (SCENE === "btw-r4") await sceneBtwR4(cdp);\n\t\t\telse if (SCENE === "btw-r3r4") await sceneBtwR3AtR4(cdp);\n\t\t\telse if (SCENE === "btw-r4-clip") await sceneBtwR4Clip(cdp);\n\t\t\telse if (SCENE === "btw-r5-clip") await sceneBtwR5Clip(cdp);\n\t\t\telse if (SCENE === "btw-r5-adopt") await sceneBtwR5Adopt(cdp);\n\t\t\telse if (SCENE === "btw-r5-cap") await sceneBtwR5Cap(cdp);\n\t\t\telse if (SCENE === "btw-d4") await sceneBtwD4(cdp);\n\t\t\telse if (SCENE === "btw-d5") await sceneBtwD5(cdp);\n\t\t\telse if (SCENE === "btw-r3design") await sceneBtwAsideR3(cdp);\n'
s = s.replace(anchor, anchor + arms)
for f in ("r4/helpers-r1.js", "r4/scene-r2.js", "r4/scene-r3.js", "r4/scene-r3-479.js", "r4/scene-r4.js", "r5/scene-r5.js", "scene-d4.js", "scene-r3design.js", "scene-d5.js"):
    s += "\n" + open(f"{here}/{f}").read() + "\n"
open(dst, "w").write(s)
PY
node --check "$TREE/scripts/renderer-driver-d5.mjs" && echo "driver built and parses"
