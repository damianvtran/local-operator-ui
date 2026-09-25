#!/usr/bin/env bash
# Add a read-only probe of the composer band's own DOM structure to the 6a step of
# round 3's scene, so the "one line or two?" question is answered from the DOM rather
# than from an array the reader builds out of it.
#
# WHY. At cf5a12f95, 6a's reading is ONE bandLines entry whose text is the aside's busy
# sentence with the held-message lane's two sentences appended to it, and the check fails
# on that; at f105c9953, round 4's own run of this scene read ONE entry holding the busy
# sentence alone and the check passed. `bandLines` is the reader's extraction, so before
# calling that a change in what a reader SEES, the band's own nodes have to be read.
set -euo pipefail
TREE="${1:?usage: probe-band-ux5.sh <UI worktree>}"
DRIVER="$TREE/scripts/renderer-driver-ux5.mjs"
python3 - "$DRIVER" <<'PYEOF'
import sys
path = sys.argv[1]
s = open(path).read()
old = '''	log("6a the press while the aside is answering", pick(busy, STD));
'''
new = '''	log("6a the press while the aside is answering", pick(busy, STD));
	log("6a the band's own structure at the press", await ux5bBandShape(cdp));
'''
assert s.count(old) == 1, f"the 6a log line is not unique ({s.count(old)})"
s = s.replace(old, new)
helper = '''
/**
 * The composer band's OWN nodes, so "one line or two" is read from the DOM rather than
 * from an array a reader built out of it. Read-only; added for UX round 5's 6a probe.
 */
function ux5bBandShape(cdp) {
	return cdp.evaluate(`(() => {
		const band = document.querySelector("[data-lo-composer-band]");
		if (!band) return null;
		const nodes = Array.from(band.querySelectorAll("p, [role=alert], output"));
		return {
			bandText: band.textContent.replace(/\\\\s+/g, " ").trim().slice(0, 400),
			nodes: nodes.map((n) => ({
				tag: n.tagName.toLowerCase(),
				role: n.getAttribute("role"),
				parent: n.parentElement ? n.parentElement.tagName.toLowerCase() : null,
				text: n.textContent.replace(/\\\\s+/g, " ").trim().slice(0, 240),
				buttons: Array.from(n.querySelectorAll("button")).map((b) => b.textContent.trim()),
			})),
		};
	})()`);
}
'''
if "function ux5bBandShape" not in s:
    s = s + helper
open(path, "w").write(s)
print("6a band probe added")
PYEOF
node --check "$DRIVER" && echo "driver syntax OK"
