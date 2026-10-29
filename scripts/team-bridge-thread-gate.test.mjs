import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Team Bridge's capability gates, exercised through the SHIPPED modules.
 * #3149 publishes the guarded thread and reaction capabilities and this build
 * supplies their required receipts. The matrix therefore proves both halves:
 * `enabled` returns the surface, while unknown, below-version and unpaired
 * answers still fail closed. The source census keeps every mount and route on
 * that one decision rather than allowing an unrelated affordance to bypass it.
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

test("shipped threads return only for an enabled capability", () => {
	assert.equal(gate.TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD, true);
	assert.equal(gate.teamBridgeThreadsAvailable("enabled"), true);
	for (const state of [undefined, "unknown", "below-version", "unpaired"]) {
		assert.equal(
			gate.teamBridgeThreadsAvailable(state),
			false,
			`${String(state)} must leave the thread surface hidden`,
		);
	}
});

test("an unshipped build stays closed even for an enabled capability", () => {
	assert.equal(gate.teamBridgeThreadsAvailable("enabled", false), false);
});

test("a notification click preserves its guarded thread target", () => {
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

test("the page's thread state, reply handler and pane mount are all held", () => {
	// Selection cannot be seeded or updated while held.
	assert.match(page, /threadsAvailable \? \(threadLink \?\? null\) : null/);
	assert.match(
		page,
		/if \(threadsAvailable && threadLink\) setThreadSelection\(threadLink\)/,
	);
	// The wide-viewport rule that hides the timeline while a thread is open
	// must also require the hold, or a stale selection blanks the pane.
	assert.match(page, /threadsAvailable &&\s*threadSelection &&\s*shown/);
	// The reply affordance is omitted, not passed and ignored.
	assert.match(page, /onReply=\{\s*threadsAvailable/);
	// The pane block itself is gated on the same term.
	assert.match(page, /\{threadsAvailable &&\s*threadSelection &&\s*shown &&/);
});

test("a `?thread=` deep link cannot seed a thread target", () => {
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

test("the message row renders no reply control while held", () => {
	assert.match(
		messageList,
		/const canReply =\s*TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD &&/,
	);
	assert.match(messageList, /\{canReply && summary\.count > 0 && \(/);
});

test("the toolbar drops a directly-passed onReply while held", () => {
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
	assert.match(mountWrapper, /<TeamBridgeThreadPaneMount \{\.\.\.props\} \/>/);
	assert.doesNotMatch(
		mountWrapper,
		/useQueryClient|useInfiniteQuery|useMutation|useRef|useCallback/,
	);
});

test("no notification path reads thread replies while held", () => {
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

test("shipped reactions follow only the enabled capability and otherwise fail closed", () => {
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
			`${label}: capability availability`,
		);
	}
	assert.equal(gate.TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD, true);
	assert.equal(gate.teamBridgeReactionsAvailable("enabled", false), false);
});

test("the return path is the shipped flag AND `enabled`", () => {
	for (const { label, caps, available = false } of capabilityPayloads) {
		assert.equal(
			gate.teamBridgeReactionsAvailable(
				gate.desktopFeatureState(caps, "team_bridge_reactions"),
				true,
			),
			available,
			`${label}: availability with the flag on`,
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

test("reaction chips and the react control return only for the enabled capability", () => {
	// The absent prop is the "no capabilities read" mount: it must behave like
	// `unknown`, not like an assumed yes.
	for (const state of [
		undefined,
		"unknown",
		"below-version",
		"unpaired",
		"enabled",
	]) {
		const html = renderPage(state);
		const label = state ?? "absent";
		assert.match(html, /hello/, `${label}: message body`);
		assert.equal(
			html.includes('data-reaction-layout="chips"'),
			state === "enabled",
			`${label}: chips`,
		);
		assert.equal(
			html.includes('aria-label="Add reaction"'),
			state === "enabled",
			`${label}: react control`,
		);
		assert.equal(
			html.includes('role="toolbar"'),
			state === "enabled",
			`${label}: toolbar`,
		);
	}
});

test("directly exported reaction entry points render in the shipped build", () => {
	const state = {
		accountId: "acct_self",
		rows: [
			{ emoji: "👍", count: 1, reacted_by_me: false, sample_labels: ["Bea"] },
		],
		pending: false,
		error: false,
		disabled: false,
		unavailable: false,
		choose() {},
	};
	assert.match(
		renderToStaticMarkup(
			createElement(view.TeamBridgeReactionChips, { state }),
		),
		/data-reaction-layout="chips"/,
		"chips",
	);
	assert.match(
		renderToStaticMarkup(
			createElement(view.TeamBridgeReactionPicker, {
				state,
				open: true,
				onOpenChange() {},
				children: createElement("button", null, "react"),
			}),
		),
		/react/,
		"picker trigger",
	);
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
		"standalone chips",
	);
	assert.match(
		renderToStaticMarkup(
			createElement(view.TeamBridgeEmojiPicker, {
				accountId: "acct_self",
				onSelect() {},
				onClose() {},
			}),
		),
		/input/,
		"emoji grid",
	);
	assert.equal(
		renderToStaticMarkup(
			createElement(view.TeamBridgeMessageList, {
				messages: [reactionMessage],
				labelFor: () => "Bea",
				reactionContext: { accountId: "acct_self", tenantId: "tnt_1" },
			}),
		).includes('data-reaction-layout="chips"'),
		true,
		"a direct row context reaches the shipped chips",
	);
});

test("the shipped reaction hook projects rows and enables a toggle", () => {
	let toggles = 0;
	function Probe() {
		const state = view.useTeamBridgeReactionState({
			conversationId: reactionMessage.conversation_id,
			messageId: reactionMessage.id,
			accountId: "acct_self",
			tenantId: "tnt_1",
			reactions: reactionMessage.reactions,
			toggle: async () => {
				toggles += 1;
				return { message_id: reactionMessage.id, reactions: [] };
			},
		});
		return createElement(
			"span",
			{
				"data-active": String(
					state.rows.length === 1 &&
						state.disabled === false &&
						state.unavailable === false,
				),
			},
			"probe",
		);
	}
	const html = renderToStaticMarkup(createElement(Probe));
	assert.match(html, /data-active="true"/);
	assert.equal(toggles, 0, "rendering alone must not toggle a reaction");
});

test("reaction state mounts only with the capability-derived owner context", () => {
	// `ReactableMessageRow` is the only caller of the reaction hook, and it
	// mounts only when the context is present - so withholding the context is
	// what keeps reaction state and its toggle out of a build the runtime cannot
	// serve. No GET is issued anywhere in the hook; a mount is the observable.
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

test("the toolbar counts a reaction control only in a shipped build", () => {
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
