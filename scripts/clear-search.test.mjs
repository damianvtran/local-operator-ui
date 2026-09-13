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
 *     how it is mounted, the reserved right padding, and the Escape path it
 *     must not replace — is pinned as source text, exactly as
 *     `contrast-contract.mjs`'s `STRUCTURAL_CALL_SITES` and
 *     `session-status.test.mjs`'s picker check pin theirs. The sidebar has no
 *     renderer unit-test runner in this repo (the suite is node:test over
 *     `scripts/*.test.mjs`), and it cannot be rendered in isolation: it reads
 *     the router, the canonical-sessions store and the desktop capability
 *     hook. A source pin is the honest guard available; a rendered assertion
 *     would need a DOM harness this repo does not have;
 *   - the committed EVIDENCE ARTIFACT carries the geometry, and is asserted as
 *     such in the last test: the control's own box inside the field's, and its
 *     ring inside that. Read that test's own note for what it can and cannot
 *     catch — it is a contract on the picture this PR ships, not a render test.
 *
 * What a source pin CANNOT catch, stated because the shape of this file has
 * been read the other way round: every substring above would still match if the
 * wrapper lost `relative`, which would drop the control out of the field and
 * into normal flow. Only the geometry assertion — or a DOM runner — sees that,
 * which is why the geometry lives on the artifact the rig measured.
 *
 * What this file does NOT prove: that any of it is VISIBLE. That is the
 * rendered frames' job (docs/evidence/clear-search), which record WHICH ELEMENT
 * HOLDS FOCUS after a real CDP click on the control — the readback's
 * `activeElement` and `focusInInput`; no entry carries `selectionStart`, so it
 * is not a text-offset claim about a caret.
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
		/className="absolute top-1\/2 right-1 -translate-y-1\/2 focus-visible:outline-offset-\[-2px\]!"/,
		"the control must sit inside the field's own box, with its ring pulled inside that box",
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

test("the committed readback still places the control inside its field", () => {
	/*
	 * A contract on the committed ARTIFACT, not a render test — and saying which
	 * matters, because the difference is real.
	 *
	 * What it catches: a re-capture (or a hand-edited readback) in which the
	 * control has left the field, or the ring has escaped it, or the reserved
	 * right padding has gone. Those are exactly the failures no source substring
	 * can see — a wrapper that lost `relative` still contains every pinned
	 * string — so this is the only guard in this file that would notice.
	 *
	 * What it cannot catch: a regression that does not update the artifact. It
	 * reads a JSON file written by the CDP rig, so it is a statement about what
	 * that run measured and not about what the current code renders; a broken
	 * wrapper with a stale committed readback passes here and fails in review,
	 * where the frames are looked at.
	 */
	const readback = JSON.parse(
		readFileSync(
			join(ROOT, "docs/evidence/clear-search/after-readback.json"),
			"utf8",
		),
	);
	const entry = (state, theme) => {
		const hit = readback.find(
			(row) => row.state === state && row.theme === theme,
		);
		assert.ok(hit, `the readback has no ${state}/${theme} entry`);
		return hit;
	};
	/** Inside `outer` with at least `inset` px to spare on every side. */
	const contained = (inner, outer, inset, what) => {
		assert.ok(
			inner.x >= outer.x + inset &&
				inner.y >= outer.y + inset &&
				inner.x + inner.w <= outer.x + outer.w - inset &&
				inner.y + inner.h <= outer.y + outer.h - inset,
			`${what} must sit at least ${inset}px inside the field`,
		);
	};

	for (const theme of ["localOperatorDark", "localOperatorLight"]) {
		const queried = entry("query", theme);
		assert.ok(queried.controlPresent, `${theme}: no control with a query applied`);
		// The 4px right inset and the 2px vertical centring the README quotes.
		assert.equal(
			queried.inputBox.x + queried.inputBox.w -
				(queried.controlBox.x + queried.controlBox.w),
			4,
			`${theme}: the control's right inset`,
		);
		assert.equal(
			queried.controlBox.y - queried.inputBox.y,
			2,
			`${theme}: the control's vertical inset`,
		);
		// 1px, not 0: the field's own `border-control` line is inside its border
		// box, so a control flush with the box would paint over it.
		contained(queried.controlBox, queried.inputBox, 1, `${theme}: the control`);
		// `pr-9`: the query must never run under the control.
		assert.equal(queried.inputPaddingRight, "36px");

		// Design round 1, D1: the ring's outer edge is inside the field, not
		// across its border. `icon-sm`'s own 1px offset needs 3px of clearance
		// and the box leaves 2px, so the instance pulls the ring in.
		const focused = entry("focused", theme);
		assert.ok(focused.controlPresent, `${theme}: the control is not focusable`);
		contained(
			focused.controlRingOuter,
			focused.inputBox,
			1,
			`${theme}: the focus ring`,
		);
		// …and the ring really is the inset one, rather than the assertion above
		// passing because the ring happens to be small.
		assert.equal(focused.controlOutlineOffset, "-2px");
	}
});
