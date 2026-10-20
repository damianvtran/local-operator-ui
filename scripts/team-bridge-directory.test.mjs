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
		contents: `export * from "./src/renderer/src/features/team-bridge/team-bridge-model";`,
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
	assert.doesNotMatch(html, /People<\/h3>/);
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
