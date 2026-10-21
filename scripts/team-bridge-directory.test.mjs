import assert from "node:assert/strict";
import { readFileSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The Team Bridge directory (People section) and the eligibility gate.
 *
 * TWO LAYERS, BOTH THROUGH THE SHIPPED MODULES:
 *
 *  - the MODEL tests drive the pure decisions the rows render from — whether a
 *    person is self, openable, paused or inert; which existing conversation a
 *    row opens; and how one status payload becomes the plan/sign-in verdict.
 *    These are the decisions a copy change can silently invert, so they are
 *    asserted by name rather than by markup.
 *  - the VIEW tests server-render `TeamBridgePageView` for the states the
 *    operator asked to see: people loading, people failed, people populated
 *    (openable, paused and disabled rows), the merged scope's explanation, and
 *    the plan / sign-in panels. `renderToStaticMarkup` is the house pattern
 *    (`team-bridge-channels.test.mjs`): it exercises the real component tree
 *    without a backend and without mounting Radix's portal.
 *
 * NOTHING HERE REACHES A DAEMON. The directory is fixtures and the view takes
 * its state as props; the live read is exercised by the story capture and the
 * companion agent-server change's own tests.
 */

const ROOT = process.cwd();

/** The model bundle: no JSX, no DOM — a data URL is enough. */
const modelBundle = await build({
	stdin: {
		contents: `export * from "./src/renderer/src/features/team-bridge/team-bridge-model";
			export { teamBridgeDirectorySchema } from "./src/shared/team-bridge-contract";`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
});
const model = await import(
	`data:text/javascript;base64,${Buffer.from(modelBundle.outputFiles[0].text).toString("base64")}`
);

/*
 * The component bundle must share ONE React instance with this test, so it is
 * imported from a real temp module (packages external) rather than a data URL —
 * the same reason and cleanup as the sibling component suite.
 */
const componentBundle = await build({
	stdin: {
		contents: `
			export { TeamBridgePageView, TeamBridgeEligibilityPanel } from "./src/renderer/src/features/team-bridge/team-bridge-page";
			export { setLocale } from "./src/i18n";
		`,
		resolveDir: ROOT,
		sourcefile: "team-bridge-directory.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	loader: { ".css": "empty" },
	alias: {
		"@shared": `${ROOT}/src/renderer/src/shared`,
		"@features": `${ROOT}/src/renderer/src/features`,
	},
	write: false,
});
const modulePath = new URL(
	`./_team-bridge-directory-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(modulePath, componentBundle.outputFiles[0].text);
process.on("exit", () => {
	try {
		unlinkSync(modulePath.pathname);
	} catch {
		// already gone
	}
});

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const ui = await import(modulePath.href);
// Relative-time formatting follows the active locale. Pin it so the suite
// asserts the English source under a non-English host locale too.
ui.setLocale("en");

const visible = (fragment) =>
	fragment
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const selfMember = {
	account_id: "acct_self",
	kind: "human",
	display_label: "Damian",
	role: "owner",
	state: "active",
};

const person = (patch = {}) => ({
	account_id: "acct_bea",
	display_label: "Bea",
	role: "member",
	bridge_enabled: true,
	bridge_state: "active",
	...patch,
});

const conversation = (patch = {}) => ({
	id: "bcv_dm_bea",
	tenant_id: "tnt_1",
	kind: "dm",
	name: "",
	visibility: "private",
	agent_capable: false,
	status: "open",
	created_by: "acct_self",
	last_message_at: "2026-10-19T10:00:00Z",
	latest_seq: 2,
	members: [
		selfMember,
		{
			account_id: "acct_bea",
			kind: "human",
			display_label: "Bea",
			role: "member",
			state: "active",
		},
	],
	last_read_seq: 0,
	unread_count: 0,
	muted: false,
	...patch,
});

const viewProps = (patch = {}) => ({
	selfAccountId: "acct_self",
	conversations: [],
	selected: null,
	messages: [],
	organizations: [
		{ tenantId: "tnt_1", name: "Minerva", role: "owner", unread: 0 },
	],
	scope: "tnt_1",
	totalUnread: 0,
	listState: "ready",
	messageState: "idle",
	people: [],
	peopleState: "ready",
	onSelect: () => {},
	onSend: () => {},
	onNewConversation: () => {},
	onRetry: () => {},
	onScopeChange: () => {},
	onJoin: () => {},
	onNotifyChange: () => {},
	onRetryPeople: () => {},
	onComposeToPerson: () => {},
	...patch,
});

const { TeamBridgePageView } = ui;

// ---------------------------------------------------------------------------
// Row state
// ---------------------------------------------------------------------------

test("a person row is self, openable, paused or inert from the frozen pairs", () => {
	// Self wins over every bridge state: the account's own row is never a
	// control, even when its bridge is active.
	assert.equal(model.personRowState(person(), "acct_self"), "openable");
	assert.equal(
		model.personRowState(person({ account_id: "acct_self" }), "acct_self"),
		"self",
	);
	assert.equal(
		model.personRowState(
			person({ account_id: "acct_self", bridge_state: "disabled" }),
			"acct_self",
		),
		"self",
	);

	assert.equal(model.personRowState(person(), "acct_self"), "openable");
	assert.equal(
		model.personRowState(person({ bridge_state: "paused" }), "acct_self"),
		"paused",
	);

	// The two unreachable states, and the inconsistent pairs that must fail
	// closed rather than painting a dead row as live.
	for (const bridge_state of ["none", "disabled"]) {
		assert.equal(
			model.personRowState(person({ bridge_state }), "acct_self"),
			"unavailable",
			`${bridge_state} is not openable`,
		);
	}
	assert.equal(
		model.personRowState(
			person({ bridge_state: "none", bridge_enabled: true }),
			"acct_self",
		),
		"unavailable",
		"enabled beside none is not reachable",
	);
	assert.equal(
		model.personRowState(
			person({ bridge_state: "active", bridge_enabled: false }),
			"acct_self",
		),
		"unavailable",
		"active beside disabled is not reachable",
	);
});

test("a role earns a badge only when it tells the reader something", () => {
	assert.equal(model.showsPersonRole("owner"), true);
	assert.equal(model.showsPersonRole("admin"), true);
	assert.equal(model.showsPersonRole("member"), false);
	assert.equal(model.showsPersonRole("auditor"), false);
});

test("the person initial is the label's first character, never empty", () => {
	assert.equal(model.personInitial("Bea"), "B");
	assert.equal(model.personInitial("  ada"), "A");
	assert.equal(model.personInitial("   "), "?");
});

// ---------------------------------------------------------------------------
// DM resolution
// ---------------------------------------------------------------------------

test("a row opens the existing DM with that person, and only a DM", () => {
	const dm = conversation();
	const group = conversation({
		id: "bcv_group",
		kind: "group",
		members: [...dm.members],
	});
	assert.equal(model.dmWithPerson([dm], "acct_bea", "acct_self")?.id, dm.id);
	// A group containing the same person is not their DM.
	assert.equal(model.dmWithPerson([group], "acct_bea", "acct_self"), null);
	// A DM with a different person is not this row's.
	assert.equal(model.dmWithPerson([dm], "acct_cy", "acct_self"), null);
});

test("a DM must include the reader when the reader is known", () => {
	const otherDm = conversation({
		id: "bcv_dm_other",
		members: [
			{
				account_id: "acct_bea",
				kind: "human",
				display_label: "Bea",
				role: "member",
				state: "active",
			},
			{
				account_id: "acct_cy",
				kind: "human",
				display_label: "Cy",
				role: "member",
				state: "active",
			},
		],
	});
	assert.equal(model.dmWithPerson([otherDm], "acct_bea", "acct_self"), null);
	// Without an identity yet (first paint), membership of the target is the
	// only fact available; the view still refuses a row it cannot place.
	assert.equal(
		model.dmWithPerson([otherDm], "acct_bea", undefined)?.id,
		otherDm.id,
	);
});

test("several DMs with the same person resolve to the most recently active", () => {
	const oldDm = conversation({
		id: "bcv_dm_old",
		last_message_at: "2026-10-01T10:00:00Z",
	});
	const newDm = conversation({
		id: "bcv_dm_new",
		last_message_at: "2026-10-19T12:00:00Z",
	});
	assert.equal(
		model.dmWithPerson([oldDm, newDm], "acct_bea", "acct_self")?.id,
		newDm.id,
	);
	assert.equal(
		model.dmWithPerson([newDm, oldDm], "acct_bea", "acct_self")?.id,
		newDm.id,
	);
});

test("an archived DM is history the row does not reopen", () => {
	const archived = conversation({ status: "archived" });
	assert.equal(model.dmWithPerson([archived], "acct_bea", "acct_self"), null);
});

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

const status = (patch = {}) => ({
	state: "ready",
	surface_state: "B",
	update_required: false,
	...patch,
});

test("one status payload maps onto the plan and sign-in gates", () => {
	assert.equal(
		model.teamBridgeEligibility(status({ state: "signed_out" })),
		"signed_out",
	);
	assert.equal(
		model.teamBridgeEligibility(status({ state: "update_required" })),
		"update_required",
	);
	assert.equal(
		model.teamBridgeEligibility(status({ update_required: true })),
		"update_required",
		"the flag alone is enough",
	);
	assert.equal(
		model.teamBridgeEligibility(status({ state: "unavailable" })),
		"unavailable",
	);
	assert.equal(
		model.teamBridgeEligibility(status({ surface_state: "A" })),
		"plan_required",
	);
});

test("a ready surface, an unasked boundary or no answer yet is eligible", () => {
	for (const surface_state of ["B", "C", "D", "E", "F", "G", null]) {
		assert.equal(
			model.teamBridgeEligibility(status({ surface_state })),
			null,
			`surface ${surface_state} must stay eligible`,
		);
	}
	assert.equal(model.teamBridgeEligibility(null), null);
	assert.equal(model.teamBridgeEligibility(undefined), null);
});

// ---------------------------------------------------------------------------
// View: the People section
// ---------------------------------------------------------------------------

test("people render with self, paused and inert states at the rail's rhythm", () => {
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				people: [
					person({
						account_id: "acct_self",
						display_label: "Damian",
						role: "owner",
					}),
					person({ display_label: "Bea", role: "owner" }),
					person({
						account_id: "acct_cy",
						display_label: "Cy",
						bridge_state: "paused",
					}),
					person({
						account_id: "acct_dee",
						display_label: "Dee",
						bridge_enabled: false,
						bridge_state: "disabled",
					}),
				],
			}),
		),
	);

	assert.match(html, /People/);
	// Self is the account's own row and is not a button.
	assert.match(html, />You</);
	assert.doesNotMatch(html, /Message Damian/);
	// A reachable person opens a DM (the existing one is selected by the view
	// only on click; here the accessible name states the action).
	assert.match(html, /aria-label="Message Bea"/);
	assert.match(html, /aria-label="Message Cy, paused"/);
	assert.match(html, />Paused</);
	// The inert row explains itself rather than doing nothing silently.
	assert.match(html, /Hasn’t turned on Team Bridge yet/);
	assert.match(html, /aria-disabled="true"/);
	assert.match(html, /aria-describedby="[^"]+"/);
	// A paused row is still a control; an inert row is not styled as one.
	assert.match(html, /Message Cy, paused/);
});

test("a person row waits for the conversation list before it can start a DM", () => {
	/*
	 * ROUND-1 U-2. An unresolved list cannot say whether a DM already exists, so
	 * a click must not fall through to the create flow and duplicate it. The row
	 * is a labelled, inert statement until the list answers; a ready list beside
	 * the same fixtures gives the row its action back.
	 */
	const bea = person({ display_label: "Bea" });
	const dm = conversation();
	const ready = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				people: [bea],
				conversations: [dm],
				listState: "ready",
			}),
		),
	);
	assert.match(ready, /aria-label="Message Bea"/);

	for (const listState of ["loading", "error"]) {
		const html = renderToStaticMarkup(
			createElement(
				TeamBridgePageView,
				viewProps({
					people: [bea],
					conversations: [dm],
					listState,
				}),
			),
		);
		assert.doesNotMatch(
			html,
			/Message Bea/,
			`a ${listState} list must not offer a compose that could duplicate a DM`,
		);
		assert.match(html, /aria-disabled="true"/);
		assert.match(
			html,
			listState === "loading"
				? /Conversations are still loading\./
				: /Conversations could not be loaded/,
		);
	}
});

test("the viewer's own row is never offered as a message before identity answers", () => {
	// ROUND-1 U-4: without the account id the rail cannot tell self from a
	// colleague, so no row is a control and nothing says "Message Damian".
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				selfAccountId: undefined,
				people: [
					person({
						account_id: "acct_self",
						display_label: "Damian",
						role: "owner",
					}),
				],
			}),
		),
	);
	assert.doesNotMatch(html, /Message Damian/);
	assert.doesNotMatch(html, />You</);
	assert.match(html, /Finding your account/);
});

test("surface F withholds writes but still opens an existing DM", () => {
	// ROUND-1 U-5: read_only disables New conversation and the composer; a
	// person with an existing DM stays openable because opening is a read.
	const bea = person({ display_label: "Bea" });
	const dm = conversation();
	const noDm = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({ readOnly: true, people: [bea] }),
		),
	);
	assert.match(noDm, /This organization is read-only\./);
	assert.doesNotMatch(noDm, /Message Bea/);
	assert.match(
		noDm,
		/Read-only: a new conversation can’t be started right now\./,
	);
	assert.match(
		noDm,
		/aria-label="New conversation"[^>]*aria-disabled="true"|aria-disabled="true"[^>]*aria-label="New conversation"/,
	);

	const withDm = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				readOnly: true,
				selected: dm,
				conversations: [dm],
				messageState: "ready",
				people: [bea],
			}),
		),
	);
	assert.doesNotMatch(withDm, /Message this conversation/);
	assert.match(
		withDm,
		/This organization is read-only right now, so messages can’t be sent\./,
	);
	assert.match(withDm, /aria-label="Message Bea"/);
});

test("surface F withholds Join and the conversation menu", () => {
	/*
	 * ROUND-2 MINOR-1. The composer is not the only write beside a thread: Join
	 * posts a membership and the overflow menu writes a notification preference.
	 * Both are gated on the same read_only fact; the preview keeps its reason,
	 * and a writable conversation keeps its menu so the gate is not a blanket
	 * removal.
	 */
	const preview = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				readOnly: true,
				selected: conversation({ discoverable: true, member: false }),
			}),
		),
	);
	assert.match(preview, /You’re previewing this channel\./);
	assert.doesNotMatch(preview, />Join</);
	assert.match(preview, /This organization is read-only\./);

	const member = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({ readOnly: true, selected: conversation() }),
		),
	);
	assert.doesNotMatch(member, /Conversation options/);

	const writable = renderToStaticMarkup(
		createElement(TeamBridgePageView, viewProps({ selected: conversation() })),
	);
	assert.match(writable, /Conversation options/);
});

test("an unanswered gate holds the page and draws no conversation chrome", () => {
	// ROUND-1 U-6: the first paint is held until the status answers, and the
	// container disables the read set in the same state.
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				gatePending: true,
				conversations: [conversation()],
				people: [person()],
			}),
		),
	);
	assert.match(html, /Checking Team Bridge/);
	assert.doesNotMatch(html, /data-conversation-id/);
	assert.doesNotMatch(html, /People<\/h2>/);
});

test("the People heading is an h2 under the page's h1", () => {
	// ROUND-1 U-7: the sr-only page h1 had no h2 before the section's h3.
	const html = renderToStaticMarkup(
		createElement(TeamBridgePageView, viewProps({ people: [person()] })),
	);
	assert.match(html, /<h2 id="team-bridge-people-heading"/);
	assert.doesNotMatch(html, /<h3[^>]*team-bridge-people-heading/);
});

test("a directory failure is stated in the rail and does not blank the list", () => {
	const dm = conversation({ name: "" });
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				conversations: [dm],
				peopleState: "error",
			}),
		),
	);
	assert.match(html, /People could not be loaded/);
	assert.match(html, /Try again/);
	// The conversation row above it is still rendered: the two reads are
	// independent, which is the whole reason the directory has its own state.
	assert.match(html, /data-conversation-id="bcv_dm_bea"/);
	assert.match(html, /Bea/);
});

test("the directory schema accepts an empty or long label instead of failing the whole roster", () => {
	// The hub keeps a membership row when its account was deleted between the
	// membership and account reads, and the row's label is then empty; names and
	// email fallbacks can also exceed the old 64-character cap. Either one used to
	// throw in the array parse, which the page reports as "People could not be
	// loaded" for every member.
	const parsed = model.teamBridgeDirectorySchema.parse({
		members: [
			{
				account_id: "acct_deleted",
				display_label: "",
				role: "member",
				bridge_enabled: false,
				bridge_state: "none",
			},
			{
				account_id: "acct_long",
				display_label: `${"A".repeat(120)} <long@example.com>`,
				role: "member",
				bridge_enabled: false,
				bridge_state: "none",
			},
			{
				// A future field value this client has not learned. The row is
				// salvaged into the inert state rather than hidden.
				account_id: "acct_unrecognized",
				display_label: "Future",
				role: "member",
				bridge_enabled: false,
				bridge_state: "unknown-state",
			},
			{
				// No stable account id: genuinely unrenderable, and counted.
				display_label: "No id",
			},
		],
	});
	assert.equal(parsed.members.length, 3);
	assert.equal(parsed.unavailable_count, 1);
	assert.equal(parsed.members[2].bridge_state, "none");
	assert.equal(model.personDisplayLabel(parsed.members[0]), "acct_deleted");
	assert.match(
		model.personDisplayLabel(parsed.members[1]),
		/long@example\.com/,
	);
});

test("a payload whose every row is unrenderable says so, not 'nobody joined'", () => {
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				people: [],
				peopleState: "ready",
				peopleIncomplete: true,
			}),
		),
	);
	assert.match(html, /People could not be loaded/);
	assert.doesNotMatch(html, /No one else has joined/);
});

test("the row time moves to the header and a relative+absolute tooltip", () => {
	const channel = conversation({
		id: "bcv_channel_long",
		kind: "channel",
		name: "a-very-long-channel-name-that-would-crowd-the-row-at-narrow-width",
		last_message_at: new Date(Date.now() - 10 * 60 * 60_000).toISOString(),
	});
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				conversations: [channel],
				selected: channel,
				messages: [],
			}),
		),
	);
	const row = html.match(
		/<button[^>]*data-conversation-id="bcv_channel_long"[\s\S]*?<\/button>/,
	)?.[0];
	const header = html
		.match(/<header[^>]*flex h-11[^>]*>[\s\S]*?<\/header>/g)
		?.at(-1);
	assert.ok(row, "row rendered");
	assert.ok(header, "header rendered");
	const visible = (fragment) =>
		fragment
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	// The row still carries the name and its relative+absolute tooltip, but the
	// visible row text has no timestamp to clip at the edge.
	assert.match(visible(row), /a-very-long-channel-name/);
	assert.doesNotMatch(visible(row), /10 hours ago/);
	assert.match(row, /title="10 hours ago · [^"]+"/);
	// The selected header carries the relative time for every surface, including
	// touch where a hover tooltip does not exist.
	assert.match(visible(header), /10 hours ago/);
});

test("the merged row also keeps its visible time out of the row", () => {
	const channel = conversation({
		id: "bcv_channel_merged",
		kind: "channel",
		name: "a-very-long-channel-name",
		last_message_at: new Date(Date.now() - 10 * 60 * 60_000).toISOString(),
	});
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				scope: "all",
				totalUnread: 0,
				organizations: [
					{ tenantId: "tnt_1", name: "Minerva", role: "owner", unread: 0 },
				],
				conversations: [channel],
				selected: channel,
				messages: [],
			}),
		),
	);
	const row = html.match(
		/<button[^>]*data-conversation-id="bcv_channel_merged"[\s\S]*?<\/button>/,
	)?.[0];
	const header = html
		.match(/<header[^>]*flex h-11[^>]*>[\s\S]*?<\/header>/g)
		?.at(-1);
	assert.ok(row, "merged row rendered");
	assert.ok(header, "merged header rendered");
	const visible = (fragment) =>
		fragment
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	assert.doesNotMatch(visible(row), /10 hours ago/);
	assert.match(visible(header), /10 hours ago/);
	assert.match(visible(row), /Minerva/);
});

test("a local 422 is named as a validation cause, not an outdated client", () => {
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				peopleState: "error",
				peopleError: {
					status: 422,
					code: "invalid_request",
					message: "tenant_id was not in a shape this client accepts",
				},
			}),
		),
	);
	assert.match(html, /tenant_id was not in a shape this client accepts/);
	assert.doesNotMatch(html, /needs a newer version of Radient/);
	assert.doesNotMatch(html, /Try again/);
});

test("a signed-out directory failure names sign-in and offers no retry", () => {
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				peopleState: "error",
				peopleError: { status: 401 },
			}),
		),
	);
	assert.match(html, /People could not be loaded/);
	assert.match(html, /Sign in to use Team Bridge/);
	assert.doesNotMatch(html, /Try again/);
});

test("a plan refusal names the plan instead of offering a retry", () => {
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				peopleState: "error",
				peopleError: { status: 403, code: "bridge_not_available" },
			}),
		),
	);
	assert.match(html, /does not include Team Bridge/);
	assert.doesNotMatch(html, /Try again/);
});

test("a transport failure keeps Try again and says the service is unavailable", () => {
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				peopleState: "error",
				peopleError: { status: null },
			}),
		),
	);
	assert.match(html, /not available right now/);
	assert.match(html, /Try again/);
});

test("people loading is announced without displacing the conversation list", () => {
	const dm = conversation();
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				conversations: [dm],
				peopleState: "loading",
			}),
		),
	);
	assert.match(html, /aria-label="Loading people"|Loading people/);
	assert.match(html, /data-conversation-id="bcv_dm_bea"/);
});

test("the merged scope explains why it has no People list and queries none", () => {
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				scope: "all",
				people: [person()],
			}),
		),
	);
	assert.match(html, /Choose an organization to see its people/);
	assert.doesNotMatch(html, /Message Bea/);
});

test("an empty roster says so instead of rendering a blank section", () => {
	const html = renderToStaticMarkup(
		createElement(TeamBridgePageView, viewProps({ people: [] })),
	);
	assert.match(html, /No one else has joined this organization yet/);
});

// ---------------------------------------------------------------------------
// View: the eligibility gate
// ---------------------------------------------------------------------------

test("a plan gate names the plan and the value, and draws no conversation chrome", () => {
	const dm = conversation();
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				eligibility: "plan_required",
				conversations: [dm],
				organizations: [
					{ tenantId: "tnt_1", name: "Minerva", role: "owner", unread: 0 },
				],
				people: [person()],
			}),
		),
	);
	assert.match(html, /Team Bridge requires a Radient Team plan/);
	assert.match(
		html,
		/Communicate with your team members and their agents, and let agents collaborate with other agents in your organization\./,
	);
	assert.match(html, /This organization’s plan does not include Team Bridge\./);
	// No rail, no thread, no people: every one of those affordances would be
	// refused on this account.
	assert.doesNotMatch(html, /data-conversation-id/);
	assert.doesNotMatch(html, /New conversation/);
	assert.doesNotMatch(html, /Message Bea/);
	assert.doesNotMatch(html, /People<\/h2>/);
});

test("signed out says sign in; update and unavailable name their own reasons", () => {
	const signedOut = renderToStaticMarkup(
		createElement(TeamBridgePageView, viewProps({ eligibility: "signed_out" })),
	);
	assert.match(signedOut, /Sign in to Radient/);
	assert.match(signedOut, /You’re signed out\. Sign in to use Team Bridge\./);

	const update = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({ eligibility: "update_required" }),
		),
	);
	assert.match(update, /Update to use Team Bridge/);
	assert.match(update, /Team Bridge needs a newer version of Radient\./);

	const unavailable = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({ eligibility: "unavailable" }),
		),
	);
	assert.match(unavailable, /Team Bridge is unavailable/);
	assert.match(
		unavailable,
		/The service is not available right now\. Try again later\./,
	);
});

test("the panel is importable on its own for the story and page mounts", () => {
	const html = renderToStaticMarkup(
		createElement(ui.TeamBridgeEligibilityPanel, { reason: "plan_required" }),
	);
	assert.match(html, /Team Bridge requires a Radient Team plan/);
	// No fake controls: there is not a single button in the panel.
	assert.doesNotMatch(html, /<button/);
});

// ---------------------------------------------------------------------------
// Source wiring
// ---------------------------------------------------------------------------

test("the page reads the directory per tenant and the status once through the new ops", () => {
	const source = readFileSync(
		"src/renderer/src/features/team-bridge/team-bridge-page.tsx",
		"utf8",
	);
	assert.match(source, /useTeamBridgeDirectory\(/);
	assert.match(
		source,
		/scope === TEAM_BRIDGE_ALL_SCOPE \? null : scope/,
		"the merged scope must not request a roster",
	);
	assert.match(source, /useTeamBridgeStatus\(/);
	assert.match(source, /eligibility=\{eligibility\}/);
});

test("the client maps both ops onto the frozen request shapes", () => {
	const source = readFileSync(
		"src/renderer/src/shared/api/local-operator/team-bridge-api.ts",
		"utf8",
	);
	assert.match(source, /op: "team_bridge\.directory"/);
	assert.match(source, /tenant_id: tenantId/);
	assert.match(source, /op: "team_bridge\.status"/);
	assert.match(source, /teamBridgeDirectorySchema\.parse/);
	assert.match(source, /agentMessagesStatusSchema\.parse/);
});
