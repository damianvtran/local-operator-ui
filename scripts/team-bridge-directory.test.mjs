import assert from "node:assert/strict";
import { readFileSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
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
			export { TeamBridgePageView, TeamBridgeEligibilityPanel, TeamBridgeRateLimitNote, profileMessageTarget } from "./src/renderer/src/features/team-bridge/team-bridge-page";
			export { setLocale, t } from "./src/i18n";
		`,
		resolveDir: ROOT,
		sourcefile: "team-bridge-directory.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	/*
	 * ONLY THE PACKAGES THE SUITE ITSELF IMPORTS STAY EXTERNAL. `packages:
	 * "external"` left the whole bare-import graph to node's ESM resolver, and the
	 * shared composer's chain reaches `@mui/material/styles` - a DIRECTORY import,
	 * which Node refuses ("Cannot find module .../styles"). Bundling everything the
	 * suite does not itself import keeps one React (the real identity check) while
	 * letting the app's own dependency graph resolve the way the app's bundler does.
	 */
	external: [
		"@tanstack/react-query",
		"react",
		"react-dom",
		"react-dom/server",
		"react-router-dom",
		"react/jsx-runtime",
	],
	jsx: "automatic",
	// Vite's `import.meta.env` is read at IMPORT time by the app's config loader,
	// which the shared composer's chain pulls in (`load-config.ts`): bundling for
	// node leaves it undefined and the module throws before a single assertion runs
	// (`browser-chrome.test.mjs` records the same trap). The URL is dead on purpose.
	define: { "import.meta.env": "__viteEnv" },
	/*
	 * BOTH SHIMS THE APP'S BUNDLER GIVES THE SAME MODULES. `__viteEnv` is Vite's
	 * `import.meta.env`; `require` is what a CJS dependency inside an ESM bundle
	 * needs (the composer's graph keeps one), resolved from THIS file the way the
	 * app resolves it. `agents-composer-mount.test.mjs` states the same recipe.
	 */
	banner: {
		js: 'const __viteEnv = {}; import { createRequire as __loCreateRequire } from "node:module"; const require = __loCreateRequire(import.meta.url);',
	},
	// The page mounts the SHARED composer now, which pulls the brand mark (.png).
	// Bundling it keeps these DOM/state probes on the real component tree; a
	// `dataurl` rather than a file keeps the harness asset-free.
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
		".ttf": "empty",
		".woff": "empty",
		".woff2": "empty",
		".eot": "empty",
	},
	plugins: [chatSidebarStub],
	alias: {
		"@shared": `${ROOT}/src/renderer/src/shared`,
		"@features": `${ROOT}/src/renderer/src/features`,
		// The shared composer imports the brand mark through this alias; it stayed
		// external under `packages: "external"`, so the first suite to bundle the
		// composer is the first to need it resolved.
		"@assets": `${ROOT}/src/renderer/src/assets`,
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
	for (const surface_state of ["B", "C", "D", "F", "G", null]) {
		assert.equal(
			model.teamBridgeEligibility(status({ surface_state })),
			null,
			`surface ${surface_state} must stay eligible`,
		);
	}
	assert.equal(model.teamBridgeEligibility(null), null);
	assert.equal(model.teamBridgeEligibility(undefined), null);
});

test("explicit endpoint/local off gates the page without reinterpreting runtime readonly", () => {
	for (const in_force of [false, true]) {
		const base = {
			default_on: { in_force, notice_pending: true },
			read_only: false,
		};
		for (const surface_state of ["C", "D"]) {
			assert.equal(
				model.teamBridgeEligibility(
					status({ ...base, surface_state, local: { enabled: true } }),
				),
				null,
				`active/paused, default-on=${in_force}`,
			);
			assert.equal(
				model.teamBridgeEligibility(
					status({ ...base, surface_state, local: { enabled: false } }),
				),
				"off_local",
				`local opt-out, default-on=${in_force}`,
			);
		}
		assert.equal(
			model.teamBridgeEligibility(
				status({ ...base, surface_state: "E", local: { enabled: false } }),
			),
			"off",
			"E is off even though runtime read_only is false",
		);
		assert.equal(
			model.teamBridgeEligibility(
				status({ ...base, surface_state: "E", local: { enabled: true } }),
			),
			"off",
			"disabled endpoint outranks stale local on",
		);
	}
	assert.equal(
		model.teamBridgeEligibility(
			status({
				surface_state: "F",
				read_only: true,
				local: { enabled: false },
			}),
		),
		null,
		"organization readonly keeps retained history",
	);
	assert.equal(
		model.teamBridgeEligibility(
			status({ surface_state: "B", local: { enabled: false } }),
		),
		null,
		"legacy opt-in on-ramp is unchanged",
	);
});

test("off page replaces composer and write controls with the Team Bridge off state and a way back", async () => {
	// The way back is a router <Link>, so this one render needs a router.
	const { MemoryRouter } = await import("react-router-dom");
	const html = renderToStaticMarkup(
		createElement(
			MemoryRouter,
			null,
			createElement(
				ui.TeamBridgePageView,
				viewProps({
					eligibility: "off",
					selectedConversation: conversation(),
					readOnly: false,
				}),
			),
		),
	);
	assert.match(html, /Team Bridge is off for this account/);
	assert.match(html, /conversations stay hidden until you turn it on again/);
	// Design round 1 D1: the product's own name, never the older noun.
	assert.doesNotMatch(html, /Agent messages/);
	// No dead end: one link to the Settings way-back control. It is
	// navigation (an <a>), never a button that opts in from this page.
	assert.equal(
		html.includes('href="/settings?setting=team_bridge.enabled"'),
		true,
		"off gate links to the Settings control that turns it back on",
	);
	assert.match(html, />Turn on in Settings</);
	assert.doesNotMatch(html, /<textarea|<button|role="(?:dialog|alertdialog)"/);
	assert.doesNotMatch(html, /Team Bridge requires|Enable/);
});

test("machine-only off names this machine, claims no consent step, and links to the switch (R2-2)", async () => {
	const { MemoryRouter } = await import("react-router-dom");
	const html = renderToStaticMarkup(
		createElement(
			MemoryRouter,
			null,
			createElement(
				ui.TeamBridgePageView,
				viewProps({
					eligibility: "off_local",
					selectedConversation: conversation(),
					readOnly: false,
				}),
			),
		),
	);
	assert.match(html, /Team Bridge is off on this machine/);
	assert.match(html, /Your account is still set up/);
	// The machine switch collects no consent; the account-level copy would lie.
	assert.equal(/consent/i.test(html), false, "no consent claim");
	assert.equal(/for this account/.test(html), false, "not the account copy");
	assert.equal(
		html.includes('href="/settings?setting=team_bridge.enabled"'),
		true,
		"links to the Settings control that clears it",
	);
	assert.doesNotMatch(html, /<textarea|<button|role="(?:dialog|alertdialog)"/);
	assert.doesNotMatch(html, /Enable/);
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
 * The real page proves the capability half: enabled mounts the thread and
 * reply affordance, while every unresolved or unsupported answer hides them.
 */
test("the page mounts its thread only for the enabled capability, with tenant-scoped labels", async () => {
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
	// An absent prop is the "no capabilities read" mount and behaves as unknown.
	for (const state of [
		undefined,
		"unknown",
		"below-version",
		"unpaired",
		"enabled",
	]) {
		const html = render(state);
		const label = state ?? "absent";
		assert.match(html, /Thread root body/, `${label}: timeline`);
		assert.equal(
			html.includes('aria-label="Thread"'),
			state === "enabled",
			`${label}: pane`,
		);
		assert.equal(
			html.includes("Reply in thread"),
			state === "enabled",
			`${label}: reply`,
		);
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
	/*
	 * The row's accessible name carries its unread count (design review round 3,
	 * D10): a person row's `aria-label` replaces its visible text, so without the
	 * count a screen reader heard only "Message Bea" on a row with 2 unread.
	 */
	const beaName = `${ui.t("ui.teamBridge.people.message", { name: "Bea" })} ${ui.t("ui.teamBridge.unread.count", { count: 2 })}`;
	assert.match(ready, new RegExp(`aria-label="${beaName}"`));
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
			new RegExp(`aria-label="${beaName}"`),
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

/*
 * THE TIME LIVES IN THE ROW'S TOOLTIP ONLY (Team Bridge visual refresh D8,
 * 2026-11-04). It used to be repeated in the channel header as "· 10 hours ago";
 * last-active time is the least useful fact a header can carry, so the header
 * dropped it and the tooltip is the one place it survives.
 */
test("the row time lives in a relative+absolute tooltip, not the row or the header", () => {
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
	assert.doesNotMatch(visible(header), /10 hours ago/);
	assert.match(visible(header), /release-proof-0\.84\.2/);
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
		.match(/<header[^>]*flex h-12[^>]*>[\s\S]*?<\/header>/g)
		?.at(-1);
	assert.ok(row, "merged row rendered");
	assert.ok(header, "merged header rendered");
	assert.doesNotMatch(visible(row), /10 hours ago/);
	assert.doesNotMatch(visible(header), /10 hours ago/);
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

test("the merged scope lists each organization's roster under its own header", () => {
	const html = renderToStaticMarkup(
		createElement(
			TeamBridgePageView,
			viewProps({
				scope: "all",
				/*
				 * The single-organization roster prop is NOT the union's source: only
				 * the per-organization reads are, so a stale `people` cannot colour it.
				 */
				people: [person({ display_label: "Stale Org" })],
				organizations: [
					{ tenantId: "tnt_1", name: "Minerva", role: "owner", unread: 0 },
					{
						tenantId: "tnt_2",
						name: "Northwind Log",
						role: "member",
						unread: 0,
					},
				],
				directories: {
					tnt_1: [person()],
					tnt_2: [person({ account_id: "acct_inez", display_label: "Inez" })],
				},
				directoryStates: { tnt_1: "ready", tnt_2: "ready" },
			}),
		),
	);
	/*
	 * THE OPERATOR'S REPORT, INVERTED. People used to say "Choose an organization
	 * to see its people." and every union account read that as the end of the
	 * road. Each organization's roster is now listed under a header naming it.
	 */
	assert.doesNotMatch(html, /Choose an organization to see its people/);
	assert.match(html, /<h3[^>]*>Minerva</);
	assert.match(html, /<h3[^>]*>Northwind Log</);
	assert.match(html, /Message Bea/);
	assert.match(html, /Message Inez/);
	assert.doesNotMatch(html, /Stale Org/);
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
	/*
	 * ONE DM IS ONE ROW. Bea's People row IS her DM, so the union no longer lists
	 * a second "@ Bea" conversation row beside it: the row that carries her name
	 * is the person row, and it opens that DM.
	 */
	assert.doesNotMatch(html, /data-conversation-id="bcv_dm_bea"/);
	assert.match(html, /data-team-bridge-person="acct_bea"/);
	// AND IT IS NAMED FROM THAT ORGANIZATION'S DIRECTORY (review round 1, m2):
	// the row's own accessible name carries the directory label, not "Member".
	assert.match(html, /aria-label="Message Bea"/);
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
	// The ACCOUNT's sentence (onboarding audit U2): this gate is also what an
	// account with no organization reads, so it never says "this organization".
	assert.match(
		html,
		/Your account isn’t in an organization on the Radient Team plan\./,
	);
	assert.doesNotMatch(html, /This organization’s plan/);
	// No rail, no thread, no people: every one of those affordances would be
	// refused on this account.
	assert.doesNotMatch(html, /data-conversation-id/);
	assert.doesNotMatch(html, /New conversation/);
	assert.doesNotMatch(html, /Message Bea/);
	assert.doesNotMatch(html, /People<\/h2>/);
});

test("signed out says sign in; update and unavailable name their own reasons", async () => {
	// The signed-out gate now carries a router <Link> to the sign-in control.
	const { MemoryRouter } = await import("react-router-dom");
	const signedOut = renderToStaticMarkup(
		createElement(
			MemoryRouter,
			null,
			createElement(
				TeamBridgePageView,
				viewProps({ eligibility: "signed_out" }),
			),
		),
	);
	assert.match(signedOut, /Sign in to Radient/);
	assert.match(signedOut, /You’re signed out\. Sign in to use Team Bridge\./);
	// No dead end (onboarding audit U3): one link to the settings section that
	// owns the sign-in control. Navigation, never a second sign-in on this page.
	assert.equal(
		signedOut.includes('href="/settings?section=radient"'),
		true,
		"the signed-out gate links to the Radient account section",
	);
	assert.match(signedOut, />Sign in to Radient</);
	assert.doesNotMatch(signedOut, /<button/);
	assert.doesNotMatch(signedOut, /See the Radient Team plan/);

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
	/*
	 * Exactly one control, and it is the route to the plan (onboarding audit
	 * U2): a gate that names a plan and offers no way to look at it is a dead
	 * end. One secondary button, no dialog, nothing styled as a purchase.
	 */
	assert.equal(html.match(/<button/g)?.length, 1, "one control, not several");
	assert.match(
		html,
		/<button[^>]*data-team-bridge-gate-action="see-plan"[^>]*>See the Radient Team plan<\/button>/,
	);
	assert.doesNotMatch(html, /bg-accent /, "the plan link is not a primary");
	assert.doesNotMatch(html, /role="(?:dialog|alertdialog)"/);
});

test("the plan link yields to the trial on-ramp once trial starts are enabled", () => {
	/*
	 * With `TEAM_TRIAL_START_ENABLED` on, the no-organization branch mounts the
	 * trial on-ramp, whose start/subscribe controls are the upgrade route. The
	 * panel is still what that on-ramp falls back to, and it must not put a
	 * second route beside them. The constant is false in this build, so the
	 * enabled state is rendered through the panel's own parameter.
	 */
	const enabled = renderToStaticMarkup(
		createElement(ui.TeamBridgeEligibilityPanel, {
			reason: "plan_required",
			trialStartEnabled: true,
		}),
	);
	assert.match(enabled, /Team Bridge requires a Radient Team plan/);
	assert.doesNotMatch(enabled, /<button/);
	assert.doesNotMatch(enabled, /See the Radient Team plan/);

	const disabled = renderToStaticMarkup(
		createElement(ui.TeamBridgeEligibilityPanel, {
			reason: "plan_required",
			trialStartEnabled: false,
		}),
	);
	assert.match(disabled, /See the Radient Team plan/);

	// The default follows the release constant, which is off in this build.
	const byDefault = renderToStaticMarkup(
		createElement(ui.TeamBridgeEligibilityPanel, { reason: "plan_required" }),
	);
	assert.equal(byDefault, disabled);
});

test("update_required and unavailable offer no control, in either trial state", () => {
	for (const reason of ["update_required", "unavailable"]) {
		for (const trialStartEnabled of [false, true]) {
			const html = renderToStaticMarkup(
				createElement(ui.TeamBridgeEligibilityPanel, {
					reason,
					trialStartEnabled,
				}),
			);
			assert.doesNotMatch(html, /<button|<a /, `${reason} has no remedy here`);
		}
	}
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

/*
 * THE AGENT'S OWN PICTURE AT THE BOUNDARY (agent review round 3, F7). F6 made
 * the directory schema reuse the resolver's route, but nothing tested that the
 * schema ACCEPTS what the hub serves: replacing the regex with a pattern that
 * matches nothing passed every suite, because the other avatar_url cases here
 * are account URLs and `identity-avatar.test.mjs` calls the resolver directly.
 * With `.catch(undefined)` on the field, that failure mode is a silently
 * missing picture, so the served route and the stale one are pinned together.
 */
test("the directory carries an agent's own picture only on the served endpoint route", () => {
	const hash = "0123456789abcdef";
	const withAgent = (avatar_url) => ({
		members: [
			{
				...selfMember,
				agent: {
					endpoint_id: "bep_aida",
					name: "Aida",
					state: "active",
					avatar_url,
				},
			},
		],
	});
	// The literal route agent-server's `BridgeEndpointAvatarPointer.AvatarURL`
	// builds (`/v1/messaging/endpoints/<id>/avatar?v=<hash>`), not a string
	// derived from the constant under test.
	const served = `/v1/messaging/endpoints/bep_aida/avatar?v=${hash}`;
	assert.equal(
		model.teamBridgeDirectorySchema.parse(withAgent(served)).members[0].agent
			?.avatar_url,
		served,
	);
	for (const stale of [
		`/v1/endpoints/bep_aida/avatar?v=${hash}`,
		`/v1/agent/endpoints/bep_aida/avatar?v=${hash}`,
		`/v1/messaging/endpoint/bep_aida/avatar?v=${hash}`,
		`/v1/messaging/endpoints/bep_aida/avatar?v=${hash.toUpperCase()}`,
		"/v1/messaging/endpoints/bep_aida/avatar",
		"https://evil.example/avatar",
		42,
	]) {
		const parsed = model.teamBridgeDirectorySchema.parse(withAgent(stale));
		// The row survives — a bad picture never costs a person their agent.
		assert.equal(parsed.members.length, 1);
		assert.equal(parsed.members[0].agent?.name, "Aida");
		assert.equal(parsed.members[0].agent?.avatar_url, undefined);
	}
});

// ---------------------------------------------------------------------------
// Rate limits (incident 2026-11-17): a throttle is "slowing down", never the
// hard "unavailable" screen, keeps a loaded page, and retries after its wait.
// ---------------------------------------------------------------------------

/** The runtime's status answer for the edge's 300 s per-address WAF block. */
const throttled = (patch = {}) =>
	status({
		state: "unavailable",
		surface_state: null,
		account_id: "acct_self",
		error: {
			code: "rate_limited",
			message: "Too many requests from this address; retry in 300 seconds.",
			retry_after_seconds: 300,
		},
		...patch,
	});

test("a throttled status is rate_limited, not unavailable", () => {
	assert.equal(model.teamBridgeEligibility(throttled()), "rate_limited");
	// A real outage keeps the hard panel.
	assert.equal(
		model.teamBridgeEligibility(
			throttled({ error: { code: "messaging_unavailable", message: "x" } }),
		),
		"unavailable",
	);
	// A READY answer carrying a throttle is usable: the page stays up.
	assert.equal(
		model.teamBridgeEligibility(
			status({ error: { code: "rate_limited", retry_after_seconds: 300 } }),
		),
		null,
	);
});

test("teamBridgeRateLimit reads the wait from the answer or the failed read", () => {
	assert.deepEqual(model.teamBridgeRateLimit(throttled()), {
		retryAfterMs: 300_000,
	});
	assert.deepEqual(
		model.teamBridgeRateLimit(throttled({ error: { code: "rate_limited" } })),
		{ retryAfterMs: model.TEAM_BRIDGE_RATE_LIMIT_DEFAULT_MS },
		"no named wait falls back to the default",
	);
	assert.deepEqual(
		model.teamBridgeRateLimit(
			throttled({
				error: { code: "rate_limited", retry_after_seconds: 10 ** 9 },
			}),
		),
		{ retryAfterMs: model.TEAM_BRIDGE_RATE_LIMIT_MAX_MS },
		"a hostile wait is capped",
	);
	// The runtime's own 429 on the status read (DesktopControlError shape).
	assert.deepEqual(
		model.teamBridgeRateLimit(null, { status: 429, retryAfterMs: 42_000 }),
		{ retryAfterMs: 42_000 },
	);
	assert.deepEqual(
		model.teamBridgeRateLimit(null, {
			status: 429,
			detail: { retry_after_seconds: 7 },
		}),
		{ retryAfterMs: 7_000 },
	);
	assert.equal(model.teamBridgeRateLimit(status()), null);
	assert.equal(model.teamBridgeRateLimit(null, { status: 502 }), null);
	assert.equal(model.teamBridgeRateLimit(null, null), null);
});

test("the retry waits at least the named wait, with bounded full jitter", () => {
	assert.equal(
		model.teamBridgeRateLimitRetryMs(300_000, () => 0),
		300_000,
	);
	assert.equal(
		model.teamBridgeRateLimitRetryMs(300_000, () => 1),
		300_000 + model.TEAM_BRIDGE_RATE_LIMIT_JITTER_MAX_MS,
	);
	// A short wait is spread by at most itself.
	assert.equal(
		model.teamBridgeRateLimitRetryMs(5_000, () => 1),
		10_000,
	);
	const spread = new Set(
		Array.from({ length: 50 }, (_, i) =>
			model.teamBridgeRateLimitRetryMs(60_000, () => i / 50),
		),
	);
	assert.equal(spread.size, 50, "different draws, different moments");
});

test("a stated wait of 0 is floored at one second, never 'no interval'", () => {
	// query-core reads a refetchInterval of 0 as "no interval": unfloored, the
	// page would say "Retrying automatically" and never retry (review M3).
	assert.deepEqual(
		model.teamBridgeRateLimit(
			throttled({ error: { code: "rate_limited", retry_after_seconds: 0 } }),
		),
		{ retryAfterMs: model.TEAM_BRIDGE_RATE_LIMIT_MIN_MS },
	);
	assert.deepEqual(
		model.teamBridgeRateLimit(null, { status: 429, retryAfterMs: 0 }),
		{ retryAfterMs: 1_000 },
	);
	assert.equal(
		model.teamBridgeRateLimitRetryMs(0, () => 0),
		1_000,
	);
	assert.ok(
		model.teamBridgeStatusRefetchInterval({
			data: throttled({
				error: { code: "rate_limited", retry_after_seconds: 0 },
			}),
			error: null,
			dataUpdatedAt: 1,
			errorUpdatedAt: 0,
		}) >= 1_000,
	);
});

test("the throttle's refetch interval is stable for one answer and differs between answers", () => {
	const state = (updatedAt) => ({
		data: throttled(),
		error: null,
		dataUpdatedAt: updatedAt,
		errorUpdatedAt: 0,
	});
	const at = Date.parse("2026-11-17T16:00:00.000Z");
	const first = model.teamBridgeStatusRefetchInterval(state(at));
	for (let i = 0; i < 20; i += 1)
		assert.equal(
			model.teamBridgeStatusRefetchInterval(state(at)),
			first,
			"the same answer must name the same deadline on every render",
		);
	assert.ok(first >= 300_000 && first <= 330_000);
	// Clients (and successive answers) a millisecond apart still spread out.
	const spread = new Set(
		Array.from({ length: 200 }, (_, i) =>
			model.teamBridgeStatusRefetchInterval(state(at + i)),
		),
	);
	assert.ok(spread.size > 190, `jitter collapsed: ${spread.size}/200`);
	for (let i = 0; i < 200; i += 1) {
		const v = model.teamBridgeRateLimitJitter(at + i)();
		assert.ok(v >= 0 && v < 1);
	}
	// A failed read is seeded by its errorUpdatedAt, and no throttle -> none.
	assert.equal(
		model.teamBridgeStatusRefetchInterval({
			data: undefined,
			error: { status: 429, retryAfterMs: 2_000 },
			dataUpdatedAt: 0,
			errorUpdatedAt: at,
		}),
		model.teamBridgeRateLimitRetryMs(
			2_000,
			model.teamBridgeRateLimitJitter(at),
		),
	);
	assert.equal(
		model.teamBridgeStatusRefetchInterval({
			data: status(),
			error: null,
			dataUpdatedAt: at,
			errorUpdatedAt: 0,
		}),
		false,
	);
});

test("re-rendering an observer does not postpone the throttled retry (real query-core)", async (t) => {
	// Review M1, reproduced against the pinned query-core: `useBaseQuery` calls
	// `setOptions` on every render, and the observer restarts its interval
	// timer whenever `refetchInterval` returns a different value. With a fresh
	// random jitter per call, an observer re-rendering every 100 ms never
	// reached its deadline; with the per-answer jitter it does.
	const reactQuery = createRequire(import.meta.url).resolve(
		"@tanstack/react-query/package.json",
	);
	// query-core decides `isServer` (no window -> never arms an interval) once,
	// at load; give it a window for that one load, then put the global back.
	const hadWindow = "window" in globalThis;
	if (!hadWindow) globalThis.window = globalThis;
	let core;
	try {
		core = createRequire(reactQuery)("@tanstack/query-core");
	} finally {
		if (!hadWindow) Reflect.deleteProperty(globalThis, "window");
	}
	assert.equal(core.isServer, false, "harness: query-core must arm intervals");
	const { QueryClient, QueryObserver } = core;
	const run = async (refetchInterval) => {
		const client = new QueryClient();
		let reads = 0;
		const options = {
			queryKey: ["tb-status-m1"],
			queryFn: async () => {
				reads += 1;
				return throttled({
					error: { code: "rate_limited", retry_after_seconds: 0 },
				});
			},
			refetchInterval,
			retry: false,
		};
		const observer = new QueryObserver(client, options);
		const unsubscribe = observer.subscribe(() => {});
		// A "render" every 100 ms for 4.5 s: a 1 s wait plus at most 1 s jitter
		// lands its first retry by ~2 s. The assert below asks for that ONE retry
		// only (2.5 s of slack), not two: a third read can land as late as ~4 s,
		// which flakes on a loaded CI runner (agent review round 2, R2-1).
		const renders = setInterval(() => observer.setOptions({ ...options }), 100);
		await new Promise((resolve) => setTimeout(resolve, 4_500));
		clearInterval(renders);
		unsubscribe();
		client.clear();
		return reads;
	};
	const stable = await run((query) =>
		model.teamBridgeStatusRefetchInterval(query.state),
	);
	assert.ok(stable >= 2, `stable jitter: ${stable} reads in 4.5 s`);
	// Negative control: the round-1 shape (fresh random per call) stalls.
	const fresh = await run((query) => {
		const limit = model.teamBridgeRateLimit(
			query.state.data,
			query.state.error,
		);
		return limit ? model.teamBridgeRateLimitRetryMs(limit.retryAfterMs) : false;
	});
	t.diagnostic(
		`reads in 4.5 s: stable jitter ${stable}, fresh jitter ${fresh}`,
	);
	// The stalled shape never retries at all: only the mount read happens.
	assert.equal(fresh, 1, `control: fresh jitter ${fresh} vs ${stable}`);
	assert.ok(fresh < stable, `control: fresh jitter ${fresh} vs ${stable}`);
});

test("a throttled read keeps the READY answer the page already has", () => {
	const ready = status({ account_id: "acct_self", tenant_id: "tnt_1" });
	const held = model.holdReadyThroughThrottle(ready, throttled());
	assert.equal(held.state, "ready");
	assert.equal(held.tenant_id, "tnt_1");
	assert.equal(held.error.code, "rate_limited");
	assert.equal(model.teamBridgeEligibility(held), null);
	// Never across accounts, never for a real outage, never without a READY.
	const other = throttled({ account_id: "acct_other" });
	assert.equal(model.holdReadyThroughThrottle(ready, other), other);
	const outage = throttled({ error: { code: "messaging_unavailable" } });
	assert.equal(model.holdReadyThroughThrottle(ready, outage), outage);
	const first = throttled();
	assert.equal(model.holdReadyThroughThrottle(undefined, first), first);
});

test("the rate-limited panel says retrying, offers no button and is not the outage panel", () => {
	const html = renderToStaticMarkup(
		createElement(ui.TeamBridgeEligibilityPanel, { reason: "rate_limited" }),
	);
	assert.match(html, /Slowing down requests/);
	assert.match(html, /Retrying automatically/);
	// Copy round 1, C2: the product pitch is for deciding to turn it on, not
	// for someone already using it; design round 1, D1: a spinner says the
	// panel is working, not stuck.
	assert.doesNotMatch(html, /Communicate with your team members/);
	assert.match(html, /data-team-bridge-rate-limited="gate"/);
	assert.match(html, /animate-spin/);
	assert.doesNotMatch(html, /Team Bridge is unavailable/);
	assert.doesNotMatch(html, /<button/, "the retry is already scheduled");
	const note = renderToStaticMarkup(createElement(ui.TeamBridgeRateLimitNote));
	assert.match(note, /data-team-bridge-rate-limited="note"/);
	assert.match(
		note,
		/Too many requests right now, so Team Bridge may be slow to update\. Retrying automatically\./,
	);
});
