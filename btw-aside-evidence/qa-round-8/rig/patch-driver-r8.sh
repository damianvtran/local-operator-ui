#!/usr/bin/env bash
# Builds scripts/renderer-driver-qa8.mjs in the QA worktree: a COPY of the driver at
# the PR head + rounds 1-4's helper layer and scenes + round 5's + round 6's, with
# dispatch arms added. The shipped driver and the app source are not modified.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TREE="$1"
python3 - "$TREE/scripts/renderer-driver.mjs" "$TREE/scripts/renderer-driver-qa8.mjs" "$HERE" <<'PY'
import sys
src, dst, here = sys.argv[1:]
s = open(src).read()
anchor = '\t\t\telse if (SCENE === "new-chat") await sceneNewChat(cdp);\n'
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + '\t\t\telse if (SCENE === "btw-r2") await sceneBtwR2(cdp);\n\t\t\telse if (SCENE === "btw-r2-compat") await sceneBtwR2Compat(cdp);\n\t\t\telse if (SCENE === "btw-r3") await sceneBtwR3(cdp);\n\t\t\telse if (SCENE === "r3-479") await sceneR3OneMoment(cdp);\n\t\t\telse if (SCENE === "btw-r4") await sceneBtwR4(cdp);\n\t\t\telse if (SCENE === "btw-r3r4") await sceneBtwR3AtR4(cdp);\n\t\t\telse if (SCENE === "btw-r4-clip") await sceneBtwR4Clip(cdp);\n\t\t\telse if (SCENE === "btw-r5-clip") await sceneBtwR5Clip(cdp);\n\t\t\telse if (SCENE === "btw-r5-adopt") await sceneBtwR5Adopt(cdp);\n\t\t\telse if (SCENE === "btw-r5-cap") await sceneBtwR5Cap(cdp);\n\t\t\telse if (SCENE === "btw-r6") await sceneBtwR6(cdp);\n\t\t\telse if (SCENE === "btw-r6-cap") await sceneBtwR6Cap(cdp);\n\t\t\telse if (SCENE === "btw-r6-capq") await sceneBtwR6Capq(cdp);\n\t\t\telse if (SCENE === "btw-r7-fold") await sceneBtwR7Fold(cdp);\n\t\t\telse if (SCENE === "btw-r8-band") await sceneBtwR8Band(cdp);\n')
for f in ("helpers-r1.js", "scene-r2.js", "scene-r3.js", "scene-r3-479.js", "scene-r4.js", "scene-r5.js", "scene-r6.js", "scene-r7.js", "scene-r8.js"):
    s += "\n" + open(f"{here}/{f}").read() + "\n"
open(dst, "w").write(s)
PY
node --check "$TREE/scripts/renderer-driver-qa8.mjs" && shasum -a 256 "$TREE/scripts/renderer-driver-qa8.mjs" "$HERE"/scene-r6.js
