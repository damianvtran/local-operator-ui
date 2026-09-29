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
 * `drafts-clear-on-send.test.mjs`; the composer-side row this section's delete
 * has to clear with it is `discardDraft`'s own store tests). The sidebar cannot be
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
/** The always-mounted surface the discard offer's toast is raised by since 2026-09-27. */
const TOASTS = "src/renderer/src/features/chat/components/undo-toasts.tsx";

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
		section.indexOf(
			"</button>",
			section.indexOf("data-draft-discard={row.key}"),
		),
	);
	/*
	 * The session acts' own pair, verbatim: base `hidden` plus a variant that adds
	 * `flex`, so the reveal does not reflow an element that was laid out anyway.
	 */
	assert.match(
		control,
		/"hidden text-ink-dim group-hover:flex group-hover:text-ink-muted"/,
	);
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
		section.indexOf(
			"</button>",
			section.indexOf("data-draft-discard={row.key}"),
		),
	);
	/*
	 * The panel's own record (`dropRepeatPress`), read BEFORE the write: the row
	 * unmounts under the second click of a double-click, and the row that slides
	 * up can carry its act into the same spot. A dropped press writes nothing.
	 */
	assert.match(control, /dropRepeatPress\(/);
	/*
	 * THE CARET LANDS SOMEWHERE, the archive's no-dead-cursor rule - and the
	 * successor is read BY KEY (agent review round 1's R2 = design round 1's D2):
	 * the old expression indexed the discard BUTTON among `[data-draft-row]`
	 * elements, so it always returned -1 and the caret always landed on the first
	 * row. The arithmetic itself is exercised in `drafts-clear-on-send.test.mjs`
	 * (`discardSuccessorIndex`'s own cases); what this suite pins is that the
	 * handler reads the keys and hands the same helper those keys.
	 */
	assert.match(control, /discardSuccessorIndex\(keys, row\.key\)/);
	assert.match(control, /getAttribute\("data-draft-row"\)/);
	assert.match(control, /requestAnimationFrame\(\(\) => \{/);
	assert.match(control, /next\?\.focus\(\);/);
	/*
	 * AND A PANE THAT WAS SHOWING THIS DRAFT IS GIVEN A FRESH ONE (UX round 1's U1):
	 * `discardDraft` clears `activeDraftKey`, and the chat page's residue arm has no
	 * composer - so the press stages the New chat row's own pair when the pane was
	 * on this key.
	 */
	assert.match(control, /activeDraftKey === row\.key/);
	assert.match(control, /onStageDraft\(undefined, true\)/);
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
	 * EXACTLY THE ROWS THE SECTION LISTS: the keys come from
	 * `untargetedDraftRows`'s output (minus any live send hop, UX round 1's U2),
	 * so a targeted/agent draft - never a row here - can never be cleared by this
	 * control, and a row mid-send is not silently cancelled by the batch. One
	 * store write, not a caller-side loop.
	 */
	assert.match(foot, /clearableDraftRows\.map\(\(row\) => row\.key\)/);
	assert.match(foot, /discardDrafts\(clearing\);/);
	/*
	 * AND THE SAME `aria-disabled` + refused press as the rows (agent review round
	 * 2's R7, design round 2's D7): the foot stays focusable while inapplicable -
	 * an arrow-walk step must land somewhere - and its own why is described the
	 * same way the trash's is.
	 */
	assert.match(foot, /aria-disabled=\{clearableDraftRows\.length === 0\}/);
	assert.ok(
		!/^\t+disabled=\{clearableDraftRows\.length === 0\}/m.test(foot),
		"a real disabled attribute is the walk dead stop R7 measured",
	);
	assert.match(foot, /if \(clearableDraftRows\.length === 0\) \{/);
	assert.match(foot, /CLEAR_ALL_WHY_ID/);
	assert.match(foot, /CLEAR_ALL_WHY/);
	assert.match(foot, /aria-disabled:text-ink-disabled!/);
	/*
	 * The fresh key the discard stages is written to the STORE (`setStagedByDiscard`),
	 * not a panel ref: the offer's own press that reads it lives on the app-level toast
	 * surface now (2026-09-27), so the writer and the reader can no longer share one
	 * component's memory.
	 */
	assert.match(foot, /setStagedByDiscard\(/);
	/*
	 * THE SAME NO-DEAD-PANE RULE THE ROW ACT CARRIES (UX round 1's U1): when the
	 * batch took the pane's own draft, a fresh one is staged.
	 */
	assert.match(foot, /clearing\.includes\(activeDraftKey\)/);
	assert.match(foot, /onStageDraft\(undefined, true\)/);
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
	assert.match(
		foot,
		/rows\[Math\.min\(Math\.max\(at, 0\), rows\.length - 1\)\]\?\.focus\(\);/,
	);
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
	assert.ok(
		gate < section && section < foot,
		"the foot must sit inside the section's gate",
	);
});

test("a row whose send hop is live cannot be discarded", () => {
	const section = DRAFTS_SECTION();
	const control = section.slice(
		section.indexOf("data-draft-discard={row.key}"),
		section.indexOf(
			"</button>",
			section.indexOf("data-draft-discard={row.key}"),
		),
	);
	/*
	 * UX round 1's U2, remediation: with the create request held, the press used to
	 * remove the row while the send went on to land in an unread chat.
	 *
	 * AND IT IS `aria-disabled`, NOT `disabled` (agent review round 2's R7, design
	 * round 2's D7): a real `disabled` attribute cannot hold focus - the arrow-walk
	 * step onto it dead-stopped and the why below was unannounceable - so the control
	 * stays focusable and the PRESS is what refuses. The walk and the ring exclude
	 * unreachable rows by the same predicate in the sidebar itself (pinned in the
	 * clear-all test below).
	 */
	assert.match(control, /aria-disabled=\{row\.pending\}/);
	assert.ok(
		!/^\t+disabled=\{row\.pending\}/m.test(control),
		"a real disabled attribute is what dropped the control out of the ring",
	);
	assert.match(control, /if \(row\.pending\) \{/);
	assert.match(control, /event\.preventDefault\(\);/);
	/*
	 * THE WHY, IN BOTH CHANNELS: the `title` for the pointer and an `sr-only`
	 * element the control points at (`aria-describedby`), so a keyboard or AT
	 * reader is told why the act refuses.
	 */
	assert.match(control, /aria-describedby=/);
	assert.match(control, /draftWhyId\(row\.key\)/);
	assert.match(control, /SENDING_DISCARD_WHY/);
	/* Colour, never opacity (design round 2's D5; branding.md §6). */
	assert.match(control, /aria-disabled:text-ink-disabled!/);
	assert.match(control, /aria-disabled:hover:text-ink-disabled!/);
	assert.ok(
		!/disabled:opacity-45/.test(control),
		"opacity-faded disabled states are the pattern branding.md §6 forbids",
	);
	/* And the fresh key the discard stages is written to the store for the offer's own press (U7). */
	assert.match(control, /setStagedByDiscard\(/);
});

test("the discard offer is its own toast: one id, one slot, an Undo that restores", () => {
	const source = code(TOASTS);
	const at = source.indexOf("if (draftsUndo === null) {");
	assert.notEqual(at, -1, "the drafts branch is not in the toast surface");
	const branch = source.slice(at, at + 2600).replace(/\s+/g, " ");
	/*
	 * AN ID OF ITS OWN (2026-09-27) - a decision this change makes rather than inherits:
	 * the discard offer used to share the archive's id because one sidebar lane held one
	 * message, and ordinary sonner toasts stack. So a discard and an archive can stand
	 * side by side, each retiring on its own terms, and the store's single slot still
	 * means a second discard REPLACES the first under this same id rather than stacking
	 * under it.
	 */
	assert.match(branch, /id: DRAFTS_UNDO_TOAST_ID/);
	assert.equal(
		branch.includes("ARCHIVE_TOAST_ID"),
		false,
		"the discard offer must not share the archive's id: nothing about this act is an archive",
	);
	assert.match(branch, /label: "Undo"/);
	assert.match(branch, /restoreDraftsUndo\(\);/);
	/*
	 * LIFETIME, CHROME AND SHRINKING ARE SONNER'S (2026-09-27): the offer's own
	 * documented eight seconds (`ARCHIVE_UNDO_TOAST_MS`, one home for both offers),
	 * no persistent duration for a clock to outlive, no `position`, and the same
	 * `min-w-0` chain as the archive offer so the copy can give at the card's width.
	 */
	assert.match(branch, /duration: ARCHIVE_UNDO_TOAST_MS/);
	assert.equal(branch.includes("POSITIVE_INFINITY"), false);
	assert.equal(branch.includes("position:"), false);
	assert.match(branch, /classNames: \{ content: "min-w-0" \}/);
	/*
	 * AND THE PRESS PUTS THE READER BACK WHERE THEY WERE WORKING (UX round 2's U7):
	 * a ONE-key offer whose key the discard replaced with a freshly staged draft
	 * re-opens the restored key, and only while the pane still shows that staged
	 * draft (the CURRENT key is what it is compared against). The staged key is the
	 * store's `stagedByDiscard` - set by the panel's two discard handlers, read here -
	 * because the press moved one surface over with this change.
	 */
	assert.match(branch, /stagedByDiscard/);
	assert.match(branch, /getState\(\)\.activeDraftKey === staged/);
	assert.match(branch, /\.openDraft\(draftsUndo\.keys\[0\]\)/);
	/*
	 * AND THE OFFER'S SLOT IS CLEARED AT ITS OWN END, so nothing re-draws later: the
	 * timed end, the close button and the swipe all route through the same settle
	 * callbacks, and the Undo press clears it in the store write that restores.
	 */
	assert.match(branch, /setDraftsUndo\(null\)/);
	assert.match(branch, /onAutoClose: settle/);
	assert.match(branch, /onDismiss: settle/);
});

test("the walk and the ring both skip what the caret cannot reach", () => {
	const source = code(SIDEBAR);
	/*
	 * AGENT REVIEW ROUND 2'S R7: `focus()` on a `disabled` control is a no-op, so a
	 * walk step onto it dead-stopped and `applyRowStop` recorded a stop nobody could
	 * see. The app measured the same lesson once already (`integration-focus.ts`:
	 * "focus() did nothing"), and the predicate is the whole of the rule. Both the
	 * arrow walk's collection and the ring's must exclude unreachable rows, so a
	 * future `disabled` row can never reintroduce the dead stop.
	 */
	const filters = source.match(
		/\(row as \{ disabled\?: boolean \}\)\.disabled/g,
	);
	assert.equal(
		filters?.length,
		2,
		"the arrow walk and applyRowStop must both exclude unreachable rows",
	);
	assert.match(
		source,
		/row\.tabIndex = rows\.includes\(row\) && row === target \? 0 : -1;/,
		"an excluded row must not keep tabIndex 0 either",
	);
});
