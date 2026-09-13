/**
 * The chat sidebar's search field: the clear control's contract, executable.
 *
 *     node --test scripts/clear-search.test.mjs
 *
 * The operator's report was "Can you have an x in the search bar to make it
 * easier to clear out when there's a search filter applied?" — the field had
 * exactly one way out of a filter, Escape, and Escape also blurs, so a pointer
 * user had to select the text and delete it.
 *
 * What this file asserts, and HOW, is deliberately two halves:
 *
 *   - the CLEAR ACTION is bundled and called for real (`clearSearch`), because
 *     it is two effects and only one of them is the state update. A button
 *     that empties the query but leaves focus on `<body>` looks correct in a
 *     screenshot and is wrong to type into, so the focus half is asserted here
 *     rather than described in a comment;
 *   - the WIRING a bundle cannot reach — which state the control is gated on,
 *     where it is mounted, the reserved right padding, and the Escape path it
 *     must not replace — is pinned as source text, exactly as
 *     `contrast-contract.mjs`'s `STRUCTURAL_CALL_SITES` and
 *     `session-status.test.mjs`'s picker check pin theirs. The sidebar has no
 *     renderer unit-test runner in this repo (the suite is node:test over
 *     `scripts/*.test.mjs`), and it cannot be rendered in isolation: it reads
 *     the router, the canonical-sessions store and the desktop capability
 *     hook. A source pin is the honest guard available; a rendered assertion
 *     would need a DOM harness this repo does not have.
 *
 * What this file does NOT prove: that any of it is VISIBLE, or that focus
 * really lands in the input in a browser. That is the rendered frames' job
 * (docs/evidence/clear-search), which record the caret's own position after a
 * real CDP click on the control.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

// Bundled in memory so the guard runs against the shipped TS module rather
// than a re-implementation. `clear-search.ts` imports nothing, so no fixture
// plugins are needed.
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/clear-search";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { clearSearch } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const SIDEBAR = "src/renderer/src/features/chat/components/chat-sidebar.tsx";
const sidebar = readFileSync(join(ROOT, SIDEBAR), "utf8");

/** A field double that records what it was asked to do, in order. */
const fieldDouble = () => {
	const calls = [];
	return {
		calls,
		input: { focus: () => calls.push("focus") },
		apply: (value) => calls.push(`apply:${JSON.stringify(value)}`),
	};
};

test("clearing empties the query and returns the caret to the field", () => {
	const field = fieldDouble();
	clearSearch(field.input, field.apply);
	assert.deepEqual(
		field.calls,
		['apply:""', "focus"],
		"clear must empty the query AND put focus back in the input, in that order",
	);
});

test("a missing input still clears", () => {
	// The ref is null before mount and after the sidebar unmounts; losing the
	// state update there would leave the user's filter applied with no control
	// left to remove it.
	const field = fieldDouble();
	assert.doesNotThrow(() => clearSearch(null, field.apply));
	assert.deepEqual(field.calls, ['apply:""']);
});

test("the clear control is rendered only while a filter is applied", () => {
	// The gate is the whole requirement: an always-visible control beside an
	// empty field invites a click that does nothing.
	assert.match(
		sidebar,
		/\{query && \(\s*<Button/,
		"the clear Button must be rendered conditionally on `query`",
	);
});

test("the clear control is the settings-search idiom, not a new one", () => {
	const at = sidebar.indexOf('aria-label="Clear search"');
	assert.ok(at > 0, "the control must carry the accessible name `Clear search`");
	const control = sidebar.slice(sidebar.lastIndexOf("{query && (", at), at);
	assert.match(control, /variant="ghost"/);
	assert.match(
		control,
		/size="icon-sm"/,
		"the hit target is the button's own icon-sm box",
	);
	assert.match(
		control,
		/onClick=\{\(\) => clearSearch\(searchRef\.current, setQuery\)\}/,
		"the click must go through the extracted clear action, not a bare setQuery('')",
	);
	assert.match(
		control,
		/className="absolute top-1\/2 right-1 -translate-y-1\/2"/,
		"the control must sit inside the field's own box, as the settings search does",
	);
});

test("the icon is decorative and the query never runs under the control", () => {
	const input = sidebar.slice(
		sidebar.indexOf("ref={searchRef}"),
		sidebar.indexOf("/>", sidebar.indexOf("ref={searchRef}")),
	);
	assert.match(input, /pr-9/, "the input must reserve the control's column");
	// The X is a glyph inside a named button; announced separately it would be
	// read as text with no meaning.
	const at = sidebar.indexOf('aria-label="Clear search"');
	assert.match(
		sidebar.slice(at, at + 200),
		/<X aria-hidden="true" \/>/,
		"the icon must be hidden from the accessibility tree",
	);
});

test("Escape keeps clearing and blurring, unchanged", () => {
	const keyDown = sidebar.slice(
		sidebar.indexOf("const keyDown = ("),
		sidebar.indexOf("const rows = ["),
	);
	// The new control is an addition, not a replacement: Escape is still the
	// keyboard user's way out of the field, blur included, and the list's own
	// Escape branch (which restores focus to the field) still follows it.
	assert.match(
		keyDown,
		/target\.tagName === "INPUT"\) \{\s*if \(event\.key === "Escape"\) \{\s*setQuery\(""\);\s*target\.blur\(\);/,
		"the input's Escape branch must still clear the query and blur the field",
	);
	assert.match(
		keyDown,
		/searchRef\.current\?\.focus\(\)/,
		"Escape from the list must still return focus to the search field",
	);
});
