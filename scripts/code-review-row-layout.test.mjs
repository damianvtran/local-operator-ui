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
 * - the NUMBER is `shrink-0` and does NOT carry `truncate`: the number never
 *   truncates, never overlaps the state pill and never leaves the visible
 *   pane (design D3 / UX U8);
 * - the MARKER is `shrink-0`, does NOT carry `truncate` and IS capped at
 *   the row's column (`max-w-full`): the marker is context, but it must
 *   never vanish - a row whose relation is `unknown` must not read as a
 *   plainly opened row (QA round 2, Q-3) - and it must never overflow the
 *   pane either (QA round 3, Q-5);
 * - the identity line carries NO marker: the marker's place is the
 *   annotations line, where the row has room to give it whole;
 * - `data-row-marker` occurs EXACTLY ONCE in the file: it is how this guard
 *   finds the marker, so a second marker - or a marker back on the identity
 *   line under a different attribute - would slip past it;
 * - the identity wrapper carries `min-w-0`: without it the wrapper's
 *   automatic minimum size is its content, and the name cannot shrink at
 *   all (the round-1 defect, one step further down).
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
const MARKER_ATTRIBUTE = /data-row-marker/;
const MAX_W_FULL = /\bmax-w-full\b/;

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
	assert.doesNotMatch(
		number,
		TRUNCATE,
		"the number must never be ellipsised: a truncated number reads as a different number",
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
	assert.match(
		marker,
		MAX_W_FULL,
		"the marker must be capped at the row's column: uncapped it overflows the pane's scroller instead of ellipsising (QA round 3, Q-5)",
	);
});

/**
 * The class list of the className block an anchor sits INSIDE, so the
 * element is found by what it is rather than by what precedes it.
 */
const classListAround = (anchor) => {
	const at = source.indexOf(anchor);
	assert.notEqual(at, -1, `the anchor must be in the row's source: ${anchor}`);
	const open = source.lastIndexOf("className={cn(", at);
	const close = source.indexOf(")}", at);
	assert.ok(
		open !== -1 && close !== -1 && open < close,
		`the anchor must sit inside a className block: ${anchor}`,
	);
	return [...source.slice(open, close).matchAll(CLASS_STRING)]
		.map((m) => m[1])
		.join(" ");
};

test("the marker is found once, and the identity wrapper can shrink (R2-4, R3-3)", () => {
	assert.equal(
		(source.match(MARKER_ATTRIBUTE) ?? []).length,
		1,
		"`data-row-marker` must occur exactly once: it is how the marker is found, and a second marker would slip past this guard",
	);
	// The anchor is the identity wrapper's own two classes: the column
	// wrapper above it also reads `flex min-w-0 flex-1`, so the anchor has to
	// name the identity line and not the column.
	const wrapper = classListAround("flex-1 items-baseline");
	assert.match(
		wrapper,
		MIN_W_0,
		"the identity wrapper must carry min-w-0: without it the wrapper's automatic minimum size is its content and the name cannot shrink at all",
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
