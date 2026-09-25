#!/usr/bin/env bash
# Fix the A4 check in the ux5 driver copy, once, before the re-run.
#
# WHY. As first written, A4 asserted `transcriptStreaming === true` while the composer was
# being typed into with the panel attached. That reads the CONVERSATION's streaming marker,
# and the thing streaming is the ASIDE: with the panel attached the composer's send routes to
# the aside, so the transcript is not streaming and the flag is false by construction. The
# check therefore failed on a head where the property it names holds (measured: the line
# landed in 288 ms at ~1.2 s into the aside's answer). A check that cannot pass is not a
# finding about the app, so it is corrected rather than reported.
#
# The property is re-expressed as a pair of renderable facts of the flow, read from the panel
# itself: the whole line lands while the aside's answer has NOT yet landed, and the answer
# arriving afterwards does not erase it.
set -euo pipefail
TREE="${1:?usage: fix-a4-ux5.sh <UI worktree>}"
DRIVER="$TREE/scripts/renderer-driver-ux5.mjs"
python3 - "$DRIVER" <<'PYEOF'
import sys
path = sys.argv[1]
s = open(path).read()
old = '''		const streaming = await h.read();
		log("A4 typing during the stream", {
			typedMs: typed,
			streaming: streaming.transcriptStreaming,
			fieldValue: streaming.fieldValue,
			active: streaming.active,
			box: streaming.regionBox,
		});
		r2check(
			"A4 at 800px the async answer never freezes the input loop: the composer takes the whole line while the aside streams",
			typed !== null && streaming.transcriptStreaming === true,
			JSON.stringify({ typedMs: typed, streaming: streaming.transcriptStreaming, value: streaming.fieldValue }),
		);
'''
new = '''		/*
		 * READ FROM THE PANEL, NOT THE TRANSCRIPT. With the panel attached the composer's
		 * send routes to the aside, so the CONVERSATION is not streaming and
		 * `transcriptStreaming` is false by construction - an earlier spelling of this check
		 * asserted it and could not pass on any head. The live async work is the aside's own
		 * answer, and the two facts that show it are read here: it had NOT landed when the
		 * whole line landed, and it HAD landed by the time the reader looked again.
		 */
		const atTyping = await h.read();
		log("A4 typing during the aside's answer", {
			typedMs: typed,
			announce: atTyping.announce,
			answerLandedYet: (atTyping.panelText ?? "").includes("LONG-END"),
			fieldValue: atTyping.fieldValue,
			active: atTyping.active,
			box: atTyping.regionBox,
		});
		let atSettle = atTyping;
		for (let i = 0; i < 400; i++) {
			atSettle = await h.read();
			if ((atSettle.panelText ?? "").includes("LONG-END") && h.settled(atSettle)) break;
			await wait(100);
		}
		log("A4 the same composer once the aside's answer has landed", {
			answerLanded: (atSettle.panelText ?? "").includes("LONG-END"),
			announce: atSettle.announce,
			fieldValue: atSettle.fieldValue,
			active: atSettle.active,
		});
		r2check(
			"A4 at 800px the composer takes the whole line while the aside is STILL answering: a live aside does not freeze the input, and the answer lands afterwards",
			typed !== null &&
				!(atTyping.panelText ?? "").includes("LONG-END") &&
				(atSettle.panelText ?? "").includes("LONG-END"),
			JSON.stringify({
				typedMs: typed,
				announceAtTyping: atTyping.announce,
				answerAtTyping: (atTyping.panelText ?? "").includes("LONG-END"),
				answerAtSettle: (atSettle.panelText ?? "").includes("LONG-END"),
			}),
		);
		r2check(
			"A4 the aside's answer arriving does not erase what the reader has typed into the composer",
			(atSettle.fieldValue ?? "") === "typing while the aside streams",
			JSON.stringify({ fieldValue: atSettle.fieldValue, active: atSettle.active }),
		);
'''
assert s.count(old) == 1, f"the A4 block is not unique/absent ({s.count(old)})"
open(path, "w").write(s.replace(old, new))
print("A4 check rewritten")
PYEOF
node --check "$DRIVER" && echo "driver syntax OK"
