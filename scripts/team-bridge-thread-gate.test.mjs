import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Team Bridge's capability gates, exercised through the SHIPPED modules.
 *
 * WHY THIS FILE EXISTS. The thread pane, the reply-in-thread affordance and the
 * reaction controls were held closed in the build (#1304's thread cache/retry
 * isolation defects; a reaction path with no owner receipt). Both build
 * switches are now ON, because the runtime advertises `team_bridge_threads` /
 * `team_bridge_reactions` only with receipt-REQUIRED routes and the renderer
 * keys and fences the thread cache by account + auth epoch. What this file
 * pins is that the CAPABILITY still decides everything below the switch:
 * `unknown`, `below-version` and `unpaired` hide the surface (an older core
 * gets NO controls), and only `enabled` shows it. Each switch is still proven
 * to close its surface when off (it is the kill switch), through the `shipped`
 * parameter rather than the module constant.
 *
 * The reaction matrix runs through the REAL `desktopFeatureState`, with the
 * page rendered for each answer, so the payload shape (missing key, 0, 1,
 * unpaired, no data) is the one the capability read actually produces.
 */
const ROOT = process.cwd();
const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/renderer/src/features/team-bridge/team-bridge-thread-gate";
			export * from "./src/renderer/src/features/team-bridge/team-bridge-reaction-gate";
			export * from "./src/shared/team-bridge-notify";
			export { desktopFeatureState } from "./src/renderer/src/shared/api/local-operator/desktop-hooks";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	tsconfig: "tsconfig.web.json",
	jsx: "automatic",
	loader: { ".css": "empty" },
	write: false,
});

/*
 * Written to a real temp module, not a data URL: the bundles keep packages
 * external (one React, one React Query), which a data URL cannot resolve.
 *
 * THE FILES LIVE AT THE REPO ROOT with a dot prefix, matching
 * `team-bridge-threads.test.mjs`: they must resolve React/React Query from the
 * repo, and `scripts/` is lint-gated, so a leaked bundle there fails
 * `lint:scripts`. A killed run can leave one behind; sweep stale siblings on
 * the next start.
 */
const { readdirSync, unlinkSync } = await import("node:fs");
const { writeFile } = await import("node:fs/promises");
const { pathToFileURL } = await import("node:url");
for (const name of readdirSync(ROOT)) {
	if (/^\.team-bridge-(gate|reactions-view)-\d+\.mjs$/.test(name)) {
		try {
			unlinkSync(`${ROOT}/${name}`);
		} catch {
			// already gone
		}
	}
}
const gatePath = pathToFileURL(`${ROOT}/.team-bridge-gate-${process.pid}.mjs`);
await writeFile(gatePath, bundle.outputFiles[0].text);

/* The page's only import from the chat sidebar is `rowCurrent`; stubbed for
   the same reason and from the same literal as the directory suite. */
const chatSidebarSource = readFileSync(
	`${ROOT}/src/renderer/src/features/chat/components/chat-sidebar.tsx`,
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
			() => ({ path: "chat-sidebar-stub", namespace: "stub" }),
		);
		pluginBuild.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
			contents: `export const rowCurrent = ${rowCurrentLiteral};`,
			loader: "js",
		}));
	},
};

const viewBundle = await build({
	stdin: {
		contents: `
			export { TeamBridgePageView } from "./src/renderer/src/features/team-bridge/team-bridge-page";
			export { TeamBridgeMessageList } from "./src/renderer/src/features/team-bridge/team-bridge-message-list";
			export { TeamBridgeReactionChips, TeamBridgeReactionPicker, TeamBridgeReactions, useTeamBridgeReactionState } from "./src/renderer/src/features/team-bridge/team-bridge-reactions";
			export { TeamBridgeEmojiPicker } from "./src/renderer/src/features/team-bridge/team-bridge-emoji-picker";
			export { setLocale } from "./src/i18n";
		`,
		resolveDir: ROOT,
		sourcefile: "team-bridge-reaction-gate.mjs",
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
const viewPath = pathToFileURL(
	`${ROOT}/.team-bridge-reactions-view-${process.pid}.mjs`,
);
await writeFile(viewPath, viewBundle.outputFiles[0].text);
/* `exit` handlers must be SYNCHRONOUS: an async unlink scheduled there never
   runs, which is how the first version leaked its bundles. */
process.on("exit", () => {
	for (const path of [gatePath, viewPath]) {
		try {
			unlinkSync(path);
		} catch {
			// already gone
		}
	}
});

const gate = await import(gatePath.href);
const view = await import(viewPath.href);
view.setLocale("en");
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");

const read = (path) => readFileSync(path, "utf8");
const page = read("src/renderer/src/features/team-bridge/team-bridge-page.tsx");
const messageList = read(
	"src/renderer/src/features/team-bridge/team-bridge-message-list.tsx",
);
const toolbar = read(
	"src/renderer/src/features/team-bridge/team-bridge-message-toolbar.tsx",
);
const pane = read(
	"src/renderer/src/features/team-bridge/team-bridge-thread-pane.tsx",
);
const notifications = read(
	"src/renderer/src/features/team-bridge/use-team-bridge-notifications.ts",
);

test("threads ship in this build, and the capability still decides", () => {
	assert.equal(gate.TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD, true);
	assert.equal(gate.teamBridgeThreadsAvailable("enabled"), true);
	for (const state of [undefined, "unknown", "below-version", "unpaired"]) {
		assert.equal(
			gate.teamBridgeThreadsAvailable(state),
			false,
			`${String(state)}: an older, unpaired or unanswered core shows no thread surface`,
		);
	}
});

test("the threads switch is still a kill switch: off hides every answer", () => {
	for (const state of [
		undefined,
		"unknown",
		"below-version",
		"unpaired",
		"enabled",
	]) {
		assert.equal(
			gate.teamBridgeThreadsAvailable(state, false),
			false,
			`${String(state)} must stay hidden with the switch off`,
		);
	}
});

test("the return path is the capability, and only `enabled` opens it", () => {
	assert.equal(gate.teamBridgeThreadsAvailable("enabled", true), true);
	for (const state of [undefined, "unknown", "below-version", "unpaired"]) {
		assert.equal(
			gate.teamBridgeThreadsAvailable(state, true),
			false,
			`${String(state)} must stay hidden even when shipped`,
		);
	}
});

test("a reply banner click routes to its thread; the page still gates the pane", () => {
	const target = {
		conversationId: "bcv_1",
		tenantId: "tnt_1",
		threadId: "bmsg_root",
	};
	const path = gate.teamBridgeOpenPath(target);
	assert.match(path, /^\/team-bridge\?/);
	assert.match(path, /tenant=tnt_1/);
	assert.match(path, /conversation=bcv_1/);
	assert.match(path, /thread=bmsg_root/);
	// A top-level message names no thread.
	assert.doesNotMatch(
		gate.teamBridgeOpenPath({ conversationId: "bcv_1", tenantId: "tnt_1" }),
		/thread=/,
	);
	// The page seeds a selection from `thread` only when the capability allows.
	assert.match(page, /threadsAvailable \? \(threadLink \?\? null\) : null/);
});

// ---------------------------------------------------------------------------
// Source wiring: every mount and route the containment census named
// ---------------------------------------------------------------------------

test("the page asks the capability and hands the answer to the view", () => {
	assert.match(
		page,
		/desktopFeatureState\(\s*capabilities\.data,\s*"team_bridge_threads",?\s*\)/,
	);
	assert.match(page, /useDesktopCapabilities\(\)/);
	assert.match(page, /threadsCapabilityState=\{desktopFeatureState\(/);
	assert.match(page, /teamBridgeThreadsAvailable\(threadsCapabilityState\)/);
});

test("the page's thread state, reply handler and pane mount follow the capability", () => {
	// Selection cannot be seeded or updated unless the capability allows it.
	assert.match(page, /threadsAvailable \? \(threadLink \?\? null\) : null/);
	assert.match(
		page,
		/if \(threadsAvailable && threadLink\) setThreadSelection\(threadLink\)/,
	);
	// The wide-viewport rule that hides the timeline while a thread is open
	// must also require the capability, or a stale selection blanks the pane.
	assert.match(page, /threadsAvailable &&\s*threadSelection &&\s*shown/);
	// The reply affordance is omitted, not passed and ignored.
	assert.match(page, /onReply=\{\s*threadsAvailable/);
	// The pane block itself is gated on the same term.
	assert.match(page, /\{threadsAvailable &&\s*threadSelection &&\s*shown &&/);
});

test("a `?thread=` deep link is read only when the threads switch is on", () => {
	assert.match(
		page,
		/TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD\s*\?\s*threadTargetFromSearch\(searchParams\)\s*:\s*null/,
	);
	assert.match(
		page,
		/TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD\s*\?\s*threadTargetFromSearch\(/,
		"the notification-route effect must not rebuild a thread link",
	);
});

test("the message row's reply control follows the build switch and the handler", () => {
	assert.match(
		messageList,
		/const canReply =\s*TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD &&/,
	);
	assert.match(messageList, /\{canReply && summary\.count > 0 && \(/);
});

test("the toolbar drops a directly-passed onReply when the switch is off", () => {
	assert.match(
		toolbar,
		/const reply = TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD \? onReply : undefined/,
	);
	assert.match(toolbar, /\{reply && \(/);
	assert.match(toolbar, /onClick=\{reply\}/);
	assert.doesNotMatch(toolbar, /\{onReply && \(/);
});

test("both pane exports guard before any hook mounts", () => {
	const viewStart = pane.indexOf("export function TeamBridgeThreadPaneView(");
	const bodyStart = pane.indexOf("function TeamBridgeThreadPaneBody(");
	assert.notEqual(viewStart, -1, "the view export must exist");
	assert.notEqual(bodyStart, -1, "the view body must be a separate component");
	const viewWrapper = pane.slice(viewStart, bodyStart);
	assert.match(
		viewWrapper,
		/if \(!TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD\) return null;/,
	);
	assert.match(viewWrapper, /<TeamBridgeThreadPaneBody \{\.\.\.props\} \/>/);
	assert.doesNotMatch(viewWrapper, /useEffect|useState|useRef|useI18nLocale/);

	const mountStart = pane.indexOf("export function TeamBridgeThreadPane(");
	const mountBody = pane.indexOf("function TeamBridgeThreadPaneMount(");
	assert.notEqual(mountStart, -1, "the pane container export must exist");
	assert.notEqual(
		mountBody,
		-1,
		"the container body must be a separate component",
	);
	const mountWrapper = pane.slice(mountStart, mountBody);
	assert.match(
		mountWrapper,
		/if \(!TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD\) return null;/,
	);
	// The container captures the owner BEFORE mounting, and mounts nothing
	// without one; the body is keyed by account + epoch.
	assert.match(mountWrapper, /useObservedRadientAuthority\(\)/);
	assert.match(mountWrapper, /if \(!authority\.accountId\) return null;/);
	assert.match(mountWrapper, /key=\{`\$\{owner\.accountId\}:\$\{owner\.epoch\}`\}/);
	assert.doesNotMatch(
		mountWrapper,
		/useInfiniteQuery|useMutation|useRef|useCallback/,
	);
});

test("a reply banner's thread read carries the delivery's owner", () => {
	assert.match(
		notifications,
		/const threadId = TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD\s*\?\s*candidate\.threadId\s*:\s*undefined/,
	);
	assert.match(notifications, /const newest = threadId\s*\?/);
	assert.match(
		notifications,
		/listReplies\(candidate\.conversationId, threadId/,
	);
	assert.doesNotMatch(
		notifications,
		/listReplies\(\s*candidate\.conversationId,\s*candidate\.threadId/,
	);
	assert.match(
		notifications,
		/listReplies\(candidate\.conversationId, threadId, \{\s*expectedAccountId: selfAccountId,/,
	);
	// The thread-cache clear is mounted in the shell, unconditionally.
	assert.match(notifications, /useTeamBridgeThreadCacheFence\(\);/);
});

// ---------------------------------------------------------------------------
// The reaction capability
// ---------------------------------------------------------------------------

/*
 * The payload shapes the capability read actually produces: no answer at all
 * (still loading, or the query errored), a missing key (a runtime that predates
 * reactions), an explicit 0, a paired-but-version-0 backend, and 1. Only the
 * last is available; `teamBridgeReactionsAvailable` is the projection the page
 * mounts on.
 */
const capabilityPayloads = [
	{ label: "no capabilities (loading or error)", caps: null, state: "unknown" },
	{
		label: "missing key",
		caps: { desktop_available: true, features: {} },
		state: "below-version",
	},
	{
		label: "0",
		caps: { desktop_available: true, features: { team_bridge_reactions: 0 } },
		state: "below-version",
	},
	{
		label: "unpaired",
		caps: { desktop_available: false, features: { team_bridge_reactions: 1 } },
		state: "unpaired",
	},
	{
		label: "1",
		caps: { desktop_available: true, features: { team_bridge_reactions: 1 } },
		state: "enabled",
		available: true,
	},
];

test("reactions ship in this build; only `enabled` shows them", () => {
	assert.equal(gate.TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD, true);
	for (const { label, caps, state, available = false } of capabilityPayloads) {
		assert.equal(
			gate.desktopFeatureState(caps, "team_bridge_reactions"),
			state,
			`${label}: capability state`,
		);
		assert.equal(
			gate.teamBridgeReactionsAvailable(
				gate.desktopFeatureState(caps, "team_bridge_reactions"),
			),
			available,
			`${label}: availability in this build`,
		);
	}
});

test("the reactions switch is still a kill switch: off hides every answer", () => {
	for (const { label, caps } of capabilityPayloads) {
		assert.equal(
			gate.teamBridgeReactionsAvailable(
				gate.desktopFeatureState(caps, "team_bridge_reactions"),
				false,
			),
			false,
			`${label}: hidden with the switch off`,
		);
	}
});

/* One message that carries a reaction summary, so an available capability has
   something to render: the chips and the toolbar's react button both hang off
   the same context. */
const reactionMessage = {
	id: "bcmsg_reaction01",
	conversation_id: "bcv_reaction",
	seq: 1,
	sender: { account_id: "acct_bea", kind: "human", display_label: "Bea" },
	body: "hello",
	origin: "human",
	created_at: "2026-10-23T10:00:00Z",
	reactions: [
		{ emoji: "👍", count: 1, reacted_by_me: false, sample_labels: ["Bea"] },
	],
};
const reactionConversation = {
	id: "bcv_reaction",
	tenant_id: "tnt_1",
	kind: "dm",
	name: "",
	visibility: "private",
	agent_capable: false,
	status: "open",
	created_by: "acct_self",
	last_message_at: "2026-10-23T10:00:00Z",
	latest_seq: 1,
	members: [
		{
			account_id: "acct_self",
			kind: "human",
			display_label: "Damian",
			role: "member",
			state: "active",
		},
		{
			account_id: "acct_bea",
			kind: "human",
			display_label: "Bea",
			role: "member",
			state: "active",
		},
	],
	last_read_seq: 1,
	unread_count: 0,
	muted: false,
};
const renderPage = (reactionsCapabilityState) =>
	renderToStaticMarkup(
		createElement(view.TeamBridgePageView, {
			selfAccountId: "acct_self",
			conversations: [reactionConversation],
			target: { type: "conversation", id: reactionConversation.id },
			messages: [reactionMessage],
			messageState: "ready",
			organizations: [
				{ tenantId: "tnt_1", name: "Minerva", role: "owner", unread: 0 },
			],
			scope: "tnt_1",
			totalUnread: 0,
			listState: "ready",
			people: [],
			peopleState: "ready",
			onTarget() {},
			onSend() {},
			onNewChannel() {},
			onRetry() {},
			onScopeChange() {},
			onJoin() {},
			onNotifyChange() {},
			onRetryPeople() {},
			...(reactionsCapabilityState === undefined
				? {}
				: { reactionsCapabilityState }),
		}),
	);

test("an older core gets no reaction control: every answer but `enabled` hides it", () => {
	// The absent prop is the "no capabilities read" mount: it must behave like
	// `unknown`, not like an assumed yes.
	for (const state of [undefined, "unknown", "below-version", "unpaired"]) {
		const html = renderPage(state);
		const label = state ?? "absent";
		// The timeline itself still renders; only the reaction lane is withheld.
		assert.match(html, /hello/, `${label}: message body`);
		assert.doesNotMatch(html, /data-reaction-layout="chips"/, label);
		assert.doesNotMatch(
			html,
			/aria-label="Add reaction"/,
			`${label}: react control`,
		);
		assert.doesNotMatch(html, /role="toolbar"/, `${label}: no toolbar`);
	}
});

test("every directly exported reaction entry point keeps its build-switch guard", () => {
	/*
	 * A page that withholds the context is not enough: a story, a rig or a
	 * future call site can import these directly. Each export still checks the
	 * switch before its body's hooks mount, so flipping the switch back off
	 * closes every entry point at once (the kill switch). With it on, the chips
	 * render for a message that carries reactions.
	 */
	const reactions = read(
		"src/renderer/src/features/team-bridge/team-bridge-reactions.tsx",
	);
	const guards =
		reactions.match(
			/if \(!TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD\) return null;/g,
		) ?? [];
	assert.ok(guards.length >= 3, `found ${guards.length} export guards`);
	assert.match(
		renderToStaticMarkup(
			createElement(view.TeamBridgeReactions, {
				conversationId: reactionMessage.conversation_id,
				messageId: reactionMessage.id,
				accountId: "acct_self",
				tenantId: "tnt_1",
				reactions: reactionMessage.reactions,
			}),
		),
		/data-reaction-layout="chips"/,
		"shipped: standalone chips render",
	);
});

test("a reaction toggle carries the owner captured at the click", async () => {
	/*
	 * The receipt is the reason the hold could lift: `choose` hands the toggle
	 * the account and the message's tenant it was mounted with, which
	 * `TeamBridgeApi.react` sends as `expected_account_id` + `tenant_id`.
	 */
	const calls = [];
	let choose;
	function Probe() {
		const state = view.useTeamBridgeReactionState({
			conversationId: reactionMessage.conversation_id,
			messageId: reactionMessage.id,
			accountId: "acct_self",
			tenantId: "tnt_1",
			reactions: reactionMessage.reactions,
			toggle: async (...args) => {
				calls.push(args);
				return { message_id: reactionMessage.id, reactions: [] };
			},
		});
		choose = state.choose;
		return createElement("span", null, "probe");
	}
	renderToStaticMarkup(createElement(Probe));
	await choose("\u{1F44D}");
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0], [
		reactionMessage.conversation_id,
		reactionMessage.id,
		"\u{1F44D}",
		true,
		{ accountId: "acct_self", tenantId: "tnt_1" },
	]);
});

test("no reaction state is mounted without the capability", () => {
	// `ReactableMessageRow` is the only caller of the reaction hook, and it
	// mounts only when the context is present - so withholding the context is
	// what keeps reaction state and its toggle away from a runtime that does not
	// advertise `team_bridge_reactions`. No GET is issued anywhere in the hook;
	// a mount is the observable.
	assert.equal(
		(messageList.match(/useTeamBridgeReactionState\(\{/g) ?? []).length,
		1,
		"one caller of the reaction state hook",
	);
	assert.match(
		messageList,
		/reactionContext && props\.message\.body !== null \?/,
		"the reaction row mounts only with a context",
	);
	// The page builds that context only when the capability is available.
	assert.match(page, /reactionsAvailable && selfAccountId && selected/);
	assert.match(
		page,
		/teamBridgeReactionsAvailable\(\s*reactionsCapabilityState,?\s*\)/,
	);
});

test("the toolbar counts no reaction control while the switch is off", () => {
	const toolbarSource = read(
		"src/renderer/src/features/team-bridge/team-bridge-message-toolbar.tsx",
	);
	// A control the picker would refuse to render must not be counted as a
	// button either: the roving tab stop would point at nothing.
	assert.match(
		toolbarSource,
		/const canReact =\s*TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD &&/,
	);
});
