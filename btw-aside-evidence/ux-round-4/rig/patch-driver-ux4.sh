#!/usr/bin/env bash
# Builds scripts/renderer-driver-ux4.mjs (UNTRACKED) in the review worktree: a COPY of the
# driver at the PR head + rounds 1/2/3/4/5's helper layers and scenes + UX round 3's scene
# (kept, because round 4 RE-RUNS round 3's own scenes at this head as the regression) +
# this round's scene, with the dispatch arms added. The shipped driver and the app source
# are not modified.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TREE="$1"
python3 - "$TREE/scripts/renderer-driver.mjs" "$TREE/scripts/renderer-driver-ux4.mjs" "$HERE" <<'PYEOF'
import sys
src, dst, here = sys.argv[1:]
s = open(src).read()
anchor = '\t\t\telse if (SCENE === "new-chat") await sceneNewChat(cdp);\n'
assert s.count(anchor) == 1
arms = ["btw-r2", "btw-r2-compat", "btw-r3", "r3-479", "btw-r4", "btw-r3r4", "btw-r4-clip",
        "btw-r5-clip", "btw-r5-adopt", "btw-r5-cap", "btw-ux2", "btw-ux2b", "btw-ux2c",
        "btw-ux3", "btw-ux3b", "btw-ux3c", "btw-ux3d",
        "btw-ux4", "btw-ux4b", "btw-ux4c", "btw-ux4d"]
fns = ["sceneBtwR2", "sceneBtwR2Compat", "sceneBtwR3", "sceneR3OneMoment", "sceneBtwR4",
       "sceneBtwR3AtR4", "sceneBtwR4Clip", "sceneBtwR5Clip", "sceneBtwR5Adopt", "sceneBtwR5Cap",
       "sceneBtwUx2", "sceneBtwUx2b", "sceneBtwUx2c", "sceneBtwUx3", "sceneBtwUx3b", "sceneBtwUx3c", "sceneBtwUx3d",
       "sceneBtwUx4", "sceneBtwUx4b", "sceneBtwUx4c", "sceneBtwUx4d"]
add = "".join('\t\t\telse if (SCENE === "%s") await %s(cdp);\n' % (a, f) for a, f in zip(arms, fns))
s = s.replace(anchor, anchor + add)
for f in ("helpers-r1.js", "scene-r2.js", "scene-r3.js", "scene-r3-479.js", "scene-r4.js",
          "scene-r5.js", "ux2-scene.js", "scene-ux3.js", "scene-ux4.js", "scene-ux4d.js"):
    s += "\n" + open("%s/%s" % (here, f)).read() + "\n"
open(dst, "w").write(s)
PYEOF
node --check "$TREE/scripts/renderer-driver-ux4.mjs"
shasum -a 256 "$TREE/scripts/renderer-driver.mjs" "$HERE/scene-ux4.js"
