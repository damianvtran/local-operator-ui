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

/*
 * THE RAIL'S ONE IMPORT FROM THE CHAT SIDEBAR IS ITS SELECTED-ROW ROLE.
 * `team-bridge-rail.tsx` imports `rowCurrent` from `chat-sidebar.tsx` so the
 * selected person/channel paints the one role every sidebar shares (the
 * selection guard in `scripts/chat-sidebar-selection.test.mjs` asserts that).
 * That module drags MUI and the whole chat tree into a node bundle, which
 * cannot load MUI's directory imports; the stub exports the SAME literal, read
 * from the shipped source, so these tests render the real class string without
 * the chat sidebar's dependency weight.
 */
const chatSidebarSource = readFileSync(
	`${process.cwd()}/src/renderer/src/features/chat/components/chat-sidebar.tsx`,
	"utf8",
);
const rowCurrentLiteral = chatSidebarSource.match(
	/export const rowCurrent =\s*("[^"]+")/,
)?.[1];
if (!rowCurrentLiteral)
	throw new Error("rowCurrent literal not found in chat-sidebar.tsx");
const chatSidebarStub = {
	name: "chat-sidebar-stub",
	setup(pluginBuild) {
		pluginBuild.onResolve(
			{ filter: /chat\/components\/chat-sidebar$/ },
			() => ({
				path: "chat-sidebar-stub",
				namespace: "stub",
			}),
		);
		pluginBuild.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
			contents: `export const rowCurrent = ${rowCurrentLiteral};`,
			loader: "js",
		}));
	},
};

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
			export { TeamBridgePageView, TeamBridgeEligibilityPanel, profileMessageTarget } from "./src/renderer/src/features/team-bridge/team-bridge-page";
			export { setLocale, t } from "./src/i18n";
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
	plugins: [chatSidebarStub],
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
const { renderToStaticMarkup: renderMarkup } = await import("react-dom/server");
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);
// Directory avatars use the signed-in authority cache, just as in the app shell.
const renderToStaticMarkup = (element) =>
	renderMarkup(
		createElement(QueryClientProvider, { client: new QueryClient() }, element),
	);
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
	target: null,
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
	onTarget: () => {},
	onSend: () => {},
	onNewChannel: () => {},
	onRetry: () => {},
	onScopeChange: () => {},
	onJoin: () => {},
	onNotifyChange: () => {},
	onRetryPeople: () => {},
	...patch,
	/*
	 * The view selects by TARGET and resolves the conversation from the list,
	 * so a fixture that names the selected conversation must also list it.
	 */
	...(patch.selectedConversation
		? {
				target: { type: "conversation", id: patch.selectedConversation.id },
				conversations: patch.conversations?.some(
					(row) => row.id === patch.selectedConversation.id,
				)
					? patch.conversations
					: [...(patch.conversations ?? []), patch.selectedConversation],
			}
		: {}),
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
// The held thread surface (review round 4, M1, re-pointed)
// ---------------------------------------------------------------------------

/*
 * The page's `labelFor` is tenant-scoped and nullable (the "Member" placeholder
 * fix, #1296): `labelFor(sender, tenantId)` is `null` when nothing names the
 * sender. The thread pane was once handed that function directly, which
 * compiled and rendered every pane sender as "Unknown person"; the page now
 * passes `(sender) => labelFor(sender, thread.tenantId)`.
 *
 * THAT RENDER PATH IS HELD IN THIS BUILD. `teamBridgeThreadsAvailable` is false
 * whatever the runtime advertises (`team-bridge-thread-gate.ts`), so the page
 * with a `threadLink` renders NO pane and NO reply affordance - even with the
 * capability answering `enabled`, which is the case this test uses. What is
 * left to pin is the hold at the real view plus the tenant-scoped wiring in
 * source, which is what the feature returns on. The pane's own sender naming is
 * unreachable until the constant flips; asserting it here would be an assertion
 * about a surface no build mounts.
 */
test("the held page mounts no thread pane or reply affordance, and keeps the tenant-scoped label wiring", async () => {
	const { QueryClient, QueryClientProvider } = await import(
		"@tanstack/react-query"
	);
	const dm = conversation();
	const rootMessage = {
		id: "bmsg_pane_root",
		conversation_id: dm.id,
		seq: 1,
		sender: { account_id: "acct_bea", kind: "human", display_label: "Member" },
		body: "Thread root body",
		origin: "human",
		created_at: "2026-10-19T10:00:00Z",
		reply_count: 1,
	};
	const render = (threadsCapabilityState) =>
		renderToStaticMarkup(
			createElement(
				QueryClientProvider,
				{ client: new QueryClient() },
				createElement(
					TeamBridgePageView,
					viewProps({
						selectedConversation: dm,
						messages: [rootMessage],
						messageState: "ready",
						scope: "all",
						directories: { tnt_1: [person({ display_label: "Bea" })] },
						...(threadsCapabilityState === undefined
							? {}
							: { threadsCapabilityState }),
						threadLink: {
							tenantId: dm.tenant_id,
							conversationId: dm.id,
							rootId: "bmsg_pane_root",
						},
					}),
				),
			),
		);
	// EVERY capability answer is held, `enabled` included: an absent prop is the
	// "no capabilities read" mount and must behave like `unknown`.
	for (const state of [
		undefined,
		"unknown",
		"below-version",
		"unpaired",
		"enabled",
	]) {
		const html = render(state);
		const label = state ?? "absent";
		// The timeline itself still renders; only the thread lane is withheld.
		assert.match(html, /Thread root body/, `${label}: timeline`);
		assert.doesNotMatch(html, /aria-label="Thread"/, `${label}: pane`);
		assert.doesNotMatch(html, /Reply in thread/, `${label}: reply`);
	}
	const pageSource = readFileSync(
		"src/renderer/src/features/team-bridge/team-bridge-page.tsx",
		"utf8",
	);
	assert.match(
		pageSource,
		/labelFor\(sender, threadSelection\.tenantId\)/,
		"the pane's tenant-scoped label wiring must survive for the return",
	);
	assert.match(
		pageSource,
		/teamBridgeThreadsAvailable\(threadsCapabilityState\)/,
		"the page must derive the hold from the capability state",
	);
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
	// The reader's own row names them and opens a profile, not a DM.
	assert.match(html, /Damian \(you\)/);
	assert.doesNotMatch(html, /Message Damian/);
	// A reachable person's row is their DM; a paused one says so on the row.
	// The row keeps its own "Message {name}" name: since 2026-10-26 it anchors
	// the profile card without being its trigger (a click opens the DM).
	assert.match(
		html,
		new RegExp(
			`aria-label="${ui.t("ui.teamBridge.people.message", { name: "Bea" })}"`,
		),
	);
	assert.match(
		html,
		new RegExp(
			`aria-label="${ui.t("ui.teamBridge.people.message", { name: "Cy" })}"`,
		),
	);
	assert.match(html, />Paused</);
	// A bridge-off person is listed, inert, and explains why.
	assert.match(html, /Hasn’t turned on Team Bridge yet/);
	assert.match(html, /aria-disabled="true"/);
	assert.match(html, /aria-describedby="[^"]+"/);
});

test("a person row is the DM: no separate conversation row, and selecting needs no list", () => {
	/*
	 * OPERATOR REVIEW 2026-10-21. A DM with Bea is drawn ON Bea's People row (with
	 * its unread count) and nowhere else; there is no "@ Bea" row above People.
	 * Selecting Bea is safe while the list loads because nothing is created on
	 * click any more: the draft is created by the first send, find-or-create.
	 */
	const bea = person({ display_label: "Bea" });
	const dm = conversation({ unread_count: 2 });
	const ready = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({ people: [bea], conversations: [dm], listState: "ready" }),
		),
	);
	assert.match(
		ready,
		new RegExp(
			`aria-label="${ui.t("ui.teamBridge.people.message", { name: "Bea" })}"`,
		),
	);
	assert.doesNotMatch(ready, new RegExp(`data-conversation-id="${dm.id}"`));
	assert.match(ready, /aria-label="2 unread"/);
	for (const listState of ["loading", "error"]) {
		const html = renderToStaticMarkup(
			createElement(
				TeamBridgePageView,
				viewProps({ people: [bea], conversations: [dm], listState }),
			),
		);
		assert.match(
			html,
			new RegExp(
				`aria-label="${ui.t("ui.teamBridge.people.message", { name: "Bea" })}"`,
			),
			`${listState} list keeps the row`,
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
	// ROUND-1 U-5: read_only withholds creation and the composer; opening a DM
	// is a read, so a person with history stays selectable.
	const bea = person({ display_label: "Bea" });
	const dm = conversation();
	const noDm = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({ readOnly: true, people: [bea] }),
		),
	);
	assert.match(
		noDm,
		/aria-label="New message"[^>]*aria-disabled="true"|aria-disabled="true"[^>]*aria-label="New message"/,
	);
	assert.match(noDm, /No channels yet\./);
	assert.doesNotMatch(noDm, /Create one/);

	const withDm = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				readOnly: true,
				target: { type: "person", accountId: bea.account_id },
				conversations: [dm],
				messageState: "ready",
				people: [bea],
			}),
		),
	);
	assert.match(
		withDm,
		/This organization is read-only right now, so messages can’t be sent\./,
	);
	assert.doesNotMatch(withDm, /<textarea/);
	assert.match(
		withDm,
		new RegExp(
			`aria-label="${ui.t("ui.teamBridge.people.message", { name: "Bea" })}"`,
		),
	);
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
				selectedConversation: conversation({
					discoverable: true,
					member: false,
				}),
			}),
		),
	);
	assert.match(preview, /You’re previewing this channel\./);
	assert.doesNotMatch(preview, />Join</);
	assert.match(preview, /This organization is read-only\./);

	const member = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({ readOnly: true, selectedConversation: conversation() }),
		),
	);
	assert.doesNotMatch(member, /Conversation options/);

	const writable = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({ selectedConversation: conversation() }),
		),
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

test("the merged rail lists a hub tenant's rows when memberships are empty", () => {
	// F6 on #1314: the container builds organizations from the hub's status
	// tenants; an empty memberships read must not empty the rail or fall back
	// to "Unknown organization".
	const organizations = model.organizationOptions(
		[],
		[],
		[
			{
				tenant_id: "tnt_2",
				tenant_name: "Northwind Collective",
				eligible: true,
				endpoint: null,
			},
		],
	);
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				organizations,
				scope: "all",
				conversations: [
					conversation({ id: "bcv_t2", tenant_id: "tnt_2" }),
					conversation({ id: "bcv_t3", tenant_id: "tnt_3" }),
				],
			}),
		),
	);
	assert.match(html, /data-conversation-id="bcv_t2"/);
	assert.doesNotMatch(html, /data-conversation-id="bcv_t3"/);
	assert.match(visible(html), /Northwind Collective/);
	assert.doesNotMatch(visible(html), /Unknown organization/);
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
	const at = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
	const channel = conversation({
		id: "bcv_time",
		kind: "channel",
		name: "release-proof-0.84.2",
		last_message_at: at,
		latest_seq: 3,
	});
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({ selectedConversation: channel, messageState: "ready" }),
		),
	);
	const row = html.match(
		/<button[^>]*data-conversation-id="bcv_time"[\s\S]*?<\/button>/,
	)?.[0];
	const header = [...html.matchAll(/<header[\s\S]*?<\/header>/g)].at(-1)?.[0];
	assert.ok(row && header);
	assert.doesNotMatch(visible(row), /10 hours ago/);
	assert.match(row, /title="10 hours ago · [^"]+"/);
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
				target: { type: "conversation", id: channel.id },
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
	assert.doesNotMatch(visible(row), /10 hours ago/);
	assert.match(visible(header), /10 hours ago/);
	assert.match(visible(row), /Minerva/);
});

test("a chief of staff is listed by its current name and owner, and its DM is its row", () => {
	const ben = person({
		account_id: "acct_ben",
		display_label: "Ben",
		agent: { endpoint_id: "bep_ben", name: "Aida", state: "active" },
	});
	const agentDm = conversation({
		id: "bcv_dm_aida",
		kind: "dm",
		name: "",
		unread_count: 1,
		members: [
			selfMember,
			{
				account_id: "acct_ben",
				kind: "agent",
				display_label: "Member",
				role: "member",
				state: "active",
			},
		],
	});
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({ conversations: [agentDm], people: [ben] }),
		),
	);
	assert.match(html, /Chiefs of staff/);
	assert.match(html, /Aida \(Ben\)/);
	assert.match(html, /data-team-bridge-chief="acct_ben"/);
	// The DM lives on the chief's row, not as its own conversation row, and
	// Ben's PERSON row does not claim his agent's DM.
	assert.doesNotMatch(html, /data-conversation-id="bcv_dm_aida"/);
	const personRow = html.match(
		/<button[^>]*data-team-bridge-person="acct_ben"[\s\S]*?<\/button>/,
	)?.[0];
	assert.ok(personRow);
	assert.doesNotMatch(personRow, /unread/);
	// A stale stored label never reaches the screen when the directory knows better.
	assert.doesNotMatch(visible(html), /\bMember\b/);
});

test("every section keeps its header, and an empty one is the create action", () => {
	const html = renderToStaticMarkup(
		createElement(TeamBridgePageView, viewProps({ people: [] })),
	);
	for (const heading of ["Channels", "Groups", "People", "Chiefs of staff"]) {
		assert.match(html, new RegExp(`>${heading}<`));
	}
	assert.match(html, /<button[^>]*>No channels yet\. Create one<\/button>/);
	assert.match(html, /<button[^>]*>No groups yet\. Start one<\/button>/);
});

test("built-in channels lead the Channels section in a fixed order", () => {
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				conversations: [
					conversation({ id: "bcv_ops", kind: "channel", name: "ops" }),
					conversation({
						id: "bcv_agents",
						kind: "channel",
						name: "agents",
						builtin: "agents",
					}),
					conversation({
						id: "bcv_humans",
						kind: "channel",
						name: "humans",
						builtin: "humans",
					}),
				],
			}),
		),
	);
	const order = [...html.matchAll(/data-conversation-id="(bcv_[a-z]+)"/g)].map(
		(m) => m[1],
	);
	assert.deepEqual(order, ["bcv_humans", "bcv_agents", "bcv_ops"]);
});

test("a person with no DM opens an addressed draft and nothing is created", () => {
	const bea = person({ display_label: "Bea" });
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				people: [bea],
				target: { type: "person", accountId: bea.account_id },
			}),
		),
	);
	// Slack/Discord's empty-DM intro (design round 1, D5): the name, then one
	// line that never says "created" (that nothing is written yet is the code's
	// fact, asserted by the model's sendFirstMessage tests, not the copy's).
	assert.match(
		html,
		/This is the beginning of your direct message history with Bea\./,
	);
	assert.doesNotMatch(visible(html), /created/i);
	assert.match(html, /placeholder="Message Bea"/);
	assert.match(
		html,
		/aria-current="page"[^>]*data-team-bridge-person="acct_bea"|data-team-bridge-person="acct_bea"[^>]*aria-current="page"/,
	);
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

// ---------------------------------------------------------------------------
// View: sender names (the legacy "Member" label)
// ---------------------------------------------------------------------------

/*
 * OPERATOR REPORT 2026-10-22: every message, their own included, was signed
 * "Member" with an "M" avatar. The hub stored that placeholder as the label of
 * creators and self-joins, so these fixtures carry it exactly as prod rows do.
 */
const legacyThread = (conversationId) =>
	[
		["acct_self", "mine"],
		["acct_bea", "from bea"],
		["acct_gone", "from someone who left"],
	].map(([accountId, body], index) => ({
		id: `bcmsg_${index + 1}`,
		conversation_id: conversationId,
		seq: index + 1,
		// Ten minutes apart, so each message draws its own header and avatar.
		sender: { account_id: accountId, kind: "human", display_label: "Member" },
		body,
		origin: "human",
		created_at: new Date(Date.UTC(2026, 9, 19, 10, index * 10)).toISOString(),
	}));

const senderNames = (html) =>
	[...html.matchAll(/data-sender="[^"]*"[^>]*>([^<]*)</g)].map(
		(match) => match[1],
	);

test('a legacy "Member" sender is named from the directory, the identity, or an unknown placeholder', () => {
	const dm = conversation({
		members: [
			{ ...selfMember, display_label: "Member" },
			{ ...conversation().members[1], display_label: "Member" },
		],
	});
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				// The directory lists Bea but neither the reader nor the leaver.
				people: [person()],
				selfName: "Damian Tran",
				selectedConversation: dm,
				messages: legacyThread(dm.id),
				messageState: "ready",
			}),
		),
	);
	assert.deepEqual(senderNames(html), ["Damian Tran", "Bea", "Unknown person"]);
	// The unknown sender wears a neutral glyph, not the initial of a placeholder.
	assert.match(html, /data-sender-avatar="unknown"/);
	assert.doesNotMatch(visible(html), /\bMember\b/);
	assert.doesNotMatch(html, /data-sender-avatar="initial"[^>]*>U</);
});

test("the merged view names senders from the conversation's own organization directory", () => {
	const dm = conversation({
		members: [
			{ ...selfMember, display_label: "Member" },
			{ ...conversation().members[1], display_label: "Member" },
		],
	});
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				scope: "all",
				people: [],
				directories: { tnt_1: [person()] },
				selfName: "Damian Tran",
				selectedConversation: dm,
				messages: legacyThread(dm.id),
				messageState: "ready",
			}),
		),
	);
	assert.deepEqual(senderNames(html), ["Damian Tran", "Bea", "Unknown person"]);
	// The rail's DM row is titled from the same directory, not "Member".
	assert.match(html, /data-conversation-id="bcv_dm_bea"[\s\S]*?Bea/);
	assert.doesNotMatch(visible(html), /\bMember\b/);
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

test("server rendering does not depend on ambient browser storage", () => {
	const descriptor = Object.getOwnPropertyDescriptor(
		globalThis,
		"localStorage",
	);
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		get() {
			throw new Error("browser storage is unavailable during server rendering");
		},
	});
	try {
		const gate = renderToStaticMarkup(
			createElement(ui.TeamBridgePageView, viewProps({ gatePending: true })),
		);
		assert.ok(!gate.includes("team-bridge-channels-heading"));
		const eligible = renderToStaticMarkup(
			createElement(ui.TeamBridgePageView, viewProps()),
		);
		assert.ok(eligible.includes('id="team-bridge-people-heading"'));
	} finally {
		if (descriptor)
			Object.defineProperty(globalThis, "localStorage", descriptor);
		else Reflect.deleteProperty(globalThis, "localStorage");
	}
});

test("optional profiles preserve rune-limited names and reject unsafe avatars without losing people", () => {
	const profile = {
		display_name: "\u{20000}".repeat(64),
		title: "\u{20000}".repeat(80),
		description: "\u{20000}".repeat(500),
		pronouns: "\u{20000}".repeat(32),
		timezone: "UTC",
	};
	const parsed = model.teamBridgeDirectorySchema.parse({
		members: [
			{
				...selfMember,
				profile,
				avatar_url:
					"/v1/accounts/01234567-89AB-CDEF-0123-456789ABCDEF/avatar?v=0123456789abcdef",
			},
		],
	});
	assert.equal(parsed.members[0].profile.display_name, profile.display_name);
	assert.equal(
		parsed.members[0].avatar_url,
		"/v1/accounts/01234567-89AB-CDEF-0123-456789ABCDEF/avatar?v=0123456789abcdef",
	);
	const malformed = model.teamBridgeDirectorySchema.parse({
		members: [
			{
				...selfMember,
				profile: { title: 4 },
				avatar_url: "https://evil.example/avatar",
			},
		],
	});
	assert.equal(malformed.members.length, 1);
	assert.equal(malformed.members[0].avatar_url, undefined);
	assert.equal(malformed.members[0].profile.title, "");
});

test("profile Message scopes existing DMs and allows read-only history but not drafts", () => {
	const sender = { account_id: "bea", kind: "human", display_label: "Bea" };
	const dm = conversation({
		id: "dm-profile",
		tenant_id: "tenant-profile",
		members: [
			selfMember,
			{ ...person({ account_id: "bea" }), kind: "human", state: "active" },
		],
	});
	assert.deepEqual(
		ui.profileMessageTarget(
			sender,
			"tenant-profile",
			[dm],
			selfMember.account_id,
			true,
		),
		{ type: "conversation", id: dm.id },
	);
	assert.equal(
		ui.profileMessageTarget(
			sender,
			"other-tenant",
			[dm],
			selfMember.account_id,
			true,
		),
		null,
	);
	assert.deepEqual(
		ui.profileMessageTarget(
			sender,
			"other-tenant",
			[dm],
			selfMember.account_id,
			false,
		),
		{ type: "person", accountId: "bea" },
	);
});

test("avatar URL accepts legacy account ids and refuses path or escaped account ids", () => {
	const parse = (account) =>
		model.teamBridgeDirectorySchema.parse({
			members: [
				{
					...selfMember,
					avatar_url: `/v1/accounts/${account}/avatar?v=0123456789abcdef`,
				},
			],
		}).members[0].avatar_url;
	assert.equal(
		parse("acc_bea"),
		"/v1/accounts/acc_bea/avatar?v=0123456789abcdef",
	);
	for (const account of [
		"user%40example",
		"../acc_bea",
		"acc_bea/other",
		"acc_bea?x=1",
		"https://evil.example",
		"unknown-id",
	])
		assert.equal(parse(account), undefined);
});

test("profile Message selects the person/chief rail in one tenant and the exact DM in merged scope", () => {
	for (const kind of ["human", "agent"]) {
		const member = person({
			agent: { name: "Aida", endpoint_id: "ep_bea", state: "active" },
		});
		const sender = {
			account_id: member.account_id,
			kind,
			display_label: "Bea",
		};
		const dm = conversation({
			id: `dm-${kind}`,
			members: [selfMember, { ...sender, role: "member", state: "active" }],
		});
		const foreign = {
			...dm,
			id: `foreign-${kind}`,
			tenant_id: "tnt_other",
			last_message_at: "2099-01-01T00:00:00Z",
		};
		const target = ui.profileMessageTarget(
			sender,
			dm.tenant_id,
			[foreign, dm],
			selfMember.account_id,
			true,
			false,
		);
		assert.deepEqual(target, {
			type: kind === "agent" ? "chief" : "person",
			accountId: member.account_id,
		});
		assert.equal(
			model.targetConversation(target, [dm], selfMember.account_id)?.id,
			dm.id,
		);
		const html = renderToStaticMarkup(
			createElement(
				ui.TeamBridgePageView,
				viewProps({ target, conversations: [dm], people: [member] }),
			),
		);
		assert.match(
			html,
			new RegExp(
				`<button[^>]*aria-current="page"[^>]*data-team-bridge-${kind === "agent" ? "chief" : "person"}="${member.account_id}"`,
			),
		);
		const merged = ui.profileMessageTarget(
			sender,
			dm.tenant_id,
			[foreign, dm],
			selfMember.account_id,
			true,
			true,
		);
		assert.deepEqual(merged, { type: "conversation", id: dm.id });
		assert.equal(
			model.targetConversation(merged, [foreign, dm], selfMember.account_id)
				?.tenant_id,
			dm.tenant_id,
		);
	}
});
