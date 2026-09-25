/**
 * §F2's ONE VOICE for connection state, as the sidebar's two list-pane
 * paragraphs keep it.
 *
 * WHAT THIS PINS. The UX review's duplicate-Retry finding: on a dead backend
 * the screen carried the pane's status strip AND the sidebar's list-pane
 * paragraph, each with a `Retry`, one fact stated twice - and §F2 asks for the
 * sidebar's foot line and list-pane paragraph to stand down while the strip
 * can speak. The treatment is the foot line's own (its paragraph says so):
 * both blocks are gated on the SAME reading (`serverHealth?.online !==
 * false`), neither carries `role="alert"` (the strip owns the one live
 * region), and the control says "Retry refresh" rather than a second bare
 * "Retry".
 *
 * WHY A SCAN AND NOT A RENDER. The sidebar cannot be mounted by this
 * repository's `node:test` suite (see `chat-sidebar-view.test.mjs`'s header),
 * so a decision written as a JSX condition is a decision no test can reach -
 * the answer these suites use is to slice the file at named markers, the way
 * `chat-sidebar-archive.test.mjs` does for the archive lane. `between` fails
 * loudly when a marker is missing or the slice is implausibly small, because a
 * marker that stops matching silently turns a claim into an empty-string pass.
 *
 * WHAT IT CANNOT SAY: that the screen looks right. The pixels of the two-voice
 * state are the rig's job (`renderer-driver.mjs` on the built app, with the
 * daemon killed mid-run), and its frames are the claim.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SIDEBAR = "src/renderer/src/features/chat/components/chat-sidebar.tsx";
const SOURCE = readFileSync(SIDEBAR, "utf8");

/*
 * The literals these cases assert on, at module scope: `useTopLevelRegex` is a
 * warning rather than an error here, and a new file in this tree is exactly the
 * diff those are meant to keep quiet.
 */
const ERROR_COPY_ROW = /capabilities\.error\.message/;
const NOTICE_ROW = /<p>\{notice\}<\/p>/;
const RETRY_REFRESH = /Retry refresh/;

/** The slice between two markers; a missing marker or a tiny slice is a failure. */
const between = (start, end) => {
	const from = SOURCE.indexOf(start);
	assert.notEqual(from, -1, `the start marker is gone: ${start}`);
	const to = SOURCE.indexOf(end, from + start.length);
	assert.notEqual(to, -1, `the end marker is gone after it: ${end}`);
	const slice = SOURCE.slice(from, to);
	assert.ok(
		slice.length > 150,
		`the slice between the markers is ${slice.length} characters - a marker pair that resolves ahead of itself reads as an empty pass`,
	);
	return slice;
};

test("the capability paragraph stands down on the strip's own reading", () => {
	const block = between(
		"{capabilities.error && serverHealth?.online !== false && (",
		"\n\t\t\t{/*",
	);
	assert.match(block, ERROR_COPY_ROW);
	assert.match(block, RETRY_REFRESH);
	assert.equal(
		block.includes('role="alert"'),
		false,
		"the strip owns the one live region for connection state; a second live region about one fact is the duplicate the finding names",
	);
});

test("the withdrawn-gate paragraph takes the same stand-down", () => {
	const block = between(
		"{notice && serverHealth?.online !== false && (",
		"\n\t\t\t{/*",
	);
	assert.match(block, NOTICE_ROW);
	assert.match(block, RETRY_REFRESH);
	assert.equal(
		block.includes('role="alert"'),
		false,
		"a withdrawn gate is read off the same stale answer a just-killed server leaves behind - without the gate the block speaks over the strip",
	);
});

test("the foot line and the two paragraphs read one predicate, not three", () => {
	// The drift the comment in the component names: three sites agreeing about
	// when the strip owns the screen. A fourth spelling, or a site that leaves
	// the shared reading, fails here rather than on a screen.
	const sites = SOURCE.split("serverHealth?.online !== false &&").length - 1;
	assert.equal(
		sites,
		3,
		`found ${sites} site(s) reading the shared predicate - expected the two list-pane paragraphs and the foot line`,
	);
});
