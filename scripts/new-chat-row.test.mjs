/**
 * The sidebar's two PRIMARY rows - `New chat` and `Search` - and the boundary
 * the operator asked the first of them to lose.
 *
 *     node --test scripts/new-chat-row.test.mjs
 *
 * The operator's report was "Can you make a style improvement in
 * local-operator-ui, remove the border around new chat and have it be the same
 * alignment, etc. as the all chats above it so that it looks more consistent
 * and in line". The row wore `border-control`, and because the app is
 * `box-sizing: border-box` that edge sat INSIDE the row's own box: the icon and
 * label started 1px further right than its neighbour's. Removing the class is
 * the whole fix, which is exactly why it needs a guard - a one-token deletion is
 * also a one-token re-addition.
 *
 * WHAT MOVED, AND WHY THIS FILE MOVED WITH IT. The row used to live in the chat
 * list's own header, under a search field, a disclosure and an `All chats` row.
 * The chat redesign (§C1) makes `New chat` and `Search` the two primary rows at
 * the TOP of the one sidebar, above the destinations, and `All chats` is gone
 * (the list is sectioned by RUNNING / TODAY / THIS WEEK / OLDER instead). So the
 * row's home is `sidebar-navigation.tsx` and the row it has to stay identical to
 * is `Search` beside it - both take one shared `DESTINATION_ROW`, which is where
 * the box they are aligned on lives now.
 *
 * HOW THIS FILE ASSERTS, AND WHAT THAT COSTS. The sidebar cannot be rendered in
 * isolation - it reads the router, the canonical-sessions store and the desktop
 * capability hooks, and this repository's desktop suite is `node:test` over
 * `scripts/*.test.mjs` with no DOM harness - so the property is pinned as
 * SOURCE TEXT over the rows' own `className` expressions, the idiom
 * `contrast-contract.mjs`'s `STRUCTURAL_CALL_SITES` and `clear-search.test.mjs`
 * already use. The pin is scoped to the extracted button rather than the whole
 * file, so a `border-control` on a NEIGHBOURING row cannot satisfy it.
 *
 * Comments are stripped out of the slice before it is matched: the slice runs
 * from `className={cn(` to the first `)}`, and `cn()`'s argument list is exactly
 * where a reader writes the note explaining the row - including
 * `// no border-control here, see above`, which would satisfy the pin while the
 * attribute was absent and break it once it was present.
 *
 * What this file does NOT prove: that anything is VISIBLE, or that the two rows
 * really land on the same left inset. That is a fact about the box the class
 * produces, and it is measured from the live DOM in the rig's own geometry
 * assertions (the `l-sidebar` states) rather than from source.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = process.cwd();
const NAV =
	"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx";
const source = readFileSync(join(ROOT, NAV), "utf8");

/** The 8px-on-the-ramp inset `DESTINATION_ROW` supplies, and the box it sits in. */
const ROW_HEIGHT = /\bh-\[30px\]/;
const ROW_INSET = /\bpx-2\b/;
const ROW_GAP = /\bgap-2\b/;

/**
 * A horizontal inset, a height or a gap a row declares of its OWN.
 *
 * The relationship this exists for is stated where it is used; the token list
 * is deliberately all four axes, because a row moves off its neighbour's column
 * for a height reason exactly as easily as for a padding one.
 */
const ROW_BOX_OVERRIDE =
	/\b(?:p|px|py|pl|pr|pt|pb|h|gap|min-h|space-x)-[^\s"']+/;

/*
 * How the two primary rows may legitimately differ: the label they carry, the
 * cap they print, the chord-wired attribute they are anchored by, and the
 * current/disabled vocabulary `New chat` alone can reach (Search is never the
 * current view and is never disabled, so it declares neither).
 */
const NEW_CHAT_ONLY_TOKENS = [
	"disabled:hover:bg-transparent",
	"disabled:text-ink-disabled",
];

/**
 * The row's current-draft predicate, which `aria-current` has to agree with.
 *
 * It is `untargetedDraft` now - an untargeted draft is the one this row stages,
 * and a draft WITH a target belongs to its agent's row - and it is declared once
 * above both rows so a second spelling is a failing test rather than a quiet
 * divergence.
 */
const CURRENT_DRAFT_PREDICATE = /current: untargetedDraft/;

const ARIA_CURRENT_PAGE =
	/aria-current=\{props\.current \? "page" : undefined\}/;

/** The `className={cn(...)}` expression of the row a label is rendered by. */
const classExpressionFor = (label) => {
	const labelAt = source.indexOf(`"${label}"`);
	assert.notEqual(
		labelAt,
		-1,
		`no row renders the label ${JSON.stringify(label)}`,
	);
	const lineAt = source.lastIndexOf("\n", labelAt);
	const call = source.slice(lineAt, source.indexOf("\n", labelAt));
	return stripComments(call);
};

/** Comments out of a slice, so prose about a rule cannot satisfy it. */
function stripComments(text) {
	let out = "";
	let quote = null;
	for (let i = 0; i < text.length; ) {
		const char = text[i];
		const next = text[i + 1];
		if (quote) {
			if (char === "\\") {
				out += text.slice(i, i + 2);
				i += 2;
				continue;
			}
			if (char === quote) quote = null;
			out += char;
			i += 1;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			out += char;
			i += 1;
			continue;
		}
		if (char === "/" && next === "/") {
			while (i < text.length && text[i] !== "\n") i += 1;
			continue;
		}
		if (char === "/" && next === "*") {
			i += 2;
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/"))
				i += 1;
			i += 2;
			continue;
		}
		out += char;
		i += 1;
	}
	return out;
}

/** The class tokens a row's own literals pass, comments removed. */
const classLiterals = (text) =>
	[...stripComments(text).matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)]
		.map((match) => match[1])
		.join(" ");

/** One class token, for comparing two rows' own class strings. */
const WHITESPACE = /\s+/;

/** A border ROLE token, so a future `border-b` divider reads as its own decision. */
const BORDER_ROLE = /\bborder(-|\b)/;

/*
 * `DESTINATION_ROW`, the shared box both primary rows take - and now also the
 * four destination rows below them, which is why the alignment is stated on the
 * constant rather than on any one row.
 */
const destinationRow = (() => {
	const start = source.indexOf("const DESTINATION_ROW =");
	return source.slice(start, source.indexOf(";", start));
})();

/**
 * The two primary rows' own class expressions, read through the helper that
 * renders them: `primaryRow` receives the tokens as ARGUMENTS rather than as
 * inline literals, so the pin is on the call sites plus the helper's own
 * `cn(...)` body - which is the one place a border could come back.
 */
const primaryRowBody = (() => {
	const start = source.indexOf("const primaryRow = (");
	const end = source.indexOf("\tconst newChatRow =", start);
	assert.notEqual(start, -1, "the primary-row helper is the anchor here");
	assert.notEqual(end, -1, "the primary-row helper's body is not delimited");
	return source.slice(start, end);
})();

test("the primary-row helper declares no boundary of its own", () => {
	/*
	 * The mutation this catches: `border border-control` back in the shared class
	 * string, which is the 1px inset the operator asked to be rid of. Matched as a
	 * role token rather than the bare word, so a future `border-b` divider on the
	 * rows is reported as its own decision instead of passing silently.
	 */
	const classes = classLiterals(primaryRowBody);
	assert.ok(
		!BORDER_ROLE.test(classes),
		`the primary rows carry a border role again, so they no longer sit on the destinations' inset:\n${primaryRowBody}`,
	);
	assert.ok(
		primaryRowBody.includes("DESTINATION_ROW"),
		"the rows must keep taking DESTINATION_ROW, which is where their box and inset live",
	);
});

test("DESTINATION_ROW still carries the box the rows are aligned on", () => {
	assert.ok(
		ROW_HEIGHT.test(destinationRow) &&
			ROW_INSET.test(destinationRow) &&
			ROW_GAP.test(destinationRow),
		`DESTINATION_ROW no longer declares the 30px box, the px-2 inset and the gap-2 the alignment is measured against:\n${destinationRow}`,
	);
	// And no boundary of its own: the destinations already drew this row without
	// one, so a border here would be a new line on six rows at once.
	assert.ok(
		!BORDER_ROLE.test(destinationRow),
		`DESTINATION_ROW grew a boundary, which every destination and both primary rows now wear:\n${destinationRow}`,
	);
});

/*
 * The RELATIONSHIP, not the absence of a string.
 *
 * The pin above is an absence check on `border-control`, and the regression it
 * exists for has a second entry that stays invisible to it: an inset added to
 * ONE of the two primary rows. So the property is stated directly, and it is now
 * structural rather than comparative: BOTH rows are rendered by the one helper,
 * and neither call site passes a class string of its own - so the two are the
 * same element twice by construction, and there is no "the pair drifted" state
 * left to test for.
 */
test("both primary rows come from the one helper, with no class of their own", () => {
	for (const label of ["New chat", "Search"]) {
		const at = source.indexOf(
			`primaryRow(\n\t\t${label === "Search" ? "Search" : "MessageSquarePlus"}`,
		);
		assert.notEqual(at, -1, `no primaryRow call renders ${label}`);
		// The call ends at the `\t);` that closes its argument list, not at the
		// first `});` in the file - the props object closes with `},` and the
		// helper's own JSX is further down, so a loose anchor sweeps in other rows.
		const call = source.slice(at, source.indexOf("\n\t);", at));
		assert.ok(
			!call.includes("className"),
			`${label} declares a class of its own, so the two rows can drift apart:\n${call}`,
		);
		assert.equal(
			classLiterals(call).match(ROW_BOX_OVERRIDE),
			null,
			`${label} passes a box override, so it no longer takes DESTINATION_ROW's box:\n${call}`,
		);
	}
	// And the helper is the ONLY place the shared box is named, once.
	assert.equal(
		(primaryRowBody.match(/DESTINATION_ROW/g) ?? []).length,
		1,
		"the helper names the shared box more than once, which is two rows by another name",
	);
	assert.equal(
		(primaryRowBody.match(/disabled:/g) ?? []).length,
		2,
		"the disabled vocabulary is one predicate pair on the shared string, not a second rule",
	);
});

test("the row keeps every affordance that marks it as the action", () => {
	const classes = classLiterals(primaryRowBody);
	assert.ok(
		classes.includes("disabled:text-ink-disabled") &&
			classes.includes("disabled:hover:bg-transparent"),
		`the disabled rules are part of the row's class expression and must survive the border removal:\n${classes}`,
	);
	assert.ok(
		CURRENT_DRAFT_PREDICATE.test(source),
		"the row's aria-current must read the one current-draft predicate",
	);
	assert.ok(
		ARIA_CURRENT_PAGE.test(primaryRowBody),
		"the row's `aria-current` is what says it is the staged chat, not its ground alone",
	);
	assert.ok(
		primaryRowBody.includes("props.current\n\t\t\t\t\t\t? rowCurrent"),
		"the current row must take the shared rowCurrent ground, not a second spelling",
	);

	// The icon distinguishes the action from the label-ish rows around it:
	// `Plus` would mean "open a creation form", which is not what this does.
	assert.ok(
		source.includes("primaryRow(\n\t\tMessageSquarePlus,"),
		"the New chat row lost its icon, so it now reads as a destination",
	);
	/*
	 * THE GATE, and it is the same bit `app.tsx`'s ⌘N binding reads: staging a
	 * draft needs the session catalogue, and a row that staged one against an
	 * absent catalogue would be the row claiming a capability the app has just
	 * said it does not have.
	 */
	assert.match(
		source,
		/disabled: !catalogueReady/,
		"the row is no longer disabled on the catalogue gate the chord reads",
	);
	assert.match(
		source,
		/desktopFeatureEnabled\(\s*capabilities\.data,\s*"session_catalogue",\s*2,?\s*\)/,
		"the gate must be the capability bit itself, with its version, not a copy of the rule",
	);
});

test("the row prints the cap the chord is, from the one module that spells it", () => {
	const at = source.indexOf("primaryRow(\n\t\tMessageSquarePlus,");
	assert.notEqual(at, -1, "the New chat row's call site is the anchor");
	const call = stripComments(source.slice(at, source.indexOf("\n\t);", at)));
	assert.ok(
		call.includes("newChatShortcutCap(isMac)"),
		`the row must render the cap from the shipped helper:\n${call}`,
	);
	/*
	 * And it is passed JOINED (`⌘K`, not `⌘ + K`): §C1's rows print the chord as
	 * caps with no separator, which is the design round's N1.
	 */
	assert.match(
		primaryRowBody,
		/<KeyboardShortcut shortcut=\{caps\} joined \/>/,
		"the rows lost their joined caps, so the chord reads as three marks again",
	);
});
