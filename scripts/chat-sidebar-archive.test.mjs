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
const HEADER = "src/renderer/src/features/chat/components/chat-header.tsx";
const CONTENT = "src/renderer/src/features/chat/components/chat-content.tsx";
const DIALOG =
	"src/renderer/src/features/chat/components/delete-conversation-dialog.tsx";
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
	 * the base is now `hidden` and the two group states ADD `flex`.
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
	assert.match(control, /group-hover:flex/);
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
	assert.match(control, /group-hover:text-ink-muted/);
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
	 * `bindingOfHit` is the sixth argument: the client's own knowledge of what a
	 * search hit the store does not hold is bound to (round 1, Q2). The pin is
	 * widened rather than loosened - the five arguments it already named are still
	 * named in order, so a call that dropped one still fails here.
	 */
	assert.match(
		source,
		/searchChats\(\s*\[\.\.\.listed, \.\.\.heldRows\],\s*query,\s*hits,\s*pinFactValues,\s*archiveView,\s*bindingOfHit,?\s*\)/,
	);
	assert.match(
		source,
		/searchChats\(\s*\[\.\.\.listed, \.\.\.heldRows\],\s*search\.data\.query,\s*search\.data\.sessions,\s*pinFactValues,\s*archiveView,\s*bindingOfHit,?\s*\)/,
	);
});

test("a refused press is reported once, in the sidebar's own toast lane, with a retry", () => {
	/*
	 * THE REFUSAL IS A TOAST IN THE PANEL'S OWN LANE NOW (design D11), and the register
	 * it replaces is DELETED rather than kept beside it: measured, the register sat 8px
	 * above the split line and 117px above the first row of the list it was about,
	 * because the flex column positioned it rather than the list.
	 *
	 * The slice is the failure EFFECT, so what is asserted here is the shape the design
	 * depends on and no module can hold: the refusal names the conversation, carries the
	 * backend's own sentence when there is one, is routed to the panel's lane, and offers
	 * the retry that re-sends the SAME desired state.
	 */
	/*
	 * THE SLICE IS THE ONE LANE EFFECT (agent review round 2, R2-4): both messages are
	 * settled by a single effect out of the store's two values, so the assertions below are
	 * about ONE decision per commit rather than about two effects whose declaration order
	 * would decide which message wins.
	 */
	/*
	 * THE SLICE ENDS AT THE EFFECT'S DEPENDENCY ARRAY, which is the last line of the drawing
	 * effect and therefore carries BOTH lane messages (the refusal and the offer), and it is
	 * spelled here in the shaped `pnpm lint`/`biome format` gives it.
	 *
	 * IT WAS `}, [archiveFailure, archiveUndo, setSessionArchived]);` UNTIL 2026-09-22, and that
	 * marker stopped matching when the U10 fix added two entries - `between` then ran the slice
	 * to the end of the FILE (1428 lines), so the assertions below were reading the whole
	 * component and the `role="alert"` one found the CATALOGUE alert's own markup hundreds of
	 * lines down: it had become a claim about the rest of the component. `between` now fails
	 * loudly on a missing marker, which is what makes this spelling safe to pin.
	 */
	const failure = between(
		SIDEBAR,
		"if (!archiveFailure && !archiveUndo) {",
		"\t\tclearArchiveFailure,\n\t\tsetArchiveUndo,\n\t]);",
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
	assert.match(failure, /position: ARCHIVE_TOAST_LANE/);
	assert.equal(
		failure.includes('role="alert"'),
		false,
		"the sentence must not compete with the catalogue alert about a different failure",
	);
	// The refusal is the newest word: it is decided before the offer in the same effect.
	/*
	 * AND THE DECISION IS ONE OF CURRENCY (agent review round 3, R3-1 = UX round 3, U7). The
	 * effect used to take the failure branch unconditionally, so after ONE refused archive every
	 * later successful archive's offer was never painted. Both messages now carry the stamp of
	 * the write that raised them and the NEWER one wins, which these assertions pin: the
	 * comparison exists, and the failure branch is the one that comparison selects.
	 */
	/*
	 * AND THE COMPARISON IS STRICT (repaired 2026-09-22, `cbfe27143` - "a refusal outranks an
	 * offer on a tie, and carries its own stamp"). This assertion pinned `>=`, which is the
	 * OLD contract: both messages are stamped from the same counter, and an undo whose
	 * refusal lands in the answer that re-raises the offer puts them at the SAME stamp -
	 * under `>=` the OFFER won that tie and the branch then cleared the refusal, so the lane
	 * drew an offer for its eight seconds while the reader had just been refused. The src is
	 * right and the test was behind it: a REFUSAL is a fact about a press that was ANSWERED,
	 * an offer a fact about a write, and on a tie the refused press keeps its card.
	 */
	assert.match(failure, /archiveUndo\.at > archiveFailure\.at/);
	assert.match(
		failure,
		/if \(newest === "failure" && archiveFailure\) \{[\s\S]*laneMessageRef\.current = "failure";[\s\S]*showWarningToast\(/,
	);
	/*
	 * AND THE ONE DISMISSAL IS THE LANE GOING EMPTY (agent review round 1, R-1, and round 2,
	 * R2-1/R2-4). What retires a message is the lane's own record of what it DREW, never the
	 * store's other fact - `archiveFailure` outlives its message, and gating the offer's
	 * retirement on it let one refused archive disable retirement for the rest of a session.
	 * The refusal itself is retired by the store answering the write it describes: an
	 * accepted unarchive clears it, an accepted archive supersedes it with the offer
	 * `offerArchiveUndo` raises in the same update, and a press leaves it alone.
	 *
	 * NOTHING IS DISMISSED ON MOUNT, which is why the effect opens with the ref rather than
	 * going straight to `dismissToast` (the jsdom the sidebar's own tests mount in): sonner's
	 * `dismiss` reaches a bare `requestAnimationFrame` with no guard, so a dismiss on a mount
	 * that never showed this toast is a call with no toast behind it - and in a DOM without
	 * `requestAnimationFrame` at all it is a ReferenceError thrown from a passive effect.
	 */
	assert.match(failure, /if \(laneMessageRef\.current === null\) return;/);
	assert.match(failure, /dismissToast\(ARCHIVE_TOAST_ID\);/);
	/*
	 * AND THE LIFE A RE-ASSERTION GETS IS A FULL ONE (agent review round 2 - the
	 * re-assertion). Both draws are PERSISTENT to sonner, because its per-toast life
	 * resets only when the `duration` passed to an already-mounted entry CHANGES - so the
	 * refusal a refused Retry put back inherited the clock of the message it replaced and
	 * went seconds later, measured in `session-archive` as the lane empty 5068ms (dark) /
	 * 5096ms (light) after the press with the store's refusal still standing. The panel
	 * arms the life instead, per message, from the same two values the draw reads: no ref,
	 * no declaration order, and every new assertion re-runs it with the full span.
	 */
	assert.match(
		code(SIDEBAR),
		/const ARCHIVE_TOAST_PERSISTENT = Number\.POSITIVE_INFINITY;/,
	);
	assert.equal(
		failure.split("duration: ARCHIVE_TOAST_PERSISTENT,").length - 1,
		2,
		"both lane messages must be drawn without a life sonner could end on its own",
	);
	assert.equal(
		/duration: ARCHIVE_(FAILURE|UNDO)_TOAST_MS/.test(failure),
		false,
		"a draw that passes a finite duration keeps sonner's clock on the entry, which a re-assertion does not reset",
	);
	const clock = between(
		SIDEBAR,
		"const message = archiveFailure",
		/*
		 * THE MARKER IS THE CLOCK EFFECT'S OWN DEPENDENCY ARRAY, re-spelled 2026-09-22: it used to
		 * be `}, [archiveFailure, archiveUndo]);` and the U10 fix grew it by `clearArchiveFailure`
		 * and `setArchiveUndo` (both read in the expiry body). `between` now fails on a missing
		 * marker rather than running the slice to the end of the file, which is what makes this
		 * pin safe - before, this assertion had been reading the rest of the component.
		 */
		"}, [archiveFailure, archiveUndo, clearArchiveFailure, setArchiveUndo]);",
	);
	assert.match(clock, /laneMessageRef\.current = null;/);
	assert.match(clock, /dismissToast\(ARCHIVE_TOAST_ID\);/);
	assert.match(
		clock,
		/message === "failure" \? ARCHIVE_FAILURE_TOAST_MS : ARCHIVE_UNDO_TOAST_MS/,
	);
	// Two effects, two "previous value" refs and a peer-fact test are all gone: the
	// property above is now a consequence of one effect, not of two order-dependent ones.
	assert.equal(
		code(SIDEBAR).includes("previousFailureRef") ||
			code(SIDEBAR).includes("previousUndoRef"),
		false,
		"the lane must be settled by one effect: two effects make U3's fix a matter of declaration order",
	);
	// The retry no longer dismisses its own message before re-sending (U3), and neither does
	// the offer's Undo before ITS answer (R2-1): both send their write and nothing else.
	const retry = failure.slice(failure.indexOf('label: "Retry"'));
	assert.equal(
		retry
			.slice(0, retry.indexOf("setSessionArchived"))
			.includes("dismissToast"),
		false,
		"a retry that takes its own message down loses the refusal its answer re-creates",
	);
	const offer = code(SIDEBAR).slice(code(SIDEBAR).indexOf('label: "Undo"'));
	assert.equal(
		offer
			.slice(0, offer.indexOf("setSessionArchived"))
			.includes("dismissToast"),
		false,
		"an undo that takes its own message down loses the refusal its answer re-creates (R2-1)",
	);
});

test("the offer's card truncates its NAME and can never truncate the verb (agent review round 2, R2-3)", () => {
	/*
	 * THE MARKER IS THE DRAWING EFFECT'S DEPENDENCY ARRAY, re-spelled 2026-09-22 in the shape the
	 * formatter gives it: it used to be `}, [archiveFailure, archiveUndo, setSessionArchived]);`,
	 * which the U10 fix grew by `clearArchiveFailure` and `setArchiveUndo` and `biome format`
	 * wrapped across lines. Before `between` was hardened this slice silently ran to the end of
	 * the file, so the assertions below were reading the whole component rather than the
	 * offer's own message.
	 */
	const offer = between(
		SIDEBAR,
		"if (archiveUndo) {",
		"\t\tclearArchiveFailure,\n\t\tsetArchiveUndo,\n\t]);",
	);
	// The name and the verb are two elements: a single string that overflows loses its
	// TAIL, and the tail of `“<title>” archived.` is the verb.
	assert.match(offer, /archiveOfferedName\(archiveUndo\.title\)/);
	assert.match(offer, /ARCHIVE_OFFERED_VERB/);
	assert.match(offer, /className="min-w-0 truncate"/);
	assert.equal(
		offer.includes("archiveOfferedText"),
		false,
		"the sentence must not be one string, or a long title cuts the word that says what happened",
	);
});

test("the offer is drawn in the sidebar's own lane, mounted at the panel's root (design D11; agent review round 4, R4-1)", () => {
	const source = code(SIDEBAR);
	/*
	 * WHY THE HOME MATTERS, which is what round 4's R4-1 was about: the offer used to be
	 * a direct child of the `<nav>` and the fold re-applied it inside the ENTITY region,
	 * which the assembly drops in `chats-only` - so the offer and its Undo were drawn
	 * exactly when the list they belong to was hidden. The lane inherits the register's
	 * home and its reason: ONE container, mounted at the panel's root, so every assembly
	 * mode carries it.
	 *
	 * WHAT IDENTIFIES THE OFFER NOW: sonner routes a toast to the container whose
	 * `position` matches it, so the panel's lane declaring `bottom-left` is what puts
	 * the offer in the sidebar and not in the viewport's corner. The register's own DOM
	 * anchors (`data-session-archive-undo` / `-failure`) are gone with it, and the driver
	 * reads the lane instead.
	 */
	assert.equal(
		(source.match(/<ThemedToastContainer/g) ?? []).length,
		1,
		"the panel must mount exactly one toast lane",
	);
	const lane = between(SIDEBAR, "<ThemedToastContainer", "/>");
	assert.match(lane, /position=\{ARCHIVE_TOAST_LANE\}/);
	assert.match(lane, /style=\{ARCHIVE_TOAST_CONTAINER_STYLE\}/);
	/*
	 * AND THE LANE IS THE PANEL'S BOX, which since D10's cap and D14's band is the anchor
	 * plus TWO boxes (repaired 2026-09-22, when the band landed): the nav's `relative` is
	 * what the panel's column is confined by, the BAND is the positioned ancestor the card
	 * resolves its `--width` and `max-height: 100%` against, and the CONTAINER is
	 * deliberately `static` so sonner's own `position: fixed` cannot put the card back in
	 * the viewport's corner. This assertion used to read `position: "absolute"` and
	 * `ARCHIVE_TOAST_LANE_STYLE` because the container WAS the card's box; both moved with
	 * the shape. The cap is the card's and lives on the band: `min(248px, 100%)`, i.e.
	 * never wider than the lane it is drawn in (design round 3, D10) - not the old
	 * `min(264px, 100% - 32px)` the container used to declare.
	 */
	assert.match(
		source,
		/className="relative flex h-full min-h-0 flex-col bg-surface p-2 text-ink"/,
	);
	assert.match(source, /position: "relative"/);
	assert.match(source, /position: "static"/);
	assert.match(source, /"--width": "min\(248px, 100%\)"/);
	// The pins' failure line keeps its three sites; the register has none left.
	const pins = source.match(/\{pinFailureLine\}/g) ?? [];
	assert.ok(
		pins.length >= 3,
		`expected the pin's failure line in every assembly branch, found ${pins.length}`,
	);
	assert.equal(
		(source.match(/\{archiveRegister\}/g) ?? []).length,
		0,
		"the register must be deleted from the assembly, not left beside the toast",
	);
	assert.equal(
		source.includes("const archiveRegister = ("),
		false,
		"the register's own JSX must be gone with its call sites",
	);
	// One provider for the panel, so the rows' flyouts share a delay and a skip.
	assert.match(source, /<TooltipProvider>/);
});

test("the press record expires on the pointer's own path", () => {
	/*
	 * THE SLICE IS THE CHATS LIST PANEL'S OWN HANDLERS, and its end marker moved 2026-09-22: the
	 * element used to end at a `className="mt-2` (gone with the gutter/split class work), and the
	 * list's class list now sits AFTER its handlers as `className={cn(` - the same marker the
	 * sessionRow slice below uses. Before `between` was hardened, this slice ran to the end of
	 * the file, so every pattern it asserts could have been satisfied by the ENTITY region's
	 * nested rows rather than by this panel, which is exactly what its own comment says the
	 * records are region-scoped about.
	 */
	const panel = between(SIDEBAR, "ref={listPanelRef}", "className={cn(");
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
	const menu = between(
		HEADER,
		"(archiveEnabled || deleteEnabled) && (",
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

test("a typed /archive writes the store, reports a refusal, and offers an undo on success", () => {
	const branch = between(
		DISPATCH,
		'entry.action === "archive" || entry.action === "unarchive"',
		'entry.action === "request-delete"',
	);
	// The desired state is the word: archive asks for true, unarchive for false.
	assert.match(branch, /const archived = entry\.action === "archive"/);
	assert.match(branch, /setSessionArchived\(\s*sessionId,\s*archived,/);
	// Offered with the STATE it is about (see `undoOfferStands`): the offer stands
	// while the conversation still holds that state, so a catalogue answer that
	// merely mentions the row cannot retire it after 0.4-1.6 s (UX round 1, U4).
	assert.match(branch, /archived,/);
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

test("the row's press is the same act as the typed command, and keeps the reader's place", () => {
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
	// A refused press changes nothing, focus included: the row is still there and
	// the store's sentence is beside the list.
	assert.match(source, /if \(!accepted\) return;/);
	/*
	 * AND THE KEYBOARD KEEPS ITS PLACE (UX round 1, U5). Activating the control
	 * unmounts it and its row, which used to leave the reader on `<body>` with the
	 * next Tab restarting at the top of the document; the successor row is snapped
	 * before the press (the element is unreadable after an await) and focused only
	 * when the write was accepted.
	 */
	assert.match(
		source,
		/const restoreFocus = focusRowAfterRemoval\(event\.currentTarget\)/,
	);
	assert.match(source, /function focusRowAfterRemoval\(pressed: HTMLElement\)/);
	assert.match(source, /element\.isConnected/);
	assert.match(source, /successor\?\.focus\(\)/);
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
		"@container/chatsidebar",
		"<DropdownMenu",
	]) {
		assert.equal(
			source.includes(gone),
			false,
			`the retired shed machinery is still in the panel: ${gone}`,
		);
	}
	/*
	 * AND THE REPLACEMENT IS ONE RULE AT EVERY WIDTH, on the wrapper: `hidden` while the
	 * row is unpinned, `flex` while it is pinned - because the pinned row's mark is a
	 * STATE and must read without hovering, which is also the 240 fix (a pinned row there
	 * used to draw no pin at all, because the mark lived inside the wrapper the query
	 * hid). The reversal note that stays in the file is where the shed would go back.
	 */
	const pairWrapper = between(SIDEBAR, "data-session-control-pair", "</div>");
	assert.match(pairWrapper, /"items-center gap-1"/);
	assert.match(
		pairWrapper,
		/pinned\s*\?\s*"flex"\s*:\s*"hidden group-hover:flex group-focus-within:flex"/,
	);
});
