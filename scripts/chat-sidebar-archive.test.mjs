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
	return stop === -1 ? source.slice(at) : source.slice(at, stop);
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
	const control = rows.indexOf("aria-label={archiveControlLabel(label, archived)}");
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

test("the archive control is reserved, revealed by opacity, and named by its action", () => {
	const control = between(
		SIDEBAR,
		"aria-label={archiveControlLabel(label, archived)}",
		"</button>",
	);
	// Reserved at rest: the box is the same size in both states, so the reveal
	// cannot reflow the row under the pointer - and it is hidden AND inert, because
	// an affordance the reader cannot see must not be what a press lands on.
	assert.match(control, /size-6/);
	assert.match(control, /shrink-0/);
	assert.match(control, /opacity-0/);
	assert.match(control, /pointer-events-none/);
	// Only opacity, colour and pointer-events move on the reveal: nothing lifts,
	// scales or translates on hover.
	assert.equal(/group-hover:[a-z-]*(scale|translate)/.test(control), false);
	assert.match(control, /group-hover:opacity-100/);
	assert.match(control, /group-hover:pointer-events-auto/);
	// Reachable by keyboard: Tab into the row reveals it, and the next Tab lands on
	// it, which is what `group-focus-within` is here for.
	assert.match(control, /group-focus-within:opacity-100/);
	// The action, never the state, and the conversation named - one derivation for
	// the accessible name and the tooltip, so they cannot disagree.
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
	assert.match(source, /archiveEnabled && "group"/);
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
	assert.match(rows, /\$\{archived \? ", archived" : ""\}/);
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
	 * And it is SCOPED TO ONE SEARCH: cleared with the box, so the next search
	 * cannot start armed with a filter the user can no longer see.
	 */
	assert.match(
		code(SIDEBAR),
		/if \(!query\.trim\(\)\) setIncludeArchived\(false\)/,
	);
});

test("the list the panel draws is the page minus the archived rows, and the search is told", () => {
	const source = code(SIDEBAR);
	// ONE filter, before anything reads the list: the flat list, both sections, the
	// agent and team groups and the local half of the search all read this array.
	assert.match(
		source,
		/visibleRows\(sessions, archiveEnabled && !includeArchived\)/,
	);
	// The request itself carries the control's state, and the join is given the
	// client's own facts, so a press on a row rebuilt from a cached hit can be
	// inverted.
	assert.match(
		source,
		/useChatSearch\(\s*query,\s*ready && searchSupported,\s*includeArchived,\s*\)/,
	);
	assert.match(source, /searchChats\(listed, query, hits, archiveView\)/);
	assert.match(
		source,
		/searchChats\(\s*listed,\s*search\.data\.query,\s*search\.data\.sessions,\s*archiveView,?\s*\)/,
	);
});

test("a refused press is reported once, in the panel's register, with a retry", () => {
	const failure = between(SIDEBAR, "archiveFailure && (", "{showList && (");
	assert.match(failure, /archiveFailure\.title/);
	assert.match(failure, /archiveFailure\.detail/);
	// The retry sends the DESIRED state that was refused, not the state on screen.
	assert.match(
		failure,
		/setSessionArchived\(\s*archiveFailure\.sessionId,\s*archiveFailure\.archived,/,
	);
	// `warning`, not `danger`: the list is intact and only this row's archive state
	// did not move.
	assert.match(failure, /text-warning/);
	assert.equal(
		failure.includes('role="alert"'),
		false,
		"the sentence must not compete with the catalogue alert about a different failure",
	);
});

test("the press record expires on the pointer's own path", () => {
	const panel = between(SIDEBAR, "ref={listPanelRef}", 'className="mt-2');
	assert.match(panel, /onPointerMove=/);
	assert.match(panel, /archivePressExpired\(lastArchivePress\.current/);
	assert.match(panel, /onPointerLeave=/);
	assert.match(panel, /lastArchivePress\.current = null/);
});

/* ------------------------------------------------------- the chat header */

test("the archived state is a pill badge with its own restore control beside it", () => {
	const pill = between(
		HEADER,
		"archiveEnabled && archived && (",
		"{/*\n\t\t\t\t * THE CONVERSATION'S OWN MENU",
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
		/setRefusal\(\{ candidate, detail: outcome\.detail \}\)/,
	);
	assert.match(source, /refusal\.candidate === candidate/);
	assert.match(source, /text-danger/);
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
	const branch = between(
		DISPATCH,
		'entry.action === "request-delete"',
		'if (entry.action === "clear")',
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
	// The rule is the palette's own, asked once more, so a hidden row that is typed
	// anyway is refused WITH A REASON rather than swallowed.
	assert.match(
		branch,
		/archiveDestinationApplies\(spec\.destination, state, archiveEnabled\)/,
	);
	assert.match(branch, /ARCHIVE_ALREADY_ARCHIVED_REASON/);
	assert.match(branch, /ARCHIVE_NOT_ARCHIVED_REASON/);
	assert.match(branch, /ARCHIVE_UNAVAILABLE_REASON/);
	// A refused press says nothing here: the panel's register already carries it,
	// and one press must not be reported on two surfaces.
	assert.match(branch, /if \(!accepted\) return "consumed";/);
	assert.match(branch, /offerArchiveUndo\(/);
	assert.match(branch, /onUndo:/);
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
