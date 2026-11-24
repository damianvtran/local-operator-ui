/**
 * THE AGENTS/TEAMS ROWS KEEP THEIR ICONS IN ONE COLUMN (after v0.63.0).
 *
 * The operator: "it bothers me that the column space for icons is uneven, can
 * you fix that so they don't go left and out of column for shorter team
 * names". The entity row's trailing cluster is: the name button (mark, name,
 * new-chat glyph, census count), then history, pin (agents), the hub link
 * mark, and more. The name is `flex-1`, so the new-chat glyph and count sit at
 * the name button's END edge - and that edge moved whenever a slot after it
 * changed width: a one-digit `min-w-4` count slot grew for "511", and the hub
 * link mark vanished on rows without a link. Both shifted the glyph start-ward
 * on exactly the rows with short names and no link.
 *
 * WHAT THIS PINS, read from `chat-sidebar.tsx`'s entity row:
 *   1. the count slot reserves three tabular digits (`min-w-[3ch]` +
 *      `tabular-nums`), end-aligned with a logical property (`text-end`);
 *   2. every hub mark renders INSIDE one always-present `w-6 shrink-0` slot
 *      (`data-entity-link-slot`), never as a bare conditional sibling.
 * Each is run against a NEGATIVE CONTROL - the v0.63.0 shape, reintroduced as
 * text - so the guard is shown able to fail.
 *
 * WHAT THIS CANNOT SAY: that the pixels line up. Rendered proof is the design
 * round's capture of a Teams list mixing counts, links and short names.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sidebar = readFileSync(
	"src/renderer/src/features/chat/components/chat-sidebar.tsx",
	"utf8",
);

const stripComments = (source) =>
	source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

/* The entity row: from its `data-entity` wrapper to its `More` button's label. */
function entityRow(source) {
	const code = stripComments(source);
	const start = code.indexOf("<div key={key} data-entity>");
	const end = code.indexOf('"ui.chat.sidebar.entity.manage"', start);
	assert.ok(start > 0 && end > start, "entity row located");
	return code.slice(start, end);
}

function countSlotReservesThreeDigits(source) {
	const row = entityRow(source);
	const slot = row.match(/className="([^"]*)"\s*>\s*\{badge \|\| ""\}/);
	if (!slot) return false;
	const classes = slot[1].split(/\s+/);
	return (
		classes.includes("min-w-[3ch]") &&
		classes.includes("tabular-nums") &&
		classes.includes("shrink-0") &&
		classes.includes("text-end") &&
		!classes.some((c) => /^(?:text-right|text-left)$/.test(c))
	);
}

const HUB_MARKS = [
	"HubLinkSidebarMark",
	"HubLinkAggregateMark",
	"HubUnresolvedMark",
	"HubUpdateMark",
];

function hubMarksShareOneReservedSlot(source) {
	const row = entityRow(source);
	const open = row.match(
		/<span\s+data-entity-link-slot\s+className="([^"]*)"\s*>/,
	);
	if (!open) return false;
	const classes = open[1].split(/\s+/);
	if (!classes.includes("w-6") || !classes.includes("shrink-0")) return false;
	// The slot itself is unconditional: no `cond && (` directly before it.
	const before = row.slice(0, open.index).trimEnd();
	if (/&&\s*\($/.test(before)) return false;
	const inner = row.slice(open.index + open[0].length);
	const close = inner.indexOf("</span>\n");
	// Every mark lives between the slot's open tag and its close.
	const body = inner.slice(0, inner.search(/<\/span>\s*<button/));
	return close >= 0 && HUB_MARKS.every((mark) => body.includes(`<${mark}`));
}

test("the census count reserves three tabular digits, end-aligned", () => {
	assert.equal(countSlotReservesThreeDigits(sidebar), true);
	// Negative control: the v0.63.0 single-digit slot.
	const before = sidebar.replace(
		"min-w-[3ch] shrink-0 text-end",
		"min-w-4 shrink-0 text-end",
	);
	assert.notEqual(before, sidebar, "control mutation applied");
	assert.equal(countSlotReservesThreeDigits(before), false);
});

test("the hub link marks share one always-present 24px slot", () => {
	assert.equal(hubMarksShareOneReservedSlot(sidebar), true);
	// Negative control: the v0.63.0 shape - bare conditional marks, no slot.
	const collapsed = sidebar
		.replace(/<span\s+data-entity-link-slot\s+className="[^"]*"\s*>/, "")
		.replace(
			/(pressHubMark\(kind, name, hubMark\)\}\s*\/>\s*\)\}\s*)<\/span>/,
			"$1",
		);
	assert.notEqual(collapsed, sidebar, "control mutation applied");
	assert.equal(hubMarksShareOneReservedSlot(collapsed), false);
	// Negative control: a slot that collapses itself when empty.
	const conditional = sidebar.replace(
		/<span\s+data-entity-link-slot/,
		"{linkedOrigins.length > 0 && (<span data-entity-link-slot",
	);
	assert.equal(hubMarksShareOneReservedSlot(conditional), false);
});
