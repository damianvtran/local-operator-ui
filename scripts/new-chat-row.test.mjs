/**
 * The chat sidebar's New chat row, and the border the operator asked it to lose.
 *
 *     node --test scripts/new-chat-row.test.mjs
 *
 * The operator's report was "Can you make a style improvement in
 * local-operator-ui, remove the border around new chat and have it be the same
 * alignment, etc. as the all chats above it so that it looks more consistent
 * and in line". The row wore `border-control`, and because the app is
 * `box-sizing: border-box` that edge sat INSIDE the row's own `h-8` box: the
 * icon and label started 1px further right than the All chats row's directly
 * above. Removing the class is the whole change, which is exactly why it needs
 * a guard — a one-token deletion is also a one-token re-addition, and the
 * affordance that was removed is the kind a later reader would helpfully put
 * back ("this row is a control, it should have an outline").
 *
 * HOW THIS FILE ASSERTS, AND WHAT THAT COSTS. The sidebar cannot be rendered in
 * isolation — it reads the router, the canonical-sessions store and the desktop
 * capability hooks, and this repository's desktop suite is `node:test` over
 * `scripts/*.test.mjs` with no DOM harness — so the property is pinned as
 * SOURCE TEXT over the row's own `className` expression, the idiom
 * `contrast-contract.mjs`'s `STRUCTURAL_CALL_SITES` and `clear-search.test.mjs`
 * already use. The pin is scoped to the extracted button rather than the whole
 * file, so a `border-control` on a NEIGHBOURING row cannot satisfy it.
 *
 * Comments are stripped out of the slice before it is matched, and that is not
 * tidiness — an earlier revision of this file claimed the scoping made comments
 * harmless, which was false: the slice runs from `className={cn(` to the first
 * `)}`, and `cn()`'s argument list is exactly where a reader writes the note
 * explaining the row (`// Marked current on the same terms as an entity row…`)
 * or, worse, `// no border-control here, see above` — which satisfied the pin
 * while the attribute was absent and broke it once it was present. The strip is
 * the fix for that; the cut itself must stay wide enough to keep `rowStyle` in
 * view, because pinning the reference is half of what this file is for.
 *
 * What this file does NOT prove: that anything is VISIBLE, or that the two rows
 * really land on the same left inset. That is a fact about the box the class
 * produces, and it is measured from the live DOM in
 * `docs/evidence/new-chat-row/README.md` (icon left inset 5px before, 4px
 * after, against 4px on the All chats row).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = process.cwd();
const SIDEBAR = "src/renderer/src/features/chat/components/chat-sidebar.tsx";
const source = readFileSync(join(ROOT, SIDEBAR), "utf8");

/** The 4px-on-the-ramp inset `rowStyle` supplies, and the box it sits in. */
const ROW_HEIGHT = /\bh-8\b/;
const ROW_INSET = /\bpx-1\b/;
const ROW_GAP = /\bgap-1\b/;

/**
 * A horizontal inset, a height or a gap a row declares of its OWN.
 *
 * This is the second entry to the regression class this file exists to catch,
 * and the one an absence check cannot see: `pl-1.5`, `px-2`, `gap-2` or `h-9`
 * added to the New chat row alone move it off the All chats column while
 * `rowStyle` stays untouched and no border role appears. The row has to take
 * those three from `rowStyle` — that is what "the same alignment" means in the
 * source — so any one of them in the row's own literals is the defect.
 */
const ROW_BOX_OVERRIDE = /\b(?:p|px|py|pl|pr|pt|pb|h|gap|min-h|space-x)-[^\s"']+/;

/**
 * How a row may legitimately differ from the All chats row: a vertical step and
 * the disabled pair. Anything else is a difference between two rows this file
 * claims are the same shape.
 */
const ROW_SPECIFIC_TOKENS = [
	"disabled:hover:bg-transparent",
	"disabled:text-ink-disabled",
	"mb-1",
];

/**
 * Strip `//` and comment-block comments, outside string literals.
 *
 * Written as a scanner rather than two `replace()` passes because the slice can
 * legitimately contain a `//` inside a quoted string (a URL in a comment is the
 * usual way this bites), and a regular expression cannot tell that from the
 * start of a comment.
 */
const stripComments = (text) => {
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
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
			i += 2;
			continue;
		}
		out += char;
		i += 1;
	}
	return out;
};

/** The literal class strings a row's expression passes, comments removed. */
const classLiterals = (classes) =>
	[...stripComments(classes).matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)]
		.map((match) => match[1])
		.join(" ");

/** One class token, for comparing two rows' own class strings. */
const WHITESPACE = /\s+/;

/** A border ROLE token, so a future `border-b` divider reads as its own decision. */
const BORDER_ROLE = /\bborder(-|\b)/;

/** The 1-step margin that separates the row from the split below it. */
const MB_1 = /\bmb-1\b/;

/**
 * The row's current-draft predicate, which `aria-current` has to agree with.
 *
 * Re-pointed from `"bg-accent-wash"` to `rowCurrent` when the sidebar's
 * current-row ground moved off the wash: on this `bg-surface` panel the wash is
 * ΔE00 1.05 from the ground in tokyoNight, so the state it marked was invisible.
 * The PREDICATE is what this regex is for and it is unchanged — the ground it
 * paints is now the shared one, pinned in `chat-sidebar-selection.test.mjs`.
 */
const CURRENT_DRAFT_PREDICATE =
	/Boolean\(activeDraftKey\)\s*&&\s*!draft\?\.target\s*&&\s*rowCurrent/;

const ARIA_CURRENT_PAGE = /aria-current=\{[\s\S]*?"page"[\s\S]*?\}/;

/** The `className={cn(...)}` expression of one row, by its visible label. */
const classExpressionFor = (label) => {
	const labelAt = source.indexOf(`>${label}</span>`);
	assert.notEqual(
		labelAt,
		-1,
		`no row renders the label ${JSON.stringify(label)}`,
	);
	const buttonAt = source.lastIndexOf("<button", labelAt);
	assert.notEqual(
		buttonAt,
		-1,
		`no <button> opens before ${JSON.stringify(label)}`,
	);
	const button = source.slice(buttonAt, source.indexOf("</button>", labelAt));
	const start = button.indexOf("className={cn(");
	assert.notEqual(start, -1, `${label} has no cn() class expression`);
	const end = button.indexOf(")}", start);
	// Comments are stripped so a `border-control` MENTIONED between `cn()`'s
	// arguments cannot satisfy the boundary pin or break it; see the header.
	return stripComments(button.slice(start + "className={cn(".length, end));
};

/**
 * `rowStyle`, the shared inset both rows take. Pinned because the alignment is
 * a consequence of it: the fix removed the border, not the padding, so a change
 * here would move BOTH rows and the measurement in the evidence set would stop
 * describing what the source does.
 */
const rowStyle = (() => {
	const start = source.indexOf("const rowStyle =");
	const end = source.indexOf(";", start);
	return source.slice(start, end);
})();

test("the New chat row declares no boundary of its own", () => {
	const classes = classExpressionFor("New chat");
	// The mutation this catches: `border border-control` back in the string,
	// which is the 1px inset the operator asked to be rid of. Matched as a role
	// token rather than the bare word, so a future `border-b` divider on the row
	// is reported as its own decision instead of passing silently.
	assert.ok(
		!BORDER_ROLE.test(classes),
		`the New chat row carries a border role again, so it no longer sits on the same inset as All chats:\n${classes}`,
	);
	assert.ok(
		classes.includes("rowStyle"),
		"the row must keep taking rowStyle, which is where its h-8 box and px-1 inset live",
	);
});

test("the All chats row above it declares none either, so the pair is consistent", () => {
	const classes = classExpressionFor("All chats");
	assert.ok(
		!BORDER_ROLE.test(classes),
		`the All chats row grew a border, so the New chat row can no longer match it:\n${classes}`,
	);
	assert.ok(classes.includes("rowStyle"));
});

test("rowStyle still carries the box the two rows are aligned on", () => {
	assert.ok(
		ROW_HEIGHT.test(rowStyle) && ROW_INSET.test(rowStyle) && ROW_GAP.test(rowStyle),
		`rowStyle no longer declares the h-8 box, the px-1 inset and the gap-1 the alignment is measured against:\n${rowStyle}`,
	);
});

/*
 * The RELATIONSHIP, not the absence of a string.
 *
 * The pin above is an absence check on `border-control`, and the regression it
 * exists for has a second entry that stays invisible to it: an inset added to
 * the New chat row ALONE. `pl-1.5`, `px-2`, `gap-2` or `h-9` in the row's own
 * class literals moves it off the All chats column with `rowStyle` untouched
 * and no border role anywhere - every test above stays green while the two rows
 * stop lining up (review finding M2). So the property is stated directly: the
 * row brings no horizontal inset, no gap and no height of its own, and what it
 * shares with the All chats row is the `rowStyle` reference itself, which is
 * the only place those three live.
 */
test("the New chat row declares no box of its own, so it takes rowStyle's", () => {
	const classes = classExpressionFor("New chat");
	assert.ok(
		classes.includes("rowStyle"),
		"the row must keep taking rowStyle, which is where its h-8 box, px-1 inset and gap-1 live",
	);
	const literals = classLiterals(classes);
	const override = literals.match(ROW_BOX_OVERRIDE);
	assert.equal(
		override,
		null,
		`the New chat row declares ${JSON.stringify(override?.[0])} of its own, so it no longer takes rowStyle's px-1/h-8/gap-1 exactly as the All chats row does:\n${classes}`,
	);
});

test("the two rows differ only by the vertical step and the disabled pair", () => {
	const tokens = (label) =>
		classLiterals(classExpressionFor(label)).split(WHITESPACE).filter(Boolean);
	const newChat = new Set(tokens("New chat"));
	const allChats = new Set(tokens("All chats"));
	/*
	 * BOTH directions, because each is a way to break an alignment this file
	 * cannot measure from source alone. An inset added to the All chats row
	 * moves it off the New chat column exactly as one added here does, and a
	 * token New chat LOSES (`w-full`, say) never reaches the extras below - a
	 * one-directional comparison reads a row that dropped a class as a row that
	 * agreed. Stating the relationship as an equality is what makes either side
	 * of the pair observable.
	 */
	assert.deepEqual(
		tokens("New chat")
			.filter((token) => !allChats.has(token))
			.sort(),
		[...ROW_SPECIFIC_TOKENS].sort(),
		"the New chat row added or lost a class the All chats row does not carry, so the pair is no longer the same row with a margin",
	);
	assert.deepEqual(
		tokens("All chats")
			.filter((token) => !newChat.has(token))
			.sort(),
		[],
		"the All chats row carries a class the New chat row does not, so an inset added to the row ABOVE moves it off the alignment this branch establishes just as one added below would",
	);
});

test("the row keeps every affordance that marks it as the action", () => {
	const classes = classExpressionFor("New chat");
	assert.ok(
		MB_1.test(classes),
		"the margin below the row is what separates it from the Active/Previous split",
	);
	assert.ok(
		classes.includes("disabled:text-ink-disabled") &&
			classes.includes("disabled:hover:bg-transparent"),
		`the disabled rules are part of the row's class expression and must survive the border removal:\n${classes}`,
	);
	assert.ok(
		CURRENT_DRAFT_PREDICATE.test(classes),
		`the current-draft wash must stay on the same predicate as the row's aria-current:\n${classes}`,
	);

	const labelAt = source.indexOf(">New chat</span>");
	const buttonAt = source.lastIndexOf("<button", labelAt);
	const button = source.slice(buttonAt, source.indexOf("</button>", labelAt));
	assert.ok(
		button.includes("<MessageSquarePlus"),
		'the icon is what distinguishes this row from the label-ish rows around it; `Plus` would mean "open a creation form"',
	);
	assert.ok(
		button.includes("data-chat-row={ready || undefined}"),
		"the row is a stop in the keyboard ring only while ready, and a disabled button refuses .focus()",
	);
	assert.ok(button.includes("disabled={!ready}"));
	assert.ok(ARIA_CURRENT_PAGE.test(button));
});
