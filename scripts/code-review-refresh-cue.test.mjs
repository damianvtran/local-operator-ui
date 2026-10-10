import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/*
 * The refresh control's cue cannot outlive its press, asserted on the source
 * that wires it (round-3 m-A / U22).
 *
 * WHY THIS FILE EXISTS. A failed refresh POST left the pane's `feedback` state
 * at "pressed". The state machine that spins the control and then says `Checked
 * just now` is edge-driven - it waits for a refetch to settle - so it stayed
 * ARMED past the failed press: the next unrelated read (a desktop-feed frame's
 * refetch, the 60 s timer, a window focus) tripped `refetchSeen` and its settle
 * flipped the cue to `checked`, painting "Refreshing" and then "Checked just
 * now" with no press at all. The defect is a handler wiring, which no rendered
 * markup and no screenshot holds - a static frame cannot distinguish the state
 * the next read finds from the state the press left - so this file reads the
 * pane's own `onRefresh` handler and refuses the wiring that leaves the cue
 * armed after its press has already failed.
 *
 * THE WINDOW IS BOUNDED ON PURPOSE, the way `pane-slot-ground.test.mjs` and
 * `composer-tabs.test.mjs` bound theirs: the assertions run over the text of
 * the mutate call itself, so a `setFeedback("idle")` elsewhere in the file
 * cannot satisfy them.
 */

const PANE = join(
	import.meta.dirname,
	"..",
	"src",
	"renderer",
	"src",
	"features",
	"code-review",
	"components",
	"code-review-pane.tsx",
);

test("a failed refresh POST returns the cue to idle, so no later read can flash it (m-A/U22)", () => {
	const source = readFileSync(PANE, "utf8");
	const onRefreshAt = source.indexOf("const onRefresh = () => {");
	assert.notEqual(
		onRefreshAt,
		-1,
		"the pane's onRefresh handler is gone or renamed",
	);
	const onRefresh = source.slice(onRefreshAt, onRefreshAt + 1_400);
	const mutateAt = onRefresh.indexOf("refresh.mutate(");
	assert.notEqual(mutateAt, -1, "onRefresh no longer calls refresh.mutate");
	const call = onRefresh.slice(mutateAt);
	/*
	 * The failure answer must both report and disarm: the failure line is the
	 * press's answer, and the spin must not keep waiting for an answer that
	 * already came.
	 */
	assert.match(call, /onError:/);
	assert.match(call, /setFeedback\("idle"\)/);
	/*
	 * And the same family on the read half: a refetch that settles into error
	 * while the cue is pressed also returns to idle (the round-2 U14 branch),
	 * so both halves of the machine disarm on failure rather than one.
	 */
	assert.match(
		source,
		/if \(query\.isError\) \{[\s\S]{0,200}?setFeedback\("idle"\)/,
	);
});
