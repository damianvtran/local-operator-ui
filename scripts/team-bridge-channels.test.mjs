import assert from "node:assert/strict";
import { readFileSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The discoverable-channel surfaces, exercised through the SHIPPED modules.
 *
 * WHY THIS EXISTS BESIDE THE MODEL TEST. A preview is a rendering decision — the
 * thread must show the join banner and must NOT show a message body even when a
 * cached page still carries one. That half is a server render of the real view.
 *
 * THE MENU'S RUNTIME IS NOT MOUNTED HERE, DELIBERATELY. Radix's portal under
 * jsdom cost 110 s per mount in this harness (measured while writing this file),
 * and the repo's answer for these menus is the source-shape assertions below
 * plus the real-browser story capture (`NotificationMenu`); the primitive owns
 * roving focus, Escape and focus return, so duplicating that in jsdom would
 * test Radix, not this component. What this file CAN pin cheaply is that the
 * shipped menu is wired to the model's option list and toggle rather than to a
 * second copy of the copy.
 *
 * THE NOTIFY OPTIONS ARE DRIVEN. The optimistic write's rollback is the one
 * claim a still cannot make, so the last test drives the exact options object
 * `useSetTeamBridgeNotify` hands to `useMutation` — `onMutate` then `onError` —
 * against a real QueryClient, and asserts both cached pages return to their
 * exact snapshots. The hook itself is the one-line wrapper over these options.
 *
 * The component bundle is imported from a real temp module (with `packages:
 * "external"`) rather than a data URL, because the components and this test
 * must share ONE React instance. The file is removed on exit, like the sibling
 * suites.
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
const bundle = await build({
	stdin: {
		contents: `
			export { TeamBridgePageView, TeamBridgePreviewBanner } from "./src/renderer/src/features/team-bridge/team-bridge-page";
			export { TeamBridgeConversationMenu } from "./src/renderer/src/features/team-bridge/team-bridge-conversation-menu";
			export { notifyMutationOptions, teamBridgeKeys } from "./src/renderer/src/features/team-bridge/use-team-bridge";
			export { TEAM_BRIDGE_AGENT_NOTIFY_OPTIONS, ownActiveAgent, agentNotifyLevel, ownAgentMenuState, withOwnAgentNotify } from "./src/renderer/src/features/team-bridge/team-bridge-model";
		`,
		resolveDir: ROOT,
		sourcefile: "team-bridge-channels.mjs",
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
	`./_team-bridge-channels-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(modulePath, bundle.outputFiles[0].text);
process.on("exit", () => {
	try {
		unlinkSync(modulePath.pathname);
	} catch {
		// already gone
	}
});

/*
 * THE COMPOSER'S CHAIN READS `window.api` DURING RENDER (the desktop feed
 * invalidation, `use-desktop-feed.ts:213`). This suite server-renders the page and
 * used to need no window at all; the page mounts the shared composer now, so the
 * object the app always has must exist. It is deliberately the EMPTY api: nothing
 * here asserts on the feed, and a browser-shaped absence is the honest stand-in.
 */
globalThis.window = { api: {} };
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { QueryClient } = await import("@tanstack/react-query");
const ui = await import(modulePath.href);

const selfMember = {
	account_id: "acct_self",
	kind: "human",
	display_label: "Damian",
	role: "owner",
	state: "active",
};

const conversation = (patch = {}) => ({
	id: "bcv_1",
	tenant_id: "tnt_1",
	kind: "channel",
	name: "product-design",
	topic: "Design critiques",
	visibility: "tenant",
	agent_capable: false,
	status: "open",
	created_by: "acct_self",
	last_message_at: "2026-10-19T10:00:00Z",
	latest_seq: 2,
	members: [selfMember],
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
	onTarget: () => {},
	onSend: () => {},
	onNewChannel: () => {},
	onRetry: () => {},
	onScopeChange: () => {},
	onJoin: () => {},
	onNotifyChange: () => {},
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

const message = (conversationId, body) => ({
	id: "bcmsg_1",
	conversation_id: conversationId,
	seq: 1,
	sender: { account_id: "acct_bea", kind: "human", display_label: "Bea" },
	body,
	origin: "human",
	created_at: "2026-10-19T09:00:00Z",
});

test("a preview shows the join banner and never a message body", () => {
	const preview = conversation({
		discoverable: true,
		member: false,
		member_count: 24,
		members: [],
	});
	const html = renderToStaticMarkup(
		createElement(
			ui.TeamBridgePageView,
			viewProps({
				target: { type: "conversation", id: preview.id },
				conversations: [preview],
				messages: [message(preview.id, "SECRET PREVIEW BODY")],
				messageState: "ready",
			}),
		),
	);
	assert.match(html, /You’re previewing this channel/);
	assert.match(html, /Join to see its history and get notifications/);
	assert.match(html, />Join</);
	assert.match(html, /24 members/);
	// The cached body and the composer are both wrong on a non-member pane.
	assert.doesNotMatch(html, /SECRET PREVIEW BODY/);
	assert.doesNotMatch(html, /Message this conversation/);
});

test("a refused notification write is stated under the header", () => {
	const selected = conversation({ notify: "mute", muted: true });
	const html = renderToStaticMarkup(
		createElement(
			ui.TeamBridgePageView,
			viewProps({
				selectedConversation: selected,
				conversations: [selected],
				notifyFailed: true,
				messageState: "ready",
			}),
		),
	);
	assert.match(html, /Your notification preference was not saved/);
	assert.match(html, /role="alert"/);
});

test("a refused join is stated above a still-available action", () => {
	const failed = renderToStaticMarkup(
		createElement(ui.TeamBridgePreviewBanner, {
			joinFailed: true,
			onJoin: () => {},
		}),
	);
	assert.match(failed, /You could not join this channel/);
	assert.match(failed, />Join</);

	const busy = renderToStaticMarkup(
		createElement(ui.TeamBridgePreviewBanner, {
			joining: true,
			onJoin: () => {},
		}),
	);
	assert.match(busy, /disabled/);
});

/* ------------------------------------------- the conversation menu (shipped) */

test("the header menu's trigger names the control", () => {
	const html = renderToStaticMarkup(
		createElement(ui.TeamBridgeConversationMenu, {
			conversation: { notify: "all", muted: false },
			onNotifyChange: () => {},
		}),
	);
	assert.match(html, /aria-label="Conversation options"/);
});

test("the menu renders the model's levels and toggle, inside Radix's radio group", () => {
	const source = readFileSync(
		`${ROOT}/src/renderer/src/features/team-bridge/team-bridge-conversation-menu.tsx`,
		"utf8",
	);
	// The three levels come from the model's one ordered list, so the menu and
	// the model test cannot drift into different orderings.
	assert.match(source, /TEAM_BRIDGE_NOTIFY_OPTIONS\.map/);
	assert.match(source, /<DropdownMenuRadioGroup/);
	assert.match(source, /onValueChange=/);
	// The immediate row is the model's toggle, not a second `notify === "mute"`
	// expression that could disagree with it.
	assert.match(source, /toggledMuteNotify\(notify\)/);
	// The checked row is the server's value through the one defaulting helper.
	assert.match(source, /notificationPreference\(conversation\)/);
	// Story/capture seed: the open state is a prop, never a click from the test.
	assert.match(source, /<DropdownMenu defaultOpen=\{defaultOpen\}>/);
});

/*
 * YOUR AGENT'S WAKE LEVEL (wake-on-every-message). The menu offers it only for
 * the reader's OWN ACTIVE agent; the checked row is the served level and never
 * a guess; the optimistic patch moves only that agent row.
 */
test("the 'Your agent' group is offered only for the reader's own active agent", () => {
	const self = "acct_self";
	const agentRow = (account, state, notify) => ({
		account_id: account,
		kind: "agent",
		display_label: "Robo",
		role: "member",
		state,
		...(notify ? { notify } : {}),
	});
	const humanRow = {
		account_id: self,
		kind: "human",
		display_label: "Me",
		role: "member",
		state: "active",
	};
	const of = (members) => ({ members });
	// Active own agent with a served level.
	assert.deepEqual(
		ui.ownAgentMenuState(
			of([humanRow, agentRow(self, "active", "mention")]),
			self,
		),
		{ notify: "mention" },
	);
	// Active own agent, older hub serving no level: nothing is checked, not a guessed "all".
	assert.deepEqual(ui.ownAgentMenuState(of([agentRow(self, "active")]), self), {
		notify: null,
	});
	// An unknown served value is not trusted either.
	assert.deepEqual(
		ui.ownAgentMenuState(of([agentRow(self, "active", "loud")]), self),
		{ notify: null },
	);
	// Invited (answered on the Invitations screen), left, or someone else's agent: no control.
	for (const members of [
		[agentRow(self, "invited")],
		[agentRow(self, "left")],
		[agentRow(self, "removed")],
		[agentRow("acct_other", "active", "all")],
		[humanRow],
	])
		assert.equal(ui.ownAgentMenuState(of(members), self), undefined);
	// No resolved account: no control.
	assert.equal(
		ui.ownAgentMenuState(of([agentRow(self, "active")]), undefined),
		undefined,
	);
	// Menu order is loudest first, and every label is an agentNotify key.
	assert.deepEqual(
		ui.TEAM_BRIDGE_AGENT_NOTIFY_OPTIONS.map((option) => option.value),
		["all", "mention", "mute"],
	);
	assert.deepEqual(
		ui.TEAM_BRIDGE_AGENT_NOTIFY_OPTIONS.map((option) => option.labelKey),
		[
			"ui.teamBridge.agentNotify.all",
			"ui.teamBridge.agentNotify.mention",
			"ui.teamBridge.agentNotify.mute",
		],
	);
});

test("the agent-level patch moves only the reader's own active agent, in that org's row", () => {
	const self = "acct_self";
	const row = (id, tenant) => ({
		id,
		tenant_id: tenant,
		notify: "all",
		muted: false,
		members: [
			{
				account_id: self,
				kind: "human",
				display_label: "Me",
				role: "member",
				state: "active",
			},
			{
				account_id: self,
				kind: "agent",
				display_label: "Robo",
				role: "member",
				state: "active",
				notify: "all",
			},
			{
				account_id: "acct_other",
				kind: "agent",
				display_label: "Theirs",
				role: "member",
				state: "active",
				notify: "all",
			},
		],
	});
	const page = {
		conversations: [row("bcv_1", "tnt_1"), row("bcv_1", "tnt_2")],
		has_more: true,
	};
	const next = ui.withOwnAgentNotify(
		page,
		{ conversationId: "bcv_1", tenantId: "tnt_1" },
		self,
		"mute",
	);
	const [hit, otherOrg] = next.conversations;
	assert.equal(hit.members[1].notify, "mute");
	// The reader's own banner register is a different field and does not move.
	assert.equal(hit.notify, "all");
	assert.equal(hit.muted, false);
	assert.equal(hit.members[2].notify, "all");
	assert.equal(hit.members[0].notify, undefined);
	// Same id in another org is a different conversation.
	assert.deepEqual(otherOrg, page.conversations[1]);
	assert.equal(next.has_more, true);
});

test("the menu draws the agent group from the model, separately labelled, before Archive", () => {
	const source = readFileSync(
		`${ROOT}/src/renderer/src/features/team-bridge/team-bridge-conversation-menu.tsx`,
		"utf8",
	);
	assert.match(source, /TEAM_BRIDGE_AGENT_NOTIFY_OPTIONS\.map/);
	assert.match(source, /\{ownAgent && onAgentNotifyChange && \(/);
	assert.match(
		source,
		/aria-label=\{t\("ui\.teamBridge\.agentNotify\.label"\)\}/,
	);
	// The agent group writes through its own callback, never the reader's notify.
	assert.match(source, /onAgentNotifyChange\(asTeamBridgeNotify\(next\)\)/);
	const agentGroup = source.indexOf("{ownAgent && onAgentNotifyChange && (");
	const archiveGuard = source.indexOf("{onArchive && (");
	assert.ok(agentGroup > 0 && archiveGuard > agentGroup);
});

/*
 * ARCHIVE IS LAST, AND STAYS LAST (operator, 2026-10-29).
 *
 * The operator reported Archive sitting where a mis-click is easy. In this
 * build it is already the final item — but "already true" is not a guarantee:
 * the next action added to this menu is appended by whoever edits the
 * component, and a destructive row that drifts above the fold is the bug the
 * report describes. So the ORDER is pinned here rather than assumed, and the
 * assertion is positional on purpose: a test that merely checked the label
 * exists would pass again the moment someone moved it.
 */
test("archive is the last action in the conversation menu, after every other", () => {
	const source = readFileSync(
		`${ROOT}/src/renderer/src/features/team-bridge/team-bridge-conversation-menu.tsx`,
		"utf8",
	);
	// The notify group's close is the last non-archive content in the menu.
	const radioGroupEnd = source.indexOf("</DropdownMenuRadioGroup>");
	assert.ok(radioGroupEnd > 0, "the notify radio group must still close");
	// Conditional on the caller's authority, not always rendered.
	const archiveGuard = source.indexOf("{onArchive && (");
	assert.ok(
		archiveGuard > radioGroupEnd,
		"archive must come after the notify group, not before it",
	);
	// Positional: no DropdownMenuItem begins after the archive one.
	const archiveItem = source.indexOf("<DropdownMenuItem", archiveGuard);
	assert.ok(archiveItem > 0, "the archive item must still be a menu item");
	const lastItem = source.lastIndexOf("<DropdownMenuItem");
	assert.equal(
		archiveItem,
		lastItem,
		"archive must be the last menu item; a later item was added after it",
	);
	// And it must be separated from the preferences above it, so the eye reads
	// it as a different kind of act rather than the next option in a list.
	// Matched on the tag, not the exact self-closing literal: an ordinary
	// className on that separator is a legitimate edit, and pinning the literal
	// would fail on it while blaming the order.
	const separatorTag = source.indexOf("<DropdownMenuSeparator", radioGroupEnd);
	assert.ok(
		separatorTag > 0 && separatorTag < archiveItem,
		"a separator must sit between the preferences and archive",
	);

	/*
	 * NOTHING RENDERS BENEATH ARCHIVE (review round 1, MINOR 1).
	 *
	 * The positional check above only sees a literal `<DropdownMenuItem`. A
	 * sibling COMPONENT added after the archive block - `<ExtraActions />` - can
	 * render its own rows underneath Archive while the search finds no later
	 * item, so the guard would pass on precisely the layout it exists to forbid.
	 * The region that matters is between the end of the archive guard and the
	 * end of the menu: whatever lives there would render below Archive.
	 */
	const afterGuard = source.slice(
		source.indexOf(")}", archiveItem) + 2,
		source.indexOf("</DropdownMenu>", archiveItem),
	);
	const strayElement = afterGuard
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.match(/<[A-Za-z]/);
	assert.equal(
		strayElement,
		null,
		`nothing may render after the archive item; found ${strayElement?.[0] ?? ""}`,
	);
});

test("the notify options restore both cached pages when the write is refused", async () => {
	const client = new QueryClient({
		// The seeded pages have no observer: gc must not collect them before the
		// options run. `client.clear()` at the end drops the timers.
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
		},
	});
	const row = conversation({ id: "bcv_2", notify: "all", muted: false });
	const sibling = conversation({ id: "bcv_3" });
	const page = { conversations: [row, sibling], has_more: true };
	const orgKey = ui.teamBridgeKeys.conversations("tnt_1", "acct_self");
	const allKey = ui.teamBridgeKeys.conversations("all", "acct_self");
	client.setQueryData(["radient-user", "user"], {
		account: { id: "acct_self" },
	});
	client.setQueryData(ui.teamBridgeKeys.statusFor("acct_self"), {
		account_id: "acct_self",
		state: "ready",
		local: { enabled: true },
		read_only: false,
	});
	client.setQueryData(orgKey, structuredClone(page));
	client.setQueryData(allKey, structuredClone(page));
	// The claim under test is the snapshot restore, not the settle-time re-read.
	client.invalidateQueries = async () => {};

	const options = ui.notifyMutationOptions(client);
	const variables = {
		conversationId: "bcv_2",
		tenantId: "tnt_1",
		notify: "mute",
	};
	const context = await options.onMutate(variables);
	assert.equal(client.getQueryData(orgKey).conversations[0].notify, "mute");
	assert.equal(client.getQueryData(orgKey).conversations[0].muted, true);
	assert.equal(client.getQueryData(allKey).conversations[0].notify, "mute");
	assert.equal(client.getQueryData(orgKey).conversations[1].notify, undefined);

	options.onError(new Error("refused"), variables, context);
	// Both scope-keyed pages must be back exactly as they were: the snapshot is
	// per page, and a rollback that restores only the visible one leaves the
	// merged view claiming a preference the server refused.
	assert.deepEqual(client.getQueryData(orgKey), page);
	assert.deepEqual(client.getQueryData(allKey), page);
	await options.onSettled();
	client.clear();
});
