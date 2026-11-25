/**
 * THE AGENTS/TEAMS ROWS KEEP THEIR ICONS IN ONE COLUMN, PER SECTION (after v0.63.0).
 *
 * The operator: "it bothers me that the column space for icons is uneven, can
 * you fix that so they don't go left and out of column for shorter team
 * names". The entity row's trailing cluster is: the name button (mark, name,
 * new-chat glyph, census count), then history, pin (agents), the hub link
 * mark, and more. The name is `flex-1`, so the new-chat glyph and count sit at
 * the name button's END edge - and that edge moved whenever a slot after it
 * changed width: a one-digit count slot grew for "511", and the hub link mark
 * vanished on rows without a link.
 *
 * The first fix reserved a flat 3ch count and a 24px link slot on EVERY row,
 * which cut Agents names to ~38px in a list with no links or counts (design
 * round 1, D1). The columns are now sized per SECTION, over the rows it draws.
 *
 * WHAT THIS PINS, read from `chat-sidebar.tsx`:
 *   1. `sectionEntityColumns` (run here): the count slot is the widest census in
 *      digits, 0 with no census; the link slot only when a drawn row has a mark;
 *   2. every row of a section receives ONE section-level `EntityColumns` value
 *      (computed by `entityColumns` beside the section, never per row);
 *   3. the count slot renders only when `countCh > 0`, sized `minWidth: <n>ch`,
 *      tabular and end-aligned; the link slot (`w-6`, holding all four hub
 *      marks) renders only when `linkSlot`.
 * Each is run against a NEGATIVE CONTROL so the guard is shown able to fail.
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

function loadSectionColumns(source) {
	const fn = source.match(/function sectionEntityColumns\([\s\S]*?\n\}/);
	assert.ok(fn, "sectionEntityColumns located");
	const js = fn[0]
		.replace(/rows: readonly \{[^}]*\}\[\],?/, "rows")
		.replace(/\): EntityColumns \{/, ") {");
	return new Function(`${js}; return sectionEntityColumns;`)();
}

/* The facts a QA fixture section carries: no links, census on some rows. */
const plain = (badge = 0) => ({ badge, drawsLinkMark: false });

function columnsSizeToUse(sectionColumns) {
	const none = sectionColumns([plain(), plain(), plain()]);
	const counted = sectionColumns([plain(), plain(1), plain(511), plain(2)]);
	const linked = sectionColumns([plain(), { badge: 0, drawsLinkMark: true }]);
	return (
		none.countCh === 0 &&
		none.linkSlot === false &&
		counted.countCh === 3 &&
		counted.linkSlot === false &&
		sectionColumns([plain(7), plain(12)]).countCh === 2 &&
		linked.countCh === 0 &&
		linked.linkSlot === true &&
		sectionColumns([]).countCh === 0
	);
}

test("a section reserves only the count width and link slot its drawn rows use", () => {
	assert.equal(columnsSizeToUse(loadSectionColumns(sidebar)), true);
	// Negative control: the round-1 flat reservation on every row.
	const flat = () => ({ countCh: 3, linkSlot: true });
	assert.equal(columnsSizeToUse(flat), false);
	// Negative control: per-row sizing (each row its own digits) is not a column.
	const perRow = (rows) => ({
		countCh: rows.length ? String(rows.at(-1).badge || "").length : 0,
		linkSlot: rows.some((row) => row.drawsLinkMark),
	});
	assert.equal(columnsSizeToUse(perRow), false);
});

/* Every `entity(...)` call passes one section-level columns value, never a per-row one. */
function rowsShareSectionColumns(source) {
	const code = stripComments(source);
	const calls = [
		...code.matchAll(/\bentity\(\s*"(agent|team)",\s*[\w.]+,\s*(\w+)/g),
	];
	if (calls.length < 3) return false;
	return calls.every(([, kind, columns]) => {
		const decl = code.match(
			new RegExp(`const ${columns} = entityColumns\\(\\s*"${kind}",`),
		);
		return Boolean(decl);
	});
}

test("every row of a section shares the section's columns", () => {
	assert.equal(rowsShareSectionColumns(sidebar), true);
	// Negative control: one call site sizing its row on its own.
	const perRow = sidebar.replace(
		'entity("team", team.name, teamColumns)',
		'entity("team", team.name, rowColumns)',
	);
	assert.notEqual(perRow, sidebar, "control mutation applied");
	assert.equal(rowsShareSectionColumns(perRow), false);
});

function countSlotIsSectionSized(source) {
	const row = entityRow(source);
	const slot = row.match(
		/\{columns\.countCh > 0 && \(\s*<span\s[\s\S]*?style=\{\{ minWidth: `\$\{columns\.countCh\}ch` \}\}\s*className="([^"]*)"\s*>\s*\{badge \|\| ""\}/,
	);
	if (!slot) return false;
	const classes = slot[1].split(/\s+/);
	return (
		classes.includes("tabular-nums") &&
		classes.includes("shrink-0") &&
		classes.includes("text-end") &&
		!classes.some((c) => /^(?:min-w-|text-right|text-left)/.test(c))
	);
}

const HUB_MARKS = [
	"HubLinkSidebarMark",
	"HubLinkAggregateMark",
	"HubUnresolvedMark",
	"HubUpdateMark",
];

function hubMarksShareOneSectionSlot(source) {
	const row = entityRow(source);
	const open = row.match(
		/\{columns\.linkSlot && \(\s*<span\s+data-entity-link-slot\s+className="([^"]*)"\s*>/,
	);
	if (!open) return false;
	const classes = open[1].split(/\s+/);
	if (!classes.includes("w-6") || !classes.includes("shrink-0")) return false;
	const inner = row.slice(open.index + open[0].length);
	const body = inner.slice(0, inner.search(/<\/span>\s*\)\}\s*<button/));
	return (
		body.length > 0 && HUB_MARKS.every((mark) => body.includes(`<${mark}`))
	);
}

test("the census slot is the section's width, tabular, end-aligned, absent when unused", () => {
	assert.equal(countSlotIsSectionSized(sidebar), true);
	// Negative control: the round-1 flat 3ch on every row.
	const flat = sidebar
		.replace("{columns.countCh > 0 && (", "{(")
		.replace(
			"style={{ minWidth: `${columns.countCh}ch` }}",
			'style={{ minWidth: "3ch" }}',
		);
	assert.notEqual(flat, sidebar, "control mutation applied");
	assert.equal(countSlotIsSectionSized(flat), false);
});

test("the hub link marks share one 24px slot, mounted only for a linked section", () => {
	assert.equal(hubMarksShareOneSectionSlot(sidebar), true);
	// Negative control: the round-1 slot reserved on every row.
	const always = sidebar.replace(
		/\{columns\.linkSlot && \(\s*<span\s+data-entity-link-slot/,
		"{(<span data-entity-link-slot",
	);
	assert.notEqual(always, sidebar, "control mutation applied");
	assert.equal(hubMarksShareOneSectionSlot(always), false);
	// Negative control: a per-row collapse (the v0.63.0 shape).
	const perRow = sidebar.replace(
		/\{columns\.linkSlot && \(\s*<span\s+data-entity-link-slot/,
		"{linkedOrigins.length > 0 && (<span data-entity-link-slot",
	);
	assert.equal(hubMarksShareOneSectionSlot(perRow), false);
});
