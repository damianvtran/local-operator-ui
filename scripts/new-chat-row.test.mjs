/**
 * The chat sidebar's New chat row, and the pill the operator asked it to lose.
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
 * file, so a `border-control` in a comment or on a neighbouring row cannot
 * satisfy it and cannot break it.
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

/** A border ROLE token, so a future `border-b` divider reads as its own decision. */
const BORDER_ROLE = /\bborder(-|\b)/;

/** The 1-step margin that separates the row from the split below it. */
const MB_1 = /\bmb-1\b/;

/** The row's current-draft predicate, which `aria-current` has to agree with. */
const CURRENT_DRAFT_PREDICATE =
	/Boolean\(activeDraftKey\)\s*&&\s*!draft\?\.target\s*&&\s*"bg-accent-wash"/;

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
	return button.slice(start + "className={cn(".length, end);
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

test("rowStyle still carries the inset the two rows are aligned on", () => {
	assert.ok(
		ROW_HEIGHT.test(rowStyle) && ROW_INSET.test(rowStyle),
		`rowStyle no longer declares the h-8 box and px-1 inset the alignment is measured against:\n${rowStyle}`,
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
