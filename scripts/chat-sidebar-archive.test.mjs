import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * The archive and delete SURFACES, read off the shipped JSX.
 *
 * Why this file exists. The sidebar, the header and the delete dialog cannot be
 * rendered in this suite - they read the router, the canonical-sessions store,
 * the desktop capability hooks and every picker - so the decisions they make are
 * in modules (`chat-archived`, `chat-archive-press`, `archive-undo`,
 * `delete-conversation`, and the store itself), and those are asserted by RUNNING
 * them in `chat-archived.test.mjs`, `chat-archive-press.test.mjs` and
 * `session-archive-delete.test.mjs`. What is left, and what this file is for, is
 * the half no module can hold: that the shipped components actually call those
 * decisions, in the shape the design depends on.
 *
 * Each assertion is an ANCHOR read, not a spelling: the slice is located by the
 * hook the design names (`data-session-archive`, the `Include archived` label, the
 * `shape="pill"` badge) and the property asserted inside it is the one that cannot
 * be seen any other way - a control being a SIBLING of the row rather than a child
 * of it, a reveal that moves opacity and nothing else, a menu item that stages a
 * dialog instead of deleting. A rename inside those slices keeps this file red,
 * which is the point: the alternative is a green suite over a panel that lost its
 * affordance.
 *
 * What it is NOT: evidence that any of it renders. That is the frames under
 * `docs/evidence/session-archive/`, driven through the real app.
 */

const read = (path) => readFileSync(path, "utf8");
/** Comments stripped, so a rule can never be satisfied by prose about the rule. */
const code = (path) =>
	read(path)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/.*$/gm, "$1");

const SIDEBAR = "src/renderer/src/features/chat/components/chat-sidebar.tsx";
/**
 * The surface the archive and discard messages are raised by since 2026-09-27: the
 * always-mounted component beside the global container (`main.tsx`), which replaced
 * the panel's own toast lane (operator request; `docs/design/sidebar-row-space.md`
 * §10's supersession entry).
 */
const TOASTS = "src/renderer/src/features/chat/components/undo-toasts.tsx";
const HEADER = "src/renderer/src/features/chat/components/chat-header.tsx";
const CONTENT = "src/renderer/src/features/chat/components/chat-content.tsx";
const DIALOG =
	"src/renderer/src/features/chat/components/delete-conversation-dialog.tsx";
/**
 * The ARCHIVE confirmation and the module behind it (2026-09-30): one dialog for five
 * doors, and the copy + the successor-focus rule it shares with nothing else.
 */
const ARCHIVE_DIALOG =
	"src/renderer/src/features/chat/components/archive-conversation-dialog.tsx";
const ARCHIVE_CONFIRM = "src/renderer/src/features/chat/archive-confirm.ts";
const PALETTE = "src/renderer/src/features/chat/components/slash-commands.tsx";
const DISPATCH = "src/renderer/src/features/chat/components/slash-dispatch.ts";
const REGISTRY = "src/renderer/src/features/chat/pickers/picker-registry.tsx";

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
	/*
	 * A MISSING END MARKER IS AN ERROR, NOT "TO THE END OF THE FILE" (repaired 2026-09-22).
	 * This used to fall through to `source.slice(at)` when `end` was not found, and that turned
	 * a markup assertion into a claim about the whole file the moment a marker moved: the
	 * refusal test's end marker was the lane effect's dependency array, the U10 fix grew that
	 * array by two entries, and the slice silently became 1428 lines - so the `role="alert"`
	 * check went on passing while reading the CATALOGUE alert's own markup further down rather
	 * than the lane's, which is the opposite of what it asserts. The caller is told which marker
	 * moved instead.
	 */
	assert.notEqual(
		stop,
		-1,
		`${path} no longer contains ${JSON.stringify(end)} after ${JSON.stringify(start)} - the slice would have run to the end of the file`,
	);
	return source.slice(at, stop);
};

/* ------------------------------------------------------------- the sidebar */

test("the archive control is a SIBLING of the row's button, never a child", () => {
	const rows = between(SIDEBAR, "const sessionRow = (", "const entity = (");
	/*
	 * The row's own button closes before the control opens, and the control is
	 * inside the same wrapper. A nested button is invalid HTML, unfocusable, and a
	 * press inside it fires the row's own `onClick` as well - opening the very
	 * conversation the user was trying to archive.
	 */
	const rowButtonEnd = rows.indexOf("</button>");
	/*
	 * ANCHORED ON THE CONTROL'S ACCESSIBLE NAME, not on its `data-session-archive`
	 * attribute - and the reason is a trap this file hit: `data-session-archive` is
	 * a PREFIX of `data-session-archived`, the row button's own archived flag, so a
	 * substring search for the control's attribute finds the button's first (at
	 * line ~1094) and every assertion below then describes the row's box instead of
	 * the control's.
	 */
	const control = rows.indexOf(
		"aria-label={archiveControlLabel(label, archived)}",
	);
	assert.notEqual(rowButtonEnd, -1, "the row's button no longer closes");
	assert.notEqual(control, -1, "the row no longer mounts an archive control");
	assert.ok(
		control > rowButtonEnd,
		"the archive control must come AFTER the row button closes, as a sibling",
	);
	/*
	 * And it deliberately does NOT carry `data-chat-row`: the arrow-key traversal
	 * collects that attribute's elements and focuses them, so a control wearing it
	 * would join the ring the panel's rows share - the rule the entity row's own two
	 * controls are written under.
	 */
	const element = rows.slice(control, rows.indexOf("</button>", control));
	assert.equal(
		element.includes("data-chat-row"),
		false,
		"the archive control must not join the arrow-key ring",
	);
});

test("the archive control is absent from the layout at rest, and named by its action", () => {
	const control = between(
		SIDEBAR,
		"aria-label={archiveControlLabel(label, archived)}",
		"</button>",
	);
	/*
	 * AT REST THE CONTROL IS NOT IN THE LAYOUT AT ALL (design D3). The reveal used to
	 * be `opacity: 0` plus `pointer-events-none` on a box that was always there, which
	 * cost the title 28px on every row whether or not the pointer was anywhere near it;
	 * the base is now `hidden` and the two reveal states ADD `flex`.
	 *
	 * THE POINTER HALF IS THE ROW'S DWELL, NOT A BARE HOVER (issue #840): the attribute
	 * `chat-row-hover-intent.tsx` writes after the app's hover-intent constant replaces
	 * `group-hover` on all four per-row controls, so a press on its way to selecting a
	 * row never meets a control that has just arrived. `group-focus-within` is
	 * untouched and stays immediate, because the keyboard path has no such hazard.
	 *
	 * THE BASE MUST BE `hidden` AND NOT `flex`, and that is the cascade bug this file
	 * already caught once (agent review round 2, N1): `hidden` and `flex` are two
	 * display utilities of equal specificity, so a class list carrying both is decided
	 * by the stylesheet's order rather than by the pointer. The variant only ever
	 * RAISES the control into the layout, which is why it cannot lose here.
	 */
	assert.match(
		control,
		/"hidden size-6 shrink-0 items-center justify-center rounded-md"/,
	);
	assert.match(control, /group-data-\[session-hover-intent\]:flex/);
	assert.match(control, /group-focus-within:flex/);
	/*
	 * AND THE OLD REVEAL IS GONE, both halves of it: `opacity` and `pointer-events` come
	 * off, and so do the transition-duration tokens that paired with them - `display` is
	 * not one of the four properties `docs/branding.md` § 5 lets animate. `display: none`
	 * is strictly stronger than the pairing on the property it was written for: an
	 * element that is not displayed cannot receive a press at all.
	 */
	assert.equal(control.includes("opacity-0"), false);
	assert.equal(control.includes("pointer-events-none"), false);
	assert.equal(control.includes("transition-opacity"), false);
	// Only colour moves on the reveal: nothing lifts, scales or translates on hover.
	assert.equal(/group-hover:[a-z-]*(scale|translate)/.test(control), false);
	assert.match(control, /group-data-\[session-hover-intent\]:text-ink-muted/);
	/*
	 * REACHABLE BY KEYBOARD, which is why `group-focus-within` is here: Tab reaches the
	 * row's button (the row's only tab stop at rest), which puts focus inside the row,
	 * which displays the cluster - and the next Tab reaches the pin and then the
	 * archive. The controls are outside the accessibility tree while hidden, which is
	 * the honest state: on an unpinned row there is no pin control to announce.
	 */
	assert.match(control, /group-focus-within:text-ink-muted/);
	// The action, never the state, and the conversation named - one derivation for the
	// accessible name and the tooltip, so they cannot disagree.
	assert.match(
		control,
		/aria-label=\{archiveControlLabel\(label, archived\)\}/,
	);
	assert.match(control, /title=\{archiveControlLabel\(label, archived\)\}/);
	// The ground it answers the pointer with is the ROW STATE, not a ground role.
	assert.match(control, /!current && "hover:bg-row-hover"/);
});

test("the fail-closed gate covers the slot, the marker and the wrapper's group hook", () => {
	const source = code(SIDEBAR);
	/*
	 * Byte-identity is a claim about the DOM, so it has to hold in three places at
	 * once: no reserved 24px slot, no marker, and no `group` on the wrapper (the
	 * hook the reveal hangs off). With the capability absent the panel is the panel
	 * that never knew about archiving.
	 */
	assert.match(source, /(pinsEnabled || archiveEnabled) && "group"/);
	assert.match(source, /archiveEnabled && archived && \(/);
	assert.match(source, /archiveEnabled && \(\s*<button/);
	assert.match(source, /archiveEnabled && query\.trim\(\) && \(/);
});

test("the archived row carries a marker that is not in the contested trailing slot", () => {
	const rows = between(SIDEBAR, "const sessionRow = (", "const entity = (");
	const marker = rows.slice(
		rows.indexOf("archiveEnabled && archived && ("),
		rows.indexOf("</span>", rows.indexOf("archiveEnabled && archived && (")),
	);
	assert.match(marker, /<Archive/);
	assert.match(marker, /text-ink-dim/);
	assert.match(marker, /aria-hidden="true"/);
	// The word reaches a screen reader through the `sr-only` span, and the tooltip
	// states the same fact - the two channels agree because there is one string.
	assert.match(marker, /sr-only/);
	assert.match(rows, /\{archived \? ", archived" : ""\}/);
	/*
	 * AND IT SITS BEFORE THE TITLE, not in the trailing slot. That slot admits
	 * exactly one statement (`rowTrailingStatement` records the three layouts that
	 * failed when it admitted more), so a marker competing for it would displace
	 * "· in conversation" - the reason a row with nothing visibly in common with the
	 * query is on screen - or be dropped from the row that most needs both.
	 */
	const markerAt = rows.indexOf("<Archive");
	const titleAt = rows.lastIndexOf('{row.title || "Untitled chat"}');
	assert.ok(
		markerAt !== -1 && titleAt !== -1 && markerAt < titleAt,
		"the marker must precede the title's span, outside the trailing slot's rule",
	);
});

test("the Include archived control is inside the search block and only while a query exists", () => {
	const block = between(
		SIDEBAR,
		'aria-label="Search chats and agents"',
		"overLong &&",
	);
	/*
	 * The control's own render rule mirrors the clear control's: with an empty box
	 * there is nothing to scope a widened search to, so it is a switch for a search
	 * that is not happening - and the panel stays free of new chrome at rest, which
	 * is the constraint that rules out an `Archived chats` section.
	 */
	assert.match(block, /archiveEnabled && query\.trim\(\) && \(/);
	assert.match(block, /<Checkbox/);
	assert.match(block, /id=\{INCLUDE_ARCHIVED_ID\}/);
	assert.match(block, /htmlFor=\{INCLUDE_ARCHIVED_ID\}/);
	assert.match(block, /Include archived/);
	// The id is a constant used twice rather than two inline strings: a label whose
	// `for` names no input is an accessible name that silently disappears.
	assert.match(
		code(SIDEBAR),
		/const INCLUDE_ARCHIVED_ID = "chat-search-include-archived"/,
	);
	/*
	 * And it is REMEMBERED but IN FORCE ONLY WHILE A QUERY IS (UX round 1, U8):
	 * clearing the box used to disarm it, so a user who cleared and retyped lost the
	 * archived result they had just found; a remembered box that widened the at-rest
	 * lists instead would put archived conversations back into every default list.
	 * The rule has one home - `archivedSearchWidened` in `chat-archived`, asserted
	 * there - and the sidebar's half is that it consults that rule rather than
	 * clearing its own state.
	 */
	assert.match(
		code(SIDEBAR),
		/const widened = archivedSearchWidened\(includeArchived, query, archiveEnabled\)/,
	);
	assert.doesNotMatch(
		code(SIDEBAR),
		/setIncludeArchived\(false\)/,
		"the widening must not be cleared with the box any more",
	);
});

test("the list the panel draws is the page minus the archived rows, and the search is told", () => {
	const source = code(SIDEBAR);
	/*
	 * ONE filter, before anything reads the list: the flat list, both sections, the
	 * agent and team groups and the local half of the search all read this array.
	 *
	 * AND IT IS FED THE ANSWERED VIEW (design round 8, D27): `visibleRows` reads a row's own
	 * `archived` flag, so the array it is handed is the one whose flags are the DAEMON's - a
	 * fact still in flight must not be able to take a row out of a list, because the list's
	 * own extent is what the reader's scroll position is measured against.
	 */
	assert.match(
		source,
		/visibleRows\(answeredForMembership, archiveEnabled && !widened\)/,
	);
	assert.match(source, /answeredArchiveRows\(sessions, archiveFacts\)/);
	// The request itself carries the widening, and the join is given the client's own
	// facts plus the delete tombstones, so a press on a row rebuilt from a cached hit
	// can be inverted and a deleted conversation cannot be drawn from one.
	assert.match(
		source,
		/useChatSearch\(query, ready && searchSupported, widened\)/,
	);
	assert.match(source, /forgotten: new Set\(Object\.keys\(forgottenFacts\)\)/);
	/*
	 * `bindingOfHit` is the sixth argument and `teamLabelFor` the seventh: the
	 * label resolver is the same one the row slots render with (round 1,
	 * R1-3c), so a conversation drawn under a team's label is found by that
	 * label's words. The pin is widened rather than loosened - the arguments it
	 * already named are still named in order, so a call that dropped one still
	 * fails here.
	 */
	assert.match(
		source,
		/searchChats\(\s*\[\.\.\.listed, \.\.\.heldRows\],\s*query,\s*hits,\s*pinFactValues,\s*archiveView,\s*bindingOfHit,\s*teamLabelFor,?\s*\)/,
	);
	assert.match(
		source,
		/searchChats\(\s*\[\.\.\.listed, \.\.\.heldRows\],\s*search\.data\.query,\s*search\.data\.sessions,\s*pinFactValues,\s*archiveView,\s*bindingOfHit,\s*teamLabelFor,?\s*\)/,
	);
});

test("a refused press is reported once, as an ordinary sonner toast, with a retry", () => {
	/*
	 * THE REGISTER + LANE THAT HELD THIS ARE DELETED (operator request, 2026-09-27,
	 * verbatim: "instead of having a separate sidebar notification, we should probably
	 * just use the normal sonner toast. These don't properly show up and look janky").
	 * The refusal is an ordinary toast raised by `undo-toasts.tsx` - mounted beside the
	 * global container by `main.tsx`, so it is drawn while the sidebar column is
	 * collapsed and when the chat pane's own header menu or a typed `/archive` is the
	 * surface that pressed - and the panel no longer draws it at all.
	 *
	 * The slice is the archive effect's drawing decision, so what is asserted here is
	 * the shape the design depends on and no module can hold: the refusal names the
	 * conversation, carries the backend's own sentence when there is one, keeps the
	 * archive family's shared id (so an answer REPLACES the message it answers rather
	 * than stacking under it), and offers the retry that re-sends the SAME desired
	 * state.
	 */
	const failure = between(
		TOASTS,
		"if (archiveFailure === null && archiveUndo === null) {",
		"\t\tsetArchiveUndo,\n\t\tclearArchiveFailure,\n\t\tsetSessionArchived,\n\t]);",
	);
	assert.match(failure, /archiveFailure\.title/);
	assert.match(failure, /archiveFailure\.detail/);
	// The retry sends the DESIRED state that was refused, not the state on screen.
	assert.match(
		failure,
		/setSessionArchived\(\s*archiveFailure\.sessionId,\s*archiveFailure\.archived,/,
	);
	// `warning`, not `danger`: the list is intact and only this row's archive state
	// did not move.
	assert.match(failure, /showWarningToast\(/);
	assert.match(failure, /id: ARCHIVE_TOAST_ID/);
	assert.equal(
		failure.includes('role="alert"'),
		false,
		"the sentence must not compete with the catalogue alert about a different failure",
	);
	/*
	 * ONE ID FOR BOTH MESSAGES, AND THE NEWEST OF THE TWO IS THE ONE DRAWN (agent review
	 * round 3, R3-1 = UX round 3, U7). The branch used to prefer the failure
	 * unconditionally, so after ONE refused archive every later successful archive's
	 * offer was never painted. Currency is the write stamp's (`at`), and a tie keeps the
	 * refusal - a refusal is a fact about a press that was ANSWERED.
	 */
	assert.match(failure, /archiveUndo\.at > archiveFailure\.at/);
	/*
	 * AND THE ONE DISMISSAL IS BOTH SLOTS GOING EMPTY (agent review round 1, R-1;
	 * round 2, R2-1/R2-4). What retires a message is the surface's own record of what it
	 * DREW, never the store's other fact - `archiveFailure` outlives its message, and
	 * gating the offer's retirement on it let one refused archive disable retirement for
	 * the rest of a session. NOTHING IS DISMISSED ON MOUNT, which is why the empty
	 * branch opens on the ref rather than going straight to `dismissToast` (sonner's
	 * `dismiss` reaches a bare `requestAnimationFrame`; a dismiss on a mount that never
	 * showed this toast is a call with no toast behind it).
	 */
	assert.match(failure, /if \(archiveDrawnRef\.current === null\) return;/);
	assert.equal(
		failure.split("dismissToast(").length - 1,
		1,
		"the pressed paths must not dismiss: the message is held while its own write is out, and the answer settles it",
	);
	assert.match(failure, /dismissToast\(ARCHIVE_TOAST_ID\);/);
	// A superseded message's VALUE is cleared as the newer one is drawn, so it cannot
	// re-print when the newer one retires (U10; the refusal-after-offer half too).
	assert.match(failure, /setArchiveUndo\(null\)/);
	assert.match(failure, /clearArchiveFailure\(\)/);
	/*
	 * LIFETIMES ARE SONNER'S, NOT A PANEL CLOCK (2026-09-27). The draws carry the
	 * documented durations - the refusal's ten seconds, the offer's eight - and the
	 * entry's life pauses while the reader holds it, which the `Infinity` + clock pair
	 * could not do. The value is cleared when its MESSAGE ends, so nothing re-draws
	 * later: both ending routes (timed end, the close button/swipe) call `settle`.
	 */
	assert.match(failure, /duration: ARCHIVE_FAILURE_TOAST_MS/);
	assert.match(failure, /duration: ARCHIVE_UNDO_TOAST_MS/);
	assert.doesNotMatch(
		code(TOASTS),
		/Number\.POSITIVE_INFINITY|ARCHIVE_TOAST_PERSISTENT/,
		"no message may be drawn without a life sonner can end on its own",
	);
	assert.match(failure, /onAutoClose: settle\("failure", archiveFailure\.at\)/);
	assert.match(failure, /onDismiss: settle\("failure", archiveFailure\.at\)/);
	/*
	 * AND NOTHING DISMISSES A MESSAGE IT IS ABOUT TO REPLACE (UX round 1, U3; agent
	 * review round 2, R2-1). A `dismissToast(id)` at a press would take the message
	 * down before its answer, and the answer's create lands on the id just dismissed -
	 * merged into the dying entry and destroyed inside sonner's own unmount window.
	 * Both actions therefore only send their write; the replacement is sonner's update.
	 */
	for (const label of ['label: "Retry"', 'label: "Undo"']) {
		const at = failure.indexOf(label);
		assert.notEqual(at, -1, `${label} is not in the archive effect`);
		const press = failure.slice(at, failure.indexOf("setSessionArchived", at));
		assert.equal(
			press.includes("dismissToast"),
			false,
			`the press at ${label} must not take its own message down`,
		);
	}
	assert.equal(
		(failure.match(/event\.preventDefault\(\);/g) ?? []).length,
		2,
		"both presses hold their message with preventDefault while the write is unanswered",
	);
	/*
	 * AND THE PANEL DRAWS NONE OF IT ANY MORE: the drawing, the clamp, the clock and
	 * the lane constants are gone from `chat-sidebar.tsx`, and a raiser there would be a
	 * second, unmountable copy of the failure class this change removes.
	 */
	assert.equal(code(SIDEBAR).includes("showInfoToast("), false);
	assert.equal(code(SIDEBAR).includes("ARCHIVE_TOAST_ID"), false);
});

test("the offer's card truncates its NAME and can never truncate the verb (agent review round 2, R2-3)", () => {
	/*
	 * The slice is the offer's DRAW, from its branch to the archive effect's dependency
	 * array (the branch sits after the failure arm, so the slice is the offer's own
	 * message and nothing else).
	 */
	const offer = between(
		TOASTS,
		"if (archiveUndo) {",
		"\t\tsetArchiveUndo,\n\t\tclearArchiveFailure,\n\t\tsetSessionArchived,\n\t]);",
	);
	// The name and the verb are two elements: a single string that overflows loses its
	// TAIL, and the tail of `“<title>” archived.` is the verb.
	assert.match(offer, /archiveOfferedName\(archiveUndo\.title\)/);
	assert.match(offer, /ARCHIVE_OFFERED_VERB/);
	assert.match(offer, /className=\{cn\("min-w-0 truncate"\)\}/);
	assert.equal(
		offer.includes("archiveOfferedText"),
		false,
		"the sentence must not be one string, or a long title cuts the word that says what happened",
	);
	/*
	 * AND THE FLEX CHAIN CAN SHRINK TO THE CARD WITHOUT THE LANE'S STYLESHEET: the rule
	 * the lane carried (`min-width: 0` on sonner's `[data-content]`, measured there when
	 * a long name refused to give and pushed the Undo out of the card) is passed as the
	 * content box's own class now, because the app's stylesheet no longer names these
	 * messages at all.
	 */
	assert.match(offer, /classNames: \{ content: "min-w-0" \}/);
});

test("the sidebar's own lane is deleted; the messages are raised by an always-mounted surface (operator request, 2026-09-27)", () => {
	const sidebar = code(SIDEBAR);
	/*
	 * THE FAILURE CLASS THIS REMOVES, in the operator's own words ("these don't
	 * properly show up"): the raise used to live in the panel, and the panel is the
	 * EXPANDED half of the sidebar column - `sidebar-navigation.tsx` returns the 56px
	 * strip, without it, when the column is collapsed - while the acts that raise the
	 * messages are reachable from the chat pane (the header's menu, `/archive`) and the
	 * composer (the send-failure notice's Clear). The drawing now lives on a surface
	 * `main.tsx` mounts for the app's whole life.
	 */
	assert.equal(
		(sidebar.match(/<ThemedToastContainer/g) ?? []).length,
		0,
		"the panel must mount no toast container of its own",
	);
	for (const gone of [
		"ARCHIVE_TOAST_LANE",
		"ARCHIVE_TOAST_CLASS",
		"ARCHIVE_TOAST_BAND",
		"ARCHIVE_OFFER_BAND_HEIGHT",
		"ARCHIVE_TOAST_CONTAINER_STYLE",
		"data-archive-toast-band",
		"laneBandRef",
		"laneMessageRef",
		"laneDrawnRef",
		"listYield",
		"stagedByDiscardRef",
	]) {
		assert.equal(
			sidebar.includes(gone),
			false,
			`${gone} must be deleted with the lane it served`,
		);
	}
	// The app's stylesheet no longer carries a confinement policy keyed on the lane's class.
	const css = code("src/renderer/src/styles/index.css");
	assert.equal(css.includes("lo-archive-toast"), false);
	assert.equal(css.includes("archive-toast"), false);
	/*
	 * THE RAISE LIVES WHERE THE APP LIVES: `main.tsx` mounts the one container every
	 * toast in the app uses, and the raising surface beside it - one of each, outside
	 * every route.
	 */
	const main = code("src/renderer/src/main.tsx");
	assert.equal((main.match(/<ThemedToastContainer \/>/g) ?? []).length, 1);
	assert.equal((main.match(/<UndoToasts \/>/g) ?? []).length, 1);
	/*
	 * THE IDS: one stable id for the archive's offer and refusal, and a SEPARATE id for
	 * the discard offer - a decision this change makes rather than inherits, because the
	 * single id existed to fit one lane and ordinary toasts stack. Each id is defined
	 * once and used by its raise and its dismissal.
	 */
	const toasts = code(TOASTS);
	assert.match(toasts, /export const ARCHIVE_TOAST_ID = "archive";/);
	assert.match(toasts, /export const DRAFTS_UNDO_TOAST_ID = "drafts-undo";/);
	assert.equal(
		(toasts.match(/DRAFTS_UNDO_TOAST_ID/g) ?? []).length,
		3,
		"the drafts id is defined once and used by its raise and its dismissal",
	);
	/*
	 * AND THE PANEL'S OTHER ROOT FACTS SURVIVE (the halves of this test that were about
	 * the register's home): one merged assembly draws the pin's failure line once, and
	 * the register itself stays deleted.
	 */
	const pins = sidebar.match(/\{pinFailureLine\}/g) ?? [];
	assert.equal(
		pins.length,
		1,
		`expected the pin's failure line once in the merged assembly, found ${pins.length}`,
	);
	assert.equal((sidebar.match(/\{archiveRegister\}/g) ?? []).length, 0);
	assert.equal(sidebar.includes("const archiveRegister = ("), false);
	assert.match(sidebar, /<TooltipProvider>/);
});

test("the press record expires on the pointer's own path", () => {
	/*
	 * THE SLICE IS THE CHATS LIST PANEL'S OWN HANDLERS, and its start marker moved 2026-09-26: the
	 * list panel no longer carries `ref={listPanelRef}` (the merged scroller takes the twin ref) and
	 * its end marker is the new flow class the one-scroll pass gave it, `className={cn("relative
	 * space-y-4")}` - the same `className={cn(` marker the sessionRow slice below uses. Before
	 * `between` was hardened, this slice ran to the end of the file, so every pattern it asserts
	 * could have been satisfied by the ENTITY region's nested rows rather than by this panel, which
	 * is exactly what its own comment says the records are region-scoped about.
	 */
	const panel = between(
		SIDEBAR,
		'key="chats"',
		'className={cn("relative space-y-4")}',
	);
	assert.match(panel, /onPointerMove=/);
	assert.match(panel, /archivePressExpired\(lastArchivePress\.current/);
	assert.match(panel, /onPointerLeave=/);
	assert.match(panel, /lastArchivePress\.current = null/);
});

/* ------------------------------------------------------- the chat header */

test("the archived state is a pill badge with its own restore control beside it", () => {
	/*
	 * AND IT ENDS WHERE THE MENU'S MARKUP BEGINS, matched as CODE (re-spelled 2026-09-22). The
	 * marker was `{/*\n\t\t\t\t * THE CONVERSATION'S OWN MENU`, which a sliced source can never
	 * match: `code()` STRIPS comments on purpose, "so a rule can never be satisfied by prose
	 * about the rule". It never matched, `between` fell through to the end of the file, and the
	 * array's assertions were being asked of the whole header. `<DropdownMenu>` is the next
	 * element after the pill block and is the boundary this slice wants.
	 */
	const pill = between(
		HEADER,
		"archiveEnabled && archived && (",
		"<DropdownMenu>",
	);
	const source = code(HEADER);
	const at = source.indexOf("data-session-archived-pill");
	assert.notEqual(
		at,
		-1,
		"the header no longer marks an archived conversation",
	);
	const slice = source.slice(Math.max(0, at - 400), at + 400);
	/*
	 * The state is a BADGE - `shape="pill"`, which is one of the three sanctioned
	 * uses of `rounded-full` - because `badge.tsx` states that a badge is not a
	 * control, and the action is a separate ghost icon button whose accessible name
	 * is the ACTION. One pill-shaped button would need `rounded-full` on a `Button`,
	 * which the radius ramp reserves.
	 */
	assert.match(slice, /shape="pill"/);
	assert.match(slice, /Archived/);
	assert.match(pill, /<Badge/);
	assert.match(pill, /aria-label=\{archiveControlLabel\(agentName, true\)\}/);
	assert.match(pill, /onSetArchived\(false\)/);
});

test("the header's menu is the session's actions, and its delete only ASKS", () => {
	/*
	 * THE SLICE STARTS AT THE TRIGGER rather than at the condition that gates it.
	 * It used to read `between(HEADER, "(archiveEnabled || deleteEnabled) && (", …)`,
	 * and the condition is now a multi-line expression (the menu also carries the
	 * right-slot actions, so five hosts can open it), which no single-line anchor
	 * matches. Starting at the trigger is also the tighter read: the thing this test
	 * is about is the menu, and an anchor on the trigger cannot be satisfied by
	 * prose about the gate.
	 */
	const menu = between(
		HEADER,
		"<DropdownMenuTrigger asChild>",
		"<RunDetailsTrigger",
	);
	// Fail-closed and whole: with neither capability there is no trigger at all,
	// rather than a menu advertising items that do nothing.
	assert.match(menu, /<DropdownMenuTrigger/);
	// Archive and unarchive are one item whose label follows the state.
	assert.match(menu, /Archive conversation/);
	assert.match(menu, /Restore conversation/);
	assert.match(menu, /onSetArchived\?\.\(!archived\)/);
	/*
	 * Delete is painted in the danger ink and does NOT delete: it asks the pane to
	 * stage a candidate, because the wire requires a confirmation and a menu pick is
	 * not one.
	 */
	assert.match(menu, /Delete conversation…/);
	assert.match(menu, /className="text-danger"/);
	assert.match(menu, /onRequestDelete\?\.\(\)/);
	assert.equal(
		menu.includes("deleteSession"),
		false,
		"the menu must not reach the delete op: the dialog is the only caller",
	);
});

/* ----------------------------------------------------------- the dialog */

test("the dialog is the app's one delete confirmation, and it stays open to refuse", () => {
	const source = code(DIALOG);
	assert.match(source, /<ConfirmationModal/);
	assert.match(source, /open=\{candidate !== null\}/);
	assert.match(source, /isDangerous/);
	assert.match(
		source,
		/deleteConversationMessage\(candidateTitle, hasSubagentRuns\)/,
	);
	assert.match(source, /await deleteSession\(candidate\)/);
	// A refusal keeps the dialog up with its own sentence, in the danger ink, and
	// the sentence belongs to the candidate it was about.
	assert.match(
		source,
		/setRefusal\(\{\s*candidate,\s*detail: outcome\.detail,\s*guarded: outcome\.guarded,?\s*\}\)/,
	);
	assert.match(source, /refusal\.candidate === candidate/);
	assert.match(source, /text-danger/);
	/*
	 * A refusal is not the end of the interaction, and the two things that follow
	 * from it are asserted here rather than trusted to the reader (UX round 1, U3
	 * and U9): the keyboard goes back to CANCEL - the press left it on the
	 * destructive button, so the next Enter would repeat the refused act - and the
	 * LIVE refusal states the remedy this window actually has, because the route's
	 * own sentence sends the reader to a Stop control the pane does not carry.
	 */
	assert.match(source, /focusCancelSignal=\{refusalSeq\}/);
	assert.match(source, /setRefusalSeq\(\(seq\) => seq \+ 1\)/);
	assert.match(source, /shownRefusal\?\.guarded && \(/);
	assert.match(source, /DELETE_GUARD_REMEDY/);
	// And closing the dialog hands the keyboard back to whatever opened it (the
	// header's trigger when the menu that hosted the item is gone).
	assert.match(source, /data-conversation-actions/);
	assert.match(source, /element\.isConnected/);
	// It reads the store rather than taking a candidate as a prop, which is what
	// makes one dialog serve both callers (the header's menu and typed `/delete`).
	assert.match(source, /state\.deleteCandidate/);
	assert.match(source, /state\.requestSessionDelete/);
});

test("the pane renders the dialog, and only where a delete route exists", () => {
	const source = code(CONTENT);
	assert.match(source, /deleteEnabled && \(/);
	assert.match(source, /<DeleteConversationDialog/);
	// The children clause is a FACT about this conversation, read from the run
	// details the pane already holds.
	assert.match(
		source,
		/hasSubagentRuns=\{\(runDetails\?\.lineage\.length \?\? 0\) > 0\}/,
	);
	// And the header's actions are wired only where there is a session to act on: a
	// draft has no conversation to archive and no route to delete with.
	assert.match(source, /archiveEnabled=\{archiveEnabled\}/);
	assert.match(source, /archived=\{archived\}/);
	assert.match(source, /onRequestDelete=\{/);
});

/* ---------------------------------------------------------- slash commands */

test("the palette withholds the archive row that does not apply, and keys it on the state", () => {
	const source = code(PALETTE);
	assert.match(source, /archiveDestinationApplies\(/);
	assert.match(source, /command\.destination/);
	assert.match(source, /openArchived/);
	// The state is read from the store (the pane's own conversation), and the
	// capability from the same negotiation the rest of the composer uses.
	assert.match(source, /state\.archiveFacts\[sessionId\]\?\.archived/);
	assert.match(
		source,
		/desktopFeatureEnabled\(\s*capabilities\.data,\s*"session_archive",\s*\)/,
	);
	// The dangerous one is painted in the danger ink through the ONE word rule.
	assert.match(source, /slashDestructive\(command\.name, undefined\)/);
	assert.match(source, /text-danger/);
});

test("a typed /delete stages the dialog and can never reach the wire itself", () => {
	/*
	 * THE BRANCH ENDS WHERE THE NEXT COMMAND'S HANDLING BEGINS (`/exit`), matched as CODE
	 * (re-spelled 2026-09-22): the marker used to be `if (entry.action === "clear")` and the
	 * dispatch has no `clear` action any more, so the slice ran to the end of the file and the
	 * "must not reach the wire" assertions below were being asked of EVERY command's branch - a
	 * `sessions.delete` in any later branch would have satisfied them. A comment cannot serve as
	 * the marker either: `code()` strips them, which is this file's own rule.
	 */
	const branch = between(
		DISPATCH,
		'entry.action === "request-delete"',
		"if (window.api?.desktop?.closeWindow) {",
	);
	assert.match(branch, /requestSessionDelete\(sessionId\)/);
	/*
	 * The one thing it must not do. `sessions.delete` requires `confirmed: true`,
	 * and only the dialog sends it - so a typed command that could reach the op
	 * would be a permanent delete with no confirmation at all.
	 */
	assert.equal(
		branch.includes("sessions.delete"),
		false,
		"a typed /delete must not send the delete op",
	);
	assert.equal(branch.includes("deleteSession"), false);
	assert.match(branch, /DELETE_UNAVAILABLE_REASON/);
	assert.match(branch, /needs an open conversation/);
});

test("a typed /archive STAGES the confirmation, and /unarchive still writes straight through", () => {
	const branch = between(
		DISPATCH,
		'entry.action === "archive" || entry.action === "unarchive"',
		'entry.action === "request-delete"',
	);
	// The desired state is still the word, and it is what tells the two halves apart -
	// but the halves are no longer one write with a flag.
	assert.match(branch, /const archived = entry\.action === "archive"/);
	/*
	 * THE ARCHIVE DOES NOT REACH THE WRITE (2026-09-30). It stages the candidate and
	 * returns, exactly as `/delete` does one branch down: the pane's one dialog is what
	 * archives, so no typed word can be the gesture that hides a conversation from the
	 * lists and the search.
	 */
	assert.match(
		branch,
		/if \(archived\) \{\s*store\.requestArchiveConfirm\(\{\s*sessionId,\s*fromRow: false,\s*title: row\?\.title \|\| undefined,?\s*\}\);\s*return "consumed";/,
	);
	/*
	 * AND `/unarchive` KEEPS ITS OWN PRESS: the restore is one press on every surface
	 * that offers it, so the branch writes directly and the only write it can reach is
	 * the `false` one. The literal is pinned rather than the variable the branch used to
	 * pass, which is what makes "the restore never asks" fail here if it is undone.
	 */
	assert.match(
		branch,
		/setSessionArchived\(\s*sessionId,\s*false,\s*title,?\s*\)/,
	);
	assert.equal(
		/setSessionArchived\(\s*sessionId,\s*archived,/.test(branch),
		false,
		"the typed branch hands `archived` to the write again, which would archive with no question",
	);
	/*
	 * The `fromRow: false` is the SURFACE, and it is the clause that keeps a typed
	 * `/archive` from taking the reader's caret down into the list: the successor
	 * correction belongs to the row door, and the dialog applies it to that door alone.
	 */
	assert.match(branch, /fromRow: false/);
	// The STORE raises the Undo offer for the restore's accepted write (design round 8,
	// D27), in the update that settles it, exactly as it does for every archive.
	assert.doesNotMatch(branch, /offerArchiveUndo/);
	// The rule is the palette's own, asked once more, so a hidden row that is typed
	// anyway is refused WITH A REASON rather than swallowed.
	assert.match(
		branch,
		/archiveDestinationApplies\(spec\.destination, state, archiveEnabled\)/,
	);
	assert.match(branch, /ARCHIVE_ALREADY_ARCHIVED_REASON/);
	assert.match(branch, /ARCHIVE_NOT_ARCHIVED_REASON/);
	// The THIRD arm, for a conversation whose state this client does not hold at all
	// (agent review round 1, N4): reported as unknown rather than as "not archived",
	// a state nobody established.
	assert.match(branch, /ARCHIVE_STATE_UNKNOWN_REASON/);
	assert.match(branch, /ARCHIVE_UNAVAILABLE_REASON/);
	// A refused press says nothing here: the panel's register already carries it,
	// and one press must not be reported on two surfaces.
	assert.match(branch, /if \(!accepted\) return "consumed";/);
	/*
	 * AND WHERE THE OFFER MOVED TO (design round 8, D27's second clause): the STORE raises it,
	 * in the update that settles the fact, so the accepted departure and the band that answers
	 * it are one commit - raised here instead, the commit between them is the one whose extent
	 * dips below the reader's position and the browser's clamp takes the reader with it. The
	 * store's own suite asserts the one-update property at a subscriber
	 * (`scripts/session-archive-delete.test.mjs`), where it can be read rather than described.
	 */
	assert.doesNotMatch(branch, /offerArchiveUndo/);
	/*
	 * AND THE OFFER IS THE REGISTER'S, NOT A CLOSURE HANDED OVER HERE (design round
	 * 2, D12). It used to carry `onUndo`, which made every offering surface own half
	 * of the offer; the panel now draws it and makes the press, so the offer is a
	 * plain record - and a `onUndo` reappearing here would be a second source of
	 * truth about what pressing Undo does.
	 */
	assert.doesNotMatch(branch, /onUndo:/);
});

test("the confirmation asks the reversible question, and the copy is written in ONE place", () => {
	const dialog = code(ARCHIVE_DIALOG);
	const copy = code(ARCHIVE_CONFIRM);
	/*
	 * THE SENTENCE IS THE MODULE'S, AND THE MODULE IS THE ONLY PLACE IT IS WRITTEN
	 * (`archive-confirm.ts`). It is asserted here in the exact words the user reads, because
	 * every clause of it is a claim about the shipped build - the lists and the search, the
	 * store's own Undo in the update that settles the write, and the search block's remembered
	 * `Include archived` control - so a copy edit that quietly dropped one of the three ways
	 * back would be a claim quietly lost rather than a string quietly changed.
	 */
	assert.match(
		copy,
		/export const ARCHIVE_CONFIRM_MESSAGE = `It leaves your lists\. You can undo for \$\{ARCHIVE_UNDO_TOAST_MS \/ 1000\} seconds; after that, search above your chats, turn on \\u201cInclude archived\\u201d, then Unarchive it\.`;/,
		"the body leads with the consequence and INTERPOLATES the timer, so the copy cannot drift from it",
	);
	assert.match(
		copy,
		/import \{ ARCHIVE_UNDO_TOAST_MS \} from "\.\/archive-undo";/,
	);
	assert.equal(
		/few seconds/.test(copy.replace(/\/\*[\s\S]*?\*\//g, "")),
		false,
		"a vague 'few seconds' came back where the build can say the number",
	);
	assert.match(copy, /export const ARCHIVE_CONFIRM_VERB = "Archive";/);
	// And the dialog RENDERS it rather than restating it: two copies of the sentence would be
	// two places to keep in step with the three facts it promises.
	assert.match(dialog, /message=\{<p>\{ARCHIVE_CONFIRM_MESSAGE\}<\/p>\}/);
	/*
	 * THE TITLE NAMES THE CONVERSATION AND ONLY THE NAME GIVES: the name sits in its own
	 * `min-w-0 truncate` box between two `shrink-0` halves, so a long name ellipsises while
	 * "Archive" and the question mark stay fixed. A title that truncated as a whole would
	 * eventually leave "Archive…" on screen, which is the rule `archiveOfferedName` already
	 * carries for the row's own control label (agent review round 2, R2-3), applied to the
	 * modal.
	 */
	assert.match(dialog, /className="shrink-0">\s*\{`\$\{ARCHIVE_CONFIRM_VERB\}/);
	assert.match(
		dialog,
		/candidateTitle === null \? ARCHIVE_CONFIRM_UNNAMED : candidateTitle/,
	);
	/*
	 * THE QUOTES ARE OUTSIDE THE CUT (design round 1, D2, read off the long-name frame): quoted
	 * inside the truncating box the closing quote was cut with the name. The opening one rides
	 * the verb and the closing one rides the question mark, both `shrink-0`.
	 */
	assert.match(dialog, /\$\{candidateTitle === null \? "" : "\\u201c"\}/);
	assert.match(dialog, /candidateTitle === null \? "\?" : "\\u201d\?"/);
	assert.match(dialog, /className="min-w-0 truncate"/);
	/*
	 * AND IT IS NOT THE DANGER DIALOG. `isDangerous={false}` is this component's default, which
	 * is exactly why it is spelled at the call site: the archive is reversible and the danger
	 * role belongs to the act that is not - the delete dialog beside it, which is the pair a
	 * reader is meant to be able to tell apart at a glance.
	 */
	assert.match(dialog, /isDangerous=\{false\}/);
	assert.match(dialog, /confirmText="Archive"/);
	assert.match(dialog, /cancelText="Cancel"/);
});

test("every cancel path clears the candidate and writes nothing", () => {
	const dialog = code(ARCHIVE_DIALOG);
	/*
	 * THE X, ESCAPE AND THE SCRIM all arrive as one close: `BaseDialog` takes
	 * `onClose={onCancel}`, and this component's `onCancel` is the only thing on that
	 * path - so a double-click whose second press lands on the scrim has archived
	 * nothing, and the row is where it was. What must not be reachable from there is the
	 * WRITE.
	 */
	assert.match(dialog, /onCancel=\{\(\) => requestArchiveConfirm\(null\)\}/);
	assert.equal(
		/onCancel=[\s\S]{0,120}?setSessionArchived/.test(dialog),
		false,
		"a cancel path reaches the archive write",
	);
	// One write, in the confirm arm: three paths (X, ESC, scrim) and one confirm is
	// four ways to leave, and a second `setSessionArchived` here would mean one of
	// them archives.
	assert.equal(
		(dialog.match(/setSessionArchived\(/g) ?? []).length,
		1,
		"the dialog reaches the archive write from more than one arm",
	);
	/*
	 * AND A DROPPED PRESS NEVER OPENS THE QUESTION: the row's guard returns before the
	 * candidate is staged, so the second click of a double-click cannot put a dialog on
	 * screen that the reader's hand did not ask for. The order of the two statements is
	 * the assertion - a guard that ran after the staging would leave the dialog up and
	 * the row still there.
	 */
	const guardAt = code(SIDEBAR).indexOf("if (press.drop) return;");
	assert.notEqual(
		guardAt,
		-1,
		"the repeat-press guard is gone from the row's control",
	);
	const control = code(SIDEBAR).slice(guardAt);
	assert.match(
		control.slice(0, 400),
		/if \(press\.drop\) return;[\s\S]{0,320}?requestArchiveConfirm\(/,
		"the repeat-press guard must run BEFORE the confirmation is staged",
	);
	assert.ok(
		control.indexOf("if (press.drop) return;") <
			control.indexOf("requestArchiveConfirm("),
		"the guard and the staging are in the wrong order",
	);
});

test("the three destinations resolve to local actions, with no control of their own", () => {
	const source = code(REGISTRY);
	for (const destination of [
		"sessions.archive",
		"sessions.unarchive",
		"sessions.delete",
	]) {
		assert.ok(
			source.includes(`"${destination}": { kind: "direct"`),
			`${destination} must be a direct destination: none of the three presents a control of its own`,
		);
	}
	assert.match(
		source,
		/"sessions.delete": \{ kind: "direct", action: "request-delete" \}/,
	);
});

test("the row's press asks first, the restore does not, and the confirm keeps the reader's place", () => {
	const source = code(SIDEBAR);
	/*
	 * ONE ACT, ONE REGISTER (UX round 1, U2). Archiving from the row takes the row
	 * AND its control out of the list, which is exactly the situation the undo offer
	 * exists for - and the offer is the STORE's write now (design round 8, D27), raised in
	 * the update that settles the fact so the accepted departure and the band that answers
	 * it are ONE commit: raised from this handler instead, the commit between them is the
	 * one whose list extent dips below the reader's position. One act, one register survives
	 * the move - every route's accepted archive gets the same offer, from the one place that
	 * knows the write was accepted.
	 */
	assert.doesNotMatch(source, /offerArchiveUndo/);
	/*
	 * THE ARCHIVE HALF OF THE CONTROL NOW STAGES, AND THE RESTORE HALF STILL WRITES
	 * (2026-09-30, D1). The two are asserted here TOGETHER because the whole point of
	 * the branch is that they differ: one candidate staged for the pane's one dialog,
	 * and one press straight through for the act that puts a conversation back.
	 */
	assert.match(
		source,
		/if \(!archived\) \{\s*requestArchiveConfirm\(\{\s*sessionId: row\.session_id,\s*fromRow: true,?\s*\}\);\s*return;/,
	);
	assert.match(
		source,
		/setSessionArchived\(\s*row\.session_id,\s*false,\s*row\.title \?\? undefined,?\s*\)/,
	);
	// A refused RESTORE changes nothing, focus included: the row is still there and
	// the store's sentence is beside the list.
	assert.match(source, /if \(!accepted\) return;/);
	/*
	 * AND THE KEYBOARD KEEPS ITS PLACE (UX round 1, U5; moved to the confirmation,
	 * 2026-09-30). Activating the control REMOVES its row, which used to leave the reader
	 * on `<body>` with the next Tab restarting at the top of the document; the successor
	 * row is snapped before the write (the element is unreadable after an await) and
	 * focused only when the write was accepted. The RULE is unchanged - what moved is WHO
	 * takes the snapshot: with a question in front of the act the press removes nothing,
	 * so the snapshot belongs to the confirmation, which no longer has a press event to
	 * read and resolves the row by id (`archiveRowBox`).
	 */
	const dialog = code(ARCHIVE_DIALOG);
	assert.match(
		dialog,
		/const restoreFocus = row === null \? null : focusRowAfterRemoval\(row\)/,
	);
	assert.match(dialog, /archiveRowBox\(sessionId\)/);
	/*
	 * AND THE DIALOG'S OWN ARMS, which are D4's: the row door takes the successor, and
	 * every other door leans on the modal's opener restore. `fromRow` is what selects
	 * between them, and it is read from the CANDIDATE rather than guessed from the DOM,
	 * because a typed `/archive` can name a conversation the list is drawing and the caret
	 * still belongs in the composer.
	 */
	assert.match(dialog, /const \{ sessionId, fromRow \} = candidate;/);
	assert.match(
		dialog,
		/const row = fromRow \? archiveRowBox\(sessionId\) : null;/,
	);
	/*
	 * THE OPENER'S OWN ARM, and why it needs one of its own: the row's control is a
	 * REVEAL (`hidden` at rest), and `focus()` on a `display: none` element is a no-op - so
	 * `BaseDialog`'s generic restore would leave the reader on `<body>` for exactly the
	 * door that asked from a row. The fallback is the row's own button, and then the header
	 * menu's trigger, which is the delete dialog's own `[data-conversation-actions]`.
	 */
	assert.match(dialog, /document\.activeElement === element\) return;/);
	assert.match(dialog, /archiveRowBox\(row\)/);
	assert.match(dialog, /\[data-chat-row\]/);
	assert.match(dialog, /\[data-conversation-actions\]/);
	/*
	 * AND THE ORDER OF THE FALLBACK IS THE DOOR'S (UX round 1, U4). The header's menu item is
	 * unmounted when the dialog closes, so a header-door cancel always falls through - and the
	 * old order (the row's button first) threw a keyboard user into the OTHER column whenever the
	 * same conversation was also listed. The header's trigger is first for every door that is not
	 * a row; a row door keeps its own button first.
	 */
	assert.match(dialog, /askedFromRow\.current = candidate\.fromRow;/);
	assert.match(
		dialog,
		/const element = fromHeader \? null : opener\.current;/,
		"the header door must not trust the element that held focus when the dialog opened",
	);
	assert.match(
		dialog,
		/askedFromHeader\.current = candidate\.fromHeader === true;/,
	);
	assert.match(
		dialog,
		/\(fromRow \? \(rowButton \?\? trigger\) : \(trigger \?\? rowButton\)\)\?\.focus\(/,
		"a header-door cancel must return to the header's trigger before the sidebar row",
	);
	/*
	 * AND A CONFIRM CLOSES THE DIALOG BEFORE IT WRITES (D3): the candidate is cleared
	 * first, so nothing about the write is rendered inside a dialog that has shut - the
	 * store's settle semantics (the Undo offer, the refusal toast) are the only account of
	 * it. The delete dialog beside it is the opposite shape on purpose: its act cannot be
	 * undone, so its refusal has to stay in the dialog that asked.
	 */
	assert.match(dialog, /requestArchiveConfirm\(null\);/);
	assert.equal(
		dialog.includes("busy"),
		false,
		"the archive confirmation grew a busy state, which D3 refuses (the write settles in the store)",
	);
	/*
	 * THE RULE ITSELF MOVED WITH THE CALL, and it is read off its own module now
	 * (`archive-confirm.ts`), because the confirmation is a different subtree from the
	 * row that used to own it. Every clause below is unchanged.
	 */
	const rule = code(ARCHIVE_CONFIRM);
	assert.match(rule, /function focusRowAfterRemoval\(pressed: HTMLElement\)/);
	assert.match(rule, /element\.isConnected/);
	/*
	 * AND IT DOES NOT TAKE THE READER'S SCROLL WITH IT (QA round 2, Q2). `preventScroll` is half of
	 * what this clause's own name claims: a plain `focus()` scrolls its element into view, and the
	 * successor is picked from DOCUMENT order - so on the one-scroll panel it can be a node of the
	 * ENTITY region, which shares the reader's scroller. The behaviour is read by the driver's
	 * arrival pair (`--scene session-archive`, D30's clauses): under a plain call the reader's
	 * `scrollTop` moved `20 -> 4` and a surviving row's top by 16px, and under this one both are
	 * byte-equal across every sampled frame. The pin is the cheap half; the reading is the claim.
	 */
	assert.match(rule, /successor\?\.focus\(\{ preventScroll: true \}\)/);
	/*
	 * AND THE ROW IT HANDS THE CARET TO IS READ FROM THE LIST'S OWN REGION (UX round 2, U1). The
	 * query is scoped because the merged panel's document order begins in the ENTITY region, so an
	 * unscoped one answers with the `Agents` group disclosure: MEASURED, the caret landed there
	 * (`region=entities`, `aria-expanded=true`, roughly 500px above the row that was pressed) and the
	 * next ↓ walked the group rows before any conversation. The driver's accepted-press leg reads
	 * both the caret's region and the stops the next ↓ reaches; this is the cheap half.
	 */
	assert.match(
		rule,
		/querySelectorAll<HTMLElement>\(\s*'\[data-sidebar-region="chats"\] \[data-chat-row\]'\s*,?\s*\)/,
		"the successor must be read from the chats region, not the panel's document order",
	);
	/*
	 * AND THE ROW IT HANDS THE CARET TO IS RESOLVED FROM THE PRESSED ROW, not from the control's own
	 * parent (UX round 2, U1's behaviour residual; QA round 4's Q-3 reading): the archive control and
	 * the row's button are siblings inside a pair wrapper, so the parent query answered nothing and
	 * the successor rule fell through to the list's FIRST row on every route. Measured in the round:
	 * `indexTheHandOffComputes: -1` against `trueIndexFromClosest: 1`, four routes, all landing on
	 * `live[0]` where the row that took the pressed row's place was a different element. The driver's
	 * row-press clause asserts the successor by id - the cheap half belongs here.
	 */
	assert.match(
		rule,
		/\.closest<HTMLElement>\(\s*"\[data-session-row\]"\s*\)/,
		"the pressed row must be resolved from the row element, not the control's parent",
	);
	/*
	 * AND A PRESS FROM OUTSIDE THE LIST KEEPS ITS OWN ORDER: the entity region's nested rows carry
	 * the same archive control, so the region query alone would answer nothing for them and send the
	 * caret down to the list's first conversation - further than the unscoped rule did.
	 */
	assert.match(
		rule,
		/listRows\.includes\(rowButton\)/,
		"a press outside the list must keep the panel's order, not fall to the list's first row",
	);
});

/*
 * THE SHARED CONTROL'S OWN TEST IS DELETED WITH THE CONTROL (design D9). It pinned the
 * narrow band's one-element stand-in for the pair - a 24px trigger whose menu named both
 * acts - and asserted the reveal that band used. There is no narrow band any more: the
 * pair is drawn at every width, and the two tests above assert its reveal. The frames of
 * that behaviour stay committed under
 * `docs/evidence/session-archive/row-controls-shared*`, which is where the reversal
 * would start from if QA finds the 240 hover too busy.
 */

test("the row's hover ground belongs to the row, not to its button (design round 2, D13)", () => {
	const row = between(
		SIDEBAR,
		"data-session-row={row.session_id}",
		"className={cn(",
	);
	assert.match(row, /data-session-row=\{row\.session_id\}/);
	/*
	 * `rowStyle` carries `hover:bg-row-hover`, which fires only while the pointer is
	 * over the BUTTON - and the two sibling controls sit inside the row's box and
	 * outside its button, so moving onto either one dropped the ground the pointer was
	 * standing on: a pop under a pointer that never left the row. The ground is stated
	 * once more on the box, where the whole row reads as one hovered thing.
	 */
	const box = between(
		SIDEBAR,
		"data-session-row={row.session_id}",
		"{rowButton}",
	);
	assert.match(box, /hover:bg-row-hover/);
	/*
	 * AND NOT `group-hover:` ANYWHERE ON THAT BOX (design round 3, D18). The box is
	 * the element that CARRIES `group`, and Tailwind compiles `group-hover:` to a
	 * DESCENDANT rule - `:is(:where(.group):hover *)` - so a `group-hover:` ground
	 * stated here can never match its own carrier: the class is inert. That is what
	 * the first attempt at this fix was, and it passed every static assertion in
	 * this file while painting nothing, so the pixel claim lives in the driver
	 * (`the row's own ground reaches the row box's own edge`) and this line is the
	 * cheap half that keeps the inert spelling from coming back.
	 */
	assert.doesNotMatch(box, /group-hover:bg-row-hover/);
	/*
	 * Dropped while the row is the CURRENT one, the rule the two controls follow: the
	 * selected ground and the hover ground are two steps off `surface` in the same
	 * direction, so repainting the state the reader is IN as the state the pointer is
	 * in is exactly the substitution `rowCurrent`'s own override exists to stop.
	 */
	assert.match(box, /!current &&\s*"hover:bg-row-hover"/);
});

test("the shed is gone, and what replaced it is a display switch with no reserved box (design D9)", () => {
	/*
	 * THE CASCADE BUG THE OLD VERSION OF THIS TEST PINNED is still the reason the shape
	 * below is asserted rather than described, because it is the bug that shipped on this
	 * branch: the shared control's base was `flex` and the variant also set `flex`, so the
	 * two display rules tied and the CASCADE decided - not the container query - and the
	 * control drew at every width. The rule that survived is the general one: a display
	 * switch has to be a base that the variant RAISES, never two values competing on
	 * equal specificity.
	 *
	 * WHAT IS RETIRED, and each of these is a `display: none`-shaped absence rather than
	 * a spelling worth leaving to be rediscovered: the two container-query constants, the
	 * shared control and its menu, its anchor, and the `@container/chatsidebar`
	 * declaration on the panel root whose only reader was the query.
	 */
	const source = code(SIDEBAR);
	for (const gone of [
		"ROW_CONTROLS_PAIR_SHED",
		"ROW_CONTROLS_SHARED_SHOWN",
		"data-session-actions",
		"<DropdownMenu",
	]) {
		assert.equal(
			source.includes(gone),
			false,
			`the retired shed machinery is still in the panel: ${gone}`,
		);
	}
	/*
	 * THE CONTAINER DECLARATION IS GONE AGAIN, AND SO IS THE BREAK THAT READ IT
	 * (2026-09-30). Round 1 brought both back for one member - the GRIP, shed at or
	 * below a 278px panel because the FIVE-control cluster left the 240 clamp a 40px
	 * title - and this change deletes the arrow pair that made the cluster five wide.
	 * With the pair gone the same width leaves 124px, so the grip is drawn at every
	 * width and the `@container/chatsidebar` on the panel root - whose only reader the
	 * query was - goes with it. The assertion therefore flips back to "the name is
	 * absent", which is the property that keeps a future width query from arriving
	 * unnoticed.
	 */
	const containerReads =
		source.match(/@(?:max|min)-\[[0-9]+px\]\/chatsidebar:/g) ?? [];
	assert.deepEqual(
		containerReads,
		[],
		`the panel's container is read again, by something other than a deliberate break: ${JSON.stringify(containerReads)}`,
	);
	assert.equal(
		/@container\/chatsidebar/.test(source),
		false,
		"the panel root still declares the container the grip's deleted shed measured",
	);
	/*
	 * AND THE REPLACEMENT IS ONE RULE AT EVERY WIDTH, on the wrapper: `hidden` while the
	 * row is unpinned, `flex` while it is pinned - because the pinned row's mark is a
	 * STATE and must read without hovering, which is also the 240 fix (a pinned row there
	 * used to draw no pin at all, because the mark lived inside the wrapper the query
	 * hid) - OR while its context menu is open (`menuOpen`), the hold: the menu's portal
	 * is modal, so the reveal cannot come from `:hover` while it is up and is state
	 * instead. The reversal note that stays in the file is where the shed would go back.
	 */
	const pairWrapper = between(SIDEBAR, "data-session-control-pair", "</div>");
	assert.match(pairWrapper, /"items-center gap-1"/);
	assert.match(
		pairWrapper,
		/(?:pinned \|\| menuOpen)\s*\?\s*"flex"\s*:\s*"hidden group-data-\[session-hover-intent\]:flex group-focus-within:flex"/,
	);
});

/* ------------------------------------------- where the question is asked (UX round 1, U1) */

const APP = "src/renderer/src/app.tsx";

test("the confirmation is mounted at the app shell, so a press asks WHERE IT WAS MADE", () => {
	/*
	 * THE REGRESSION THIS PINS (UX round 1, U1, MAJOR). The row's control and `⌘⇧A` work on every
	 * route - the sidebar is on all of them - and the dialog used to be mounted inside
	 * `ChatContent`, which exists only on `/chat`: a press from Settings staged a candidate with
	 * no host, did nothing visible, and the question then appeared unprompted on the next visit
	 * to the chat. The write used to be immediate from any route, so that was a loss of function.
	 * The host is `app.tsx`, which renders on every route, beside the other app-wide dialogs.
	 */
	const app = code(APP);
	assert.match(
		app,
		/import \{ ArchiveConversationDialog \} from "@features\/chat\/components\/archive-conversation-dialog";/,
	);
	assert.match(app, /\{archiveEnabled && <ArchiveConversationDialog \/>\}/);
	assert.match(
		app,
		/desktopFeatureEnabled\(\s*capabilities\.data,\s*"session_archive",\s*\)/,
		"the shell's host is gated on the same capability every other archive reader is",
	);
	// And the pane is NOT a second host: two dialogs on one candidate would be two questions.
	const content = code(CONTENT);
	assert.equal(
		content.includes("ArchiveConversationDialog"),
		false,
		"the chat pane mounts the archive dialog again, which makes a press on every other route ask nothing",
	);
	/*
	 * AND A STAGED CANDIDATE NEVER OUTLIVES ITS ROUTE. The effect is keyed on the path and clears
	 * through the store's own action; it is a no-op while nothing is staged, so it costs nothing
	 * on the renders that are not a navigation.
	 */
	assert.match(
		app,
		/useEffect\(\(\) => \{\s*useCanonicalSessionsStore\.getState\(\)\.requestArchiveConfirm\(null\);\s*\}, \[pathname\]\);/,
	);
	// The title the pane used to hand the dialog as a prop now rides the candidate.
	assert.match(
		content,
		/requestArchiveConfirm\(\{\s*sessionId,\s*fromRow: false,\s*fromHeader: true,\s*title: agentName,?\s*\}\)/,
	);
	assert.match(code(DISPATCH), /title: row\?\.title \|\| undefined,/);
	assert.match(
		code(ARCHIVE_DIALOG),
		/export const ArchiveConversationDialog: FC = \(\) =>/,
	);
});

test("every one of the five doors STAGES and none of them writes (G1)", () => {
	/*
	 * ONE ASSERTION PER DOOR, at suite level (QA round 1, G1), because the scenes drive some
	 * doors end to end and the rest used to be pinned only by the shape of a neighbour. The three
	 * row doors share a write path by construction - the menu item and the chord both PRESS the
	 * row's control - and each is asserted at the place it is authored.
	 */
	const sidebar = code(SIDEBAR);
	// 1. the row's hover control, pinned and unpinned: ONE button authors both.
	assert.equal(
		(sidebar.match(/data-session-archive\b/g) ?? []).length,
		1,
		"a second archive control would be a door this test does not cover",
	);
	assert.match(
		sidebar,
		/if \(!archived\) \{\s*requestArchiveConfirm\(\{\s*sessionId: row\.session_id,\s*fromRow: true,?\s*\}\);\s*return;\s*\}/,
	);
	// 2. the row's menu item presses that control (so it cannot write on its own)...
	assert.match(
		sidebar,
		/onSelect=\{\(\) => pressRowAct\(row\.session_id, "archive"\)\}/,
	);
	/*
	 * 3. THE CHORD (`⌘⇧A`) is its own path and is asserted AT its own path (review round 2). It does
	 * not call `pressRowAct` - that is door 2's helper - it resolves the row's control and CLICKS it,
	 * so it shares door 1's one staging site and cannot write by itself. The first spelling of this
	 * assertion matched `pressRowAct(` anywhere, which door 2's two menu items satisfy alone, so a
	 * chord that wrote directly would have passed. The slice below is the chord's own block: from
	 * the act's resolution to the `return` that ends it.
	 */
	const chord = between(
		SIDEBAR,
		"const act = chatRowAct(event);",
		"return;\n\t\t}",
	);
	assert.match(chord, /chatRowActControl\(target, act\)/);
	assert.match(chord, /control\.click\(\)/);
	assert.equal(
		/setSessionArchived|requestArchiveConfirm/.test(chord),
		false,
		"the chord must reach the write through the control's own press, not beside it",
	);
	// 4. a typed /archive stages, and ends before any write.
	const typed = between(
		DISPATCH,
		"if (archived) {",
		"const title = row?.title",
	);
	assert.match(typed, /store\.requestArchiveConfirm\(/);
	assert.equal(typed.includes("setSessionArchived"), false);
	// 5. the header's item stages when archiving and writes only when RESTORING.
	const header = between(
		CONTENT,
		"const archiveFromHeader = useCallback(",
		"const requestSessionDelete",
	);
	assert.match(
		header,
		/if \(!next\) \{\s*void setSessionArchived\(sessionId, false, agentName\);\s*return;\s*\}/,
	);
	assert.match(header, /requestArchiveConfirm\(\{/);
	// The ONLY archive=true write in the renderer is the dialog's confirm.
	for (const path of [SIDEBAR, CONTENT, DISPATCH, HEADER]) {
		assert.equal(
			/setSessionArchived\([^)]*\btrue\b/.test(code(path)),
			false,
			`${path} writes an archive without asking`,
		);
	}
	assert.match(
		code(ARCHIVE_DIALOG),
		/setSessionArchived\(\s*sessionId,\s*true,/,
	);
});

test("a greyed Move item says why where a sighted reader can see it (U6)", () => {
	const sidebar = code(SIDEBAR);
	for (const flag of ["up", "down"]) {
		assert.match(
			sidebar,
			new RegExp(
				`aria-disabled=\\{!${flag}\\}\\s*title=\\{!${flag} \\? moveBoundarySentence\\(row\\.session_id\\) : undefined\\}`,
			),
		);
	}
	// The live region and the tooltip are ONE sentence from one function, so they cannot disagree.
	assert.match(sidebar, /announcePinMove\(moveBoundarySentence\(sessionId\)\)/);
	assert.match(
		sidebar,
		/const moveBoundarySentence = \(sessionId: string\) =>\s*pinMoveBoundaryNote\(/,
	);
});
