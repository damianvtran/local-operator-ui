import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Archiving, as decisions: which rows the default lists may draw, which of the
 * two `/archive` commands applies to the conversation on screen, what the two
 * controls are called, and what the permanent delete's dialog says.
 *
 * Why this file exists, in this repository's own words: a decision written as a
 * JSX condition is one no test can reach, and the sidebar cannot be rendered in
 * this suite (it reads the router, the session store and the capability hooks).
 * So the four rules the feature is built out of are modules, and they are
 * asserted here by RUNNING them - `scripts/chat-sidebar-archive.test.mjs` is the
 * other half, which reads the shipped JSX to prove the surfaces call these.
 *
 * The properties that matter, and why each fails silently on its own:
 *
 *   1. FAIL-CLOSED. A backend with no archive store must render the panel it
 *      rendered before this feature existed - not a panel with an affordance
 *      that does nothing. `visibleRows` and `archivedRows` therefore return the
 *      SAME array (identity, not a copy) when the capability is absent, and the
 *      command rule hides both archive words.
 *   2. THE PARTITION IS BY STATE, NOT BY PRESENCE. An archived conversation is
 *      drawn nowhere at rest - not in `Active chats`, not in `Previous chats`,
 *      not in the flat list.
 *   3. THE COMMAND PAIR IS NOT A TOGGLE PAIR. The catalogue is static, so the
 *      rows are filtered on the open conversation's own state: `/unarchive` on a
 *      conversation nobody archived is an action with nothing to act on, and
 *      offering it beside `/archive` shows a pair of opposites for one state.
 *   4. THE DELETE COPY NAMES WHAT IS LOST AND WHAT IS KEPT. The wire removes the
 *      addressed conversation and not its subagent runs, and a dialog that stayed
 *      silent about them would leave the user guessing in the expensive
 *      direction.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/chat-archived";' +
			' export * from "./src/renderer/src/features/chat/delete-conversation";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	ARCHIVE_ALREADY_ARCHIVED_REASON,
	ARCHIVE_NOT_ARCHIVED_REASON,
	ARCHIVE_STATE_UNKNOWN_REASON,
	ARCHIVE_UNAVAILABLE_REASON,
	DELETE_UNAVAILABLE_REASON,
	archiveControlLabel,
	archiveDestinationApplies,
	archivedRows,
	archivedSearchWidened,
	deleteConversationMessage,
	undoOfferStands,
	visibleRows,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const row = (session_id, archived) => ({ session_id, archived });

test("the at-rest lists drop the archived rows, and drop nothing when the capability is absent", () => {
	const rows = [row("aaaaaaaaaaaa", false), row("bbbbbbbbbbbb", true)];
	assert.deepEqual(
		visibleRows(rows, true).map((entry) => entry.session_id),
		["aaaaaaaaaaaa"],
	);
	/*
	 * IDENTITY, not deep equality, and the distinction is the whole fail-closed
	 * claim: with the capability absent the function must not touch the array at
	 * all, because a row this client archived optimistically would otherwise be
	 * drawn NOWHERE - no list to be absent from, and no control anywhere that could
	 * restore it. The same rule the withdrawn-gate frames photograph.
	 */
	assert.equal(visibleRows(rows, false), rows);
	// And it does not even READ the flag in that state: a row claiming archived on
	// a backend that advertises no archive store is still a row.
	assert.deepEqual(
		visibleRows([{ session_id: "cccccccccccc", archived: true }], false),
		[{ session_id: "cccccccccccc", archived: true }],
	);
});

test("the archived set is reported only where a control could act on it", () => {
	const rows = [row("aaaaaaaaaaaa", false), row("bbbbbbbbbbbb", true)];
	assert.deepEqual(
		archivedRows(rows, true).map((entry) => entry.session_id),
		["bbbbbbbbbbbb"],
	);
	// Nothing is claimed on a backend with no archive store: a set this client
	// cannot act on is not a set it should count or name.
	assert.deepEqual(archivedRows(rows, false), []);
	// A row whose state is absent entirely (a caller that never asked) is not
	// archived - "no claim" is not "archived".
	assert.deepEqual(archivedRows([{ session_id: "dddddddddddd" }], true), []);
});

test("the archive words are filtered on the conversation's own state", () => {
	const archive = (archived, enabled = true) =>
		archiveDestinationApplies("sessions.archive", archived, enabled);
	const unarchive = (archived, enabled = true) =>
		archiveDestinationApplies("sessions.unarchive", archived, enabled);

	// Live: archive yes, unarchive no.
	assert.equal(archive(false), true);
	assert.equal(unarchive(false), false);
	// Archived: the other way round, and only the other way round.
	assert.equal(archive(true), false);
	assert.equal(unarchive(true), true);
	/*
	 * UNKNOWN is a real third answer - a conversation this client holds no row for
	 * and no fact about. `/unarchive` needs a positive fact to be offered;
	 * `/archive` does not, because its desired state is well defined whatever the
	 * current one is.
	 */
	assert.equal(archive(undefined), true);
	assert.equal(unarchive(undefined), false);
	// The capability closes BOTH, which is what keeps a backend without the store
	// from offering a press that would 404.
	assert.equal(archive(false, false), false);
	assert.equal(unarchive(true, false), false);
	/*
	 * And it never touches anything else in the catalogue: this rule is asked of
	 * every command row, and hiding `/model` because the backend cannot archive
	 * would be the fail-closed rule applied one surface too wide.
	 */
	assert.equal(archiveDestinationApplies("session.model", true, false), true);
	assert.equal(archiveDestinationApplies(undefined, true, false), true);
});

test("the control's name is the action, and it names the conversation", () => {
	assert.equal(
		archiveControlLabel("Quarterly review", false),
		"Archive “Quarterly review”",
	);
	assert.equal(
		archiveControlLabel("Quarterly review", true),
		"Unarchive “Quarterly review”",
	);
	// The action, never the state: the state is the marker beside the title and
	// the glyph on the control, and a control called "Archived" leaves a screen
	// reader asking what pressing it would do.
	assert.equal(archiveControlLabel("x", true).startsWith("Unarchive"), true);
});

test("the delete copy names the conversation, and the runs it does not remove", () => {
	const plain = deleteConversationMessage("Quarterly review", false);
	assert.match(plain, /“Quarterly review”/);
	assert.match(plain, /permanently removed from this machine/);
	assert.match(plain, /cannot be undone/);
	/*
	 * And it says nothing about subagent runs when there are none: a sentence about
	 * what is kept, beside a conversation that started nothing, is noise that
	 * teaches the user to skim the one sentence that matters.
	 */
	assert.equal(plain.includes("subagent"), false);

	const withChildren = deleteConversationMessage("Quarterly review", true);
	assert.match(withChildren, /subagent runs it started are kept/);
	/*
	 * The claim must not be the WIDER one: the wire removes the addressed
	 * conversation and not its children, so the copy can never say the children go
	 * with it - and a reader who skimmed a dialog that implied it would delete the
	 * parent to clean up children that survive.
	 */
	assert.equal(/subagent runs.*(removed|deleted)/.test(withChildren), false);
});

test("every refusal sentence says what is wrong in the register the panel uses", () => {
	// `This ...` rather than `Error:`-shaped fragments, and each names the cause
	// rather than the symptom. Asserted loosely - the point is that they are
	// authored sentences, not machine text.
	for (const sentence of [
		ARCHIVE_UNAVAILABLE_REASON,
		ARCHIVE_ALREADY_ARCHIVED_REASON,
		ARCHIVE_NOT_ARCHIVED_REASON,
		ARCHIVE_STATE_UNKNOWN_REASON,
		DELETE_UNAVAILABLE_REASON,
	]) {
		assert.match(sentence, /^[A-Z].*\.$/);
		assert.ok(sentence.length > 20, `too terse to be a sentence: ${sentence}`);
	}
	// The two state refusals are DIFFERENT sentences, because they are different
	// problems and only one of them has anything the user can do.
	assert.notEqual(ARCHIVE_ALREADY_ARCHIVED_REASON, ARCHIVE_NOT_ARCHIVED_REASON);
});

test("the widened-search rule needs a query, and remembering the box does not widen the lists", () => {
	/*
	 * The UX round 1 (U8) decision, pinned: the `Include archived` box is
	 * REMEMBERED across a cleared query (so a user who clears and retypes does not
	 * silently lose the archived result they just found) but is IN FORCE only while
	 * a query is - otherwise a remembered box would widen the at-rest lists, which
	 * is the one thing the feature exists to prevent.
	 */
	assert.equal(archivedSearchWidened(true, "quarterly", true), true);
	assert.equal(
		archivedSearchWidened(true, "   ", true),
		false,
		"a remembered box with no query in force must not widen anything",
	);
	assert.equal(archivedSearchWidened(false, "quarterly", true), false);
	assert.equal(
		archivedSearchWidened(true, "quarterly", false),
		false,
		"no capability, no widening - the fail-closed arm",
	);
});

test("the undo offer stands while the state it was made about holds, and not a moment longer", () => {
	/*
	 * The rule UX round 1 (U4) and the agent review (N5) both landed on, as one
	 * function so the comment and the behaviour cannot drift: the offer is about
	 * `archived: true`, so a client that still knows the conversation is archived
	 * keeps offering (an ANSWER that merely mentions the row does not end it - the
	 * shipped version retired on any answer, which measured 0.4-1.6 s of toast), and
	 * one that knows anything else retires it.
	 */
	assert.equal(undoOfferStands(true, true), true, "the state still holds");
	assert.equal(undoOfferStands(true, false), false, "it was restored");
	assert.equal(
		undoOfferStands(true, undefined),
		false,
		"no such conversation here any more: deleted, or off the page",
	);
	assert.equal(
		undoOfferStands(false, false),
		true,
		"the same rule, offered the other way",
	);
	assert.equal(undoOfferStands(false, true), false);
});
