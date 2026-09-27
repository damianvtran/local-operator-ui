import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The sidebar's DRAFTS section and its two controls: the per-row discard and the
 * "Clear all" foot.
 *
 * WHY THIS FILE EXISTS. The operator asked for both on 2026-09-26 - "Each one
 * should have a deletion on hover and also a subtle clear all UX" - beside the
 * report that sent drafts were resurfacing (the store half of that is
 * `canonical-chat.test.mjs`; the composer-side row this section's delete has to
 * clear with it is `discardDraft`'s own store tests). The sidebar cannot be
 * mounted in this suite for a rendered assertion (it reads the router, the store,
 * every picker and the capability hooks; `mark-all-read-control.test.mjs` carries
 * a jsdom mount and its own scope), so what is left here is what no module can
 * hold: that the shipped component actually wires the decisions in the shape the
 * design depends on - a control that is a SIBLING of the row's button, a reveal
 * that cannot strand the keyboard, a foot that clears exactly the rows above it.
 *
 * Each assertion is an ANCHOR read, following `chat-sidebar-archive.test.mjs`,
 * which states the same trade: a rename inside these slices keeps this file red,
 * and that is the point.
 *
 * What it is NOT: evidence that any of it renders or that a pointer reveals it.
 * That is the frames' job under `docs/evidence/chat-sidebar-drafts/` and the
 * driver run's, on the built app.
 */

const SIDEBAR = "src/renderer/src/features/chat/components/chat-sidebar.tsx";
const DRAFT_ROWS = "src/renderer/src/features/chat/draft-rows.ts";

const read = (path) => readFileSync(path, "utf8");
/** Comments stripped, so a rule can never be satisfied by prose about the rule. */
const code = (path) =>
	read(path)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The source between an anchor and the next occurrence of `end`. */
const between = (path, start, end) => {
	const source = code(path);
	const at = source.indexOf(start);
	assert.notEqual(
		at,
		-1,
		`${path} no longer contains ${JSON.stringify(start)}`,
	);
	const stop = source.indexOf(end, at);
	assert.notEqual(
		stop,
		-1,
		`${path} no longer contains ${JSON.stringify(end)} after ${JSON.stringify(start)} - the slice would have run to the end of the file`,
	);
	return source.slice(at, stop);
};

const DRAFTS_SECTION = () =>
	between(SIDEBAR, `data-chat-section="drafts"`, "</section>");

/*
 * The draft-rows module, run rather than read, for the one pure decision this
 * section renders: the control's accessible name (and tooltip).
 */
const bundle = await build({
	stdin: {
		contents: 'export * from "./src/renderer/src/features/chat/draft-rows";',
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	logLevel: "silent",
});
const draftRows = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("the discard control's name is an action with the row's own title, not the row's label verbatim", () => {
	/*
	 * The action, never the state, and the prefix does not echo (the row's label
	 * already says "Draft: " - the control would otherwise read the noun twice).
	 * `title` carries the same string in the component below, so the pointer and
	 * the screen reader describe the control in one voice.
	 */
	assert.equal(
		draftRows.discardDraftLabel("Draft: Can you check our google drive"),
		"Discard draft “Can you check our google drive”",
	);
	assert.equal(
		draftRows.discardDraftLabel("no prefix, kept as is"),
		"Discard draft “no prefix, kept as is”",
	);
	/*
	 * And the module still declares the prefix the strip reads, so a prefix that
	 * moves cannot silently leave the label intact.
	 */
	assert.equal(draftRows.DRAFT_ROW_PREFIX, "Draft: ");
});

test("the discard control is a SIBLING of the row's button, and the wrapper carries the group state", () => {
	const section = DRAFTS_SECTION();
	/*
	 * A nested button is invalid HTML and unfocusable, and a press inside it
	 * would fire the row's own onClick as well - opening the very draft the
	 * reader was trying to discard. The row's button must close before the
	 * control opens, and the reveal hangs off the wrapper's `group`.
	 */
	const rowButtonEnd = section.indexOf("</button>");
	const control = section.indexOf("data-draft-discard={row.key}");
	assert.notEqual(rowButtonEnd, -1, "the row's button no longer closes");
	assert.notEqual(control, -1, "the row no longer mounts a discard control");
	assert.ok(
		control > rowButtonEnd,
		"the discard control must open after the row's button closes (sibling, never child)",
	);
	const wrapper = section.slice(0, section.indexOf("data-draft-row={row.key}"));
	assert.match(
		wrapper,
		/className=\{cn\(\s*rowBoxStyle,\s*"group",/,
		"the row's box is the group carrier the reveal reads",
	);
});

test("the control is out of sight at rest and revealed by hover or focus, as one pair", () => {
	const section = DRAFTS_SECTION();
	const control = section.slice(
		section.indexOf("data-draft-discard={row.key}"),
		section.indexOf("</button>", section.indexOf("data-draft-discard={row.key}")),
	);
	/*
	 * The session acts' own pair, verbatim: base `hidden` plus a variant that adds
	 * `flex`, so the reveal does not reflow an element that was laid out anyway.
	 */
	assert.match(control, /"hidden text-ink-dim group-hover:flex group-hover:text-ink-muted"/);
	assert.match(
		control,
		/"group-focus-within:flex group-focus-within:text-ink-muted hover:text-ink!"/,
	);
	/*
	 * AND THE KEYBOARD ROUTE IS THE REVEAL, not a chord: unlike the session rows'
	 * two acts (which left the Tab ring for ⌘⇧P / ⌘⇧A), a draft has no advertised
	 * chord - so the control must carry NO `tabIndex` prop. `hidden` keeps it out
	 * of the ring at rest; once the row has focus, `group-focus-within` reveals it
	 * and the next Tab lands on it. The sidebar's tabIndex count stays the four
	 * sanctioned sites (`chat-keyboard-regions.test.mjs` counts them).
	 */
	assert.ok(
		!/tabIndex/.test(control),
		"the discard control must not declare a tabIndex - the reveal is its keyboard route",
	);
});

test("the press is guarded against the row that slides up, and hands the caret to a successor", () => {
	const section = DRAFTS_SECTION();
	const control = section.slice(
		section.indexOf("data-draft-discard={row.key}"),
		section.indexOf("</button>", section.indexOf("data-draft-discard={row.key}")),
	);
	/*
	 * The panel's own record (`dropRepeatPress`), read BEFORE the write: the row
	 * unmounts under the second click of a double-click, and the row that slides
	 * up can carry its act into the same spot. A dropped press writes nothing.
	 */
	assert.match(control, /dropRepeatPress\(/);
	/*
	 * THE CARET LANDS SOMEWHERE, the archive's no-dead-cursor rule: the successor
	 * index is read from the DOM before the write and focus is handed to the row
	 * occupying that position after it - never left on `<body>`.
	 */
	assert.match(control, /discardDraft\(row\.key\);/);
	assert.match(control, /requestAnimationFrame\(\(\) => \{/);
	assert.match(control, /\[data-draft-row\]/);
	assert.match(control, /next\?\.focus\(\);/);
});

test("the clear-all is inside the drafts section, rides the row walk, and clears exactly the listed keys", () => {
	const section = DRAFTS_SECTION();
	const foot = section.slice(section.indexOf("data-drafts-clear-all"));
	assert.notEqual(
		section.indexOf("data-drafts-clear-all"),
		-1,
		"the foot control is not inside the drafts section",
	);
	/*
	 * EXACTLY THE ROWS THE SECTION LISTS: `draftRows` is `untargetedDraftRows`'s
	 * output, so a targeted/agent draft - never a row here - can never be cleared
	 * by this control. One store write, not a caller-side loop.
	 */
	assert.match(foot, /discardDrafts\(draftRows\.map\(\(row\) => row\.key\)\);/);
	/*
	 * THE SAME PRESS GUARD as the rows, under its own identity: this control also
	 * unmounts under a repeat press (the section empties), and the chat row that
	 * takes its place must not answer the same double-click by opening a chat.
	 */
	assert.match(foot, /dropRepeatPress\(/);
	assert.match(foot, /"drafts:clear-all",/);
	/*
	 * IN THE ARROW WALK (`data-chat-row`), the bulk read receipt's precedent, so
	 * ↑/↓ reaches it from the rows above; and it hands the caret to the row that
	 * takes its place when it clears itself away.
	 */
	assert.match(foot, /data-chat-row/);
	assert.match(foot, /rows\[Math\.min\(Math\.max\(at, 0\), rows\.length - 1\)\]\?\.focus\(\);/);
	/*
	 * SUBTLE, and a row state rather than a ground: the low-emphasis register
	 * (`text-ink-dim` stepping to `ink` on hover, no elevation) that the section's
	 * other foot controls use.
	 */
	assert.match(foot, /hover:bg-row-hover hover:text-ink/);
	assert.ok(
		!/bg-elevated|bg-surface(?!-)/.test(foot),
		"the foot must not carry a ground role",
	);
});

test("the section's gate is what hides the foot: no rows, no control", () => {
	/*
	 * The foot lives INSIDE the `draftRows.length > 0 && !query.trim()` condition
	 * (one slice, one gate), so the empty state cannot render a control with
	 * nothing to clear - and a search cannot clear rows the reader cannot see.
	 */
	const source = code(SIDEBAR);
	const gate = source.indexOf("{draftRows.length > 0 && !query.trim() && (");
	const section = source.indexOf('data-chat-section="drafts"');
	const foot = source.indexOf("data-drafts-clear-all");
	assert.notEqual(gate, -1, "the drafts section's render gate moved");
	assert.notEqual(foot, -1, "the foot control is gone");
	assert.ok(gate < section && section < foot, "the foot must sit inside the section's gate");
});
