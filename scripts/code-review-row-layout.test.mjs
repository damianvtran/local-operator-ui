import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/*
 * THE IDENTITY LINE'S FLEX CONTRACT, asserted on the source that carries it
 * (agent review round 2, R2-4).
 *
 * WHY THIS FILE EXISTS. The contract is three words long - the number never
 * yields, the name yields last, the marker yields first - and it has already
 * been broken once: in this change's first round the repo-name span was given
 * `shrink-0`, which made it unshrinkable, and at the 320px floor a
 * 28-character name put the `!N`/`#N` under the state pill while a
 * 40-character one pushed it out of the pane. Nothing failed: a green test
 * suite cannot see a flex contract, because the defect is a LAYOUT, and the
 * layout is only observable in a rendered frame at a width nobody renders.
 * So the contract is pinned here, on the markup itself, the way
 * `code-review-refresh-cue.test.mjs` pins its handler and
 * `composer-readings.test.mjs` pins its reading boxes.
 *
 * THE BOUNDED WINDOW, on purpose: the assertions read the class list of the
 * element nearest an anchor, so a `shrink-0` written anywhere else in the
 * file cannot satisfy them, and the marker check reads the identity line's
 * own slice - from the name to the state pill - so a marker moved back into
 * that line is caught even though the file still contains a marker.
 *
 * WHAT IS PINNED, and why each one is a defect when it breaks:
 *
 * - the NAME is not `shrink-0`: an unshrinkable name keeps its full width and
 *   pushes the `shrink-0` number out of the row (the round-1 blocker);
 * - the NAME carries `truncate`: the ellipsis is how a name says "this does
 *   not fit", and without it the name is cut with no sign (dead code beside
 *   `shrink-0` is what the round-1 change left behind);
 * - the NUMBER is `shrink-0`: the number never truncates, never overlaps the
 *   state pill and never leaves the visible pane (design D3 / UX U8);
 * - the MARKER is `shrink-0` and does NOT carry `truncate`: the marker is
 *   context, but it must never vanish - a row whose relation is `unknown`
 *   must not read as a plainly opened row (QA round 2, Q-3);
 * - the identity line carries NO marker: the marker's place is the
 *   annotations line, where the row has room to give it whole.
 */

const ROW = join(
	import.meta.dirname,
	"..",
	"src",
	"renderer",
	"src",
	"features",
	"code-review",
	"components",
	"code-review-row.tsx",
);

const source = readFileSync(ROW, "utf8");

/* The regexes live at the top level (biome's `useTopLevelRegex`): they are
 * compiled once for the file, not per call. */
const CLASS_NAME = /className=\{cn\(([\s\S]{0,400}?)\)\}/g;
const CLASS_STRING = /"([^"]*)"/g;
const SHRINK_0 = /\bshrink-0\b/;
const TRUNCATE = /\btruncate\b/;
const MIN_W_0 = /\bmin-w-0\b/;
const MARKER_ANCHOR = /data-row-marker/;

/**
 * The class list of the element nearest an anchor: the last one BEFORE it
 * or the first one AFTER it, so the window is the element's own and not the
 * file's.
 */
const classListOf = (anchor, before) => {
	const at = source.indexOf(anchor);
	assert.notEqual(at, -1, `the anchor must be in the row's source: ${anchor}`);
	const window = before
		? source.slice(Math.max(0, at - 600), at)
		: source.slice(at, at + 600);
	const found = [...window.matchAll(CLASS_NAME)];
	const own = before ? found[found.length - 1] : found[0];
	assert.ok(
		own,
		`an element with a class list must sit ${before ? "before" : "after"} the anchor: ${anchor}`,
	);
	return [...own[1].matchAll(CLASS_STRING)].map((m) => m[1]).join(" ");
};

test("the name is shrinkable, the number is not, and the marker yields first (R2-4)", () => {
	const name = classListOf("{name}", true);
	assert.match(name, MIN_W_0, "the name must be allowed to shrink to nothing");
	assert.match(name, TRUNCATE, "the name must ellipsise when it does not fit");
	assert.doesNotMatch(
		name,
		SHRINK_0,
		"the name must NOT refuse to shrink: an unshrinkable name pushes the number out of the row (the round-1 blocker)",
	);

	// The anchor is the sigil ON ITS OWN LINE: the identity `title` above
	// carries the same call inside a template literal, and that span is the
	// NAME's class list, not the number's.
	const number = classListOf("{forgeSigil(row)}\n", true);
	assert.match(
		number,
		SHRINK_0,
		"the number must never yield: it never truncates, never overlaps the pill and never leaves the pane (design D3 / UX U8)",
	);

	const marker = classListOf('data-row-marker=""', false);
	assert.match(
		marker,
		SHRINK_0,
		"the marker must never be the thing that gives way (QA round 2, Q-3)",
	);
	assert.doesNotMatch(
		marker,
		TRUNCATE,
		"the marker must never be ellipsised: a marker that vanishes makes a row read as a plainly opened row",
	);
});

test("the identity line carries the name and the number, and no marker (R2-4)", () => {
	const name = source.indexOf("{name}");
	const pill = source.indexOf("<Badge");
	assert.notEqual(name, -1, "the row must render the name");
	assert.notEqual(pill, -1, "the row must render its state pill");
	const identityLine = source.slice(name, pill);
	assert.doesNotMatch(
		identityLine,
		MARKER_ANCHOR,
		"the marker must not be back on the identity line: its floor would come out of the name's budget (QA round 2, Q-3)",
	);
});
