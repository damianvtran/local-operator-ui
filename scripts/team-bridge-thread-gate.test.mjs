import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Team Bridge's capability gates, exercised through the SHIPPED modules.
 *
 * WHY THIS FILE EXISTS. The pane and the reply-in-thread affordance carry
 * cross-account isolation defects inherited from #1304, so this build must not
 * reach them however the runtime answers. The matrix below is the fail-closed
 * rule (`unknown`, `below-version`, `unpaired` AND `enabled` all hidden) and
 * the source half pins every mount and route the reviewer census named: a
 * capability that answers `enabled` is the easiest path to accidentally reopen,
 * so it is the case the render test in `team-bridge-directory.test.mjs` uses.
 *
 * THE REACTIONS HOLD IS THE SAME SHAPE. The shipped runtime serves no reaction
 * route and the old reaction path is not reviewed for account/retry safety, so
 * `TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD` (false) dominates the
 * `team_bridge_reactions` capability: chips, react button and picker stay
 * hidden for every answer, `enabled` included. Its matrix runs through the REAL
 * `desktopFeatureState`, with the page rendered for each answer, so the payload
 * shape (missing key, 0, 1, unpaired, no data) is the one the capability read
 * actually produces; the return path is proven with the flag on.
 *
 * THE RETURN PATH IS TESTED, NOT ASSUMED. `teamBridgeThreadsAvailable` accepts
 * the shipped flag so the capability half can be proven without shipping the
 * surface: `enabled` with the flag on is the ONLY true answer.
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
	/*
	 * ONLY THE PACKAGES THE SUITE ITSELF IMPORTS STAY EXTERNAL. `packages:
	 * "external"` left the whole bare-import graph to node's ESM resolver, and the
	 * shared composer's chain reaches `@mui/material/styles` - a DIRECTORY import,
	 * which Node refuses ("Cannot find module .../styles"). Bundling everything the
	 * suite does not itself import keeps one React (the real identity check) while
	 * letting the app's own dependency graph resolve the way the app's bundler does.
	 */
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
	tsconfig: "tsconfig.web.json",
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
	/*
	 * ONLY WHAT THIS BUNDLE'S OWN PROBE IMPORTS STAYS EXTERNAL: left as `packages:
	 * "external"` the composer's chain (reached through the shared composer the page
	 * now mounts) put `@mui/material/styles` - a DIRECTORY import - in front of
	 * node's ESM resolver, which refuses it.
	 */
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
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

test("the build holds the surface: every capability answer is hidden", () => {
	for (const state of [
		undefined,
		"unknown",
		"below-version",
		"unpaired",
		"enabled",
	]) {
		assert.equal(
			gate.teamBridgeThreadsAvailable(state),
			false,
			`${String(state)} must leave the thread surface hidden`,
		);
	}
	assert.equal(
		gate.TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD,
		false,
		"the constant, not the runtime, closes the surface",
	);
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

test("a notification click lands on the conversation, never on a thread", () => {
	const target = {
		conversationId: "bcv_1",
		tenantId: "tnt_1",
		threadId: "bmsg_root",
	};
	const path = gate.teamBridgeOpenPath(target);
	assert.match(path, /^\/team-bridge\?/);
	assert.match(path, /tenant=tnt_1/);
	assert.match(path, /conversation=bcv_1/);
	assert.doesNotMatch(path, /thread=/, "a held build must not route a thread");
	assert.doesNotMatch(path, /bmsg_root/);
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

test("the reactions hold hides every capability answer, `enabled` included", () => {
	for (const { label, caps, state } of capabilityPayloads) {
		assert.equal(
			gate.desktopFeatureState(caps, "team_bridge_reactions"),
			state,
			`${label}: capability state`,
		);
		assert.equal(
			gate.teamBridgeReactionsAvailable(
				gate.desktopFeatureState(caps, "team_bridge_reactions"),
			),
			false,
			`${label}: the constant, not the runtime, closes the surface`,
		);
	}
	assert.equal(gate.TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD, false);
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

test("reaction chips and the react control are absent for every answer, `enabled` included", () => {
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

test("every directly exported reaction entry point honours the hold", () => {
	/*
	 * A page that withholds the context is not enough: a story, a rig or a
	 * future call site can import these directly. Each export is guarded before
	 * its body's hooks mount, so every one renders nothing while the constant is
	 * false. The message list is included because it is the row that would pass
	 * a context into them.
	 */
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
	assert.equal(
		renderToStaticMarkup(
			createElement(view.TeamBridgeReactionChips, { state }),
		),
		"",
		"chips",
	);
	assert.equal(
		renderToStaticMarkup(
			createElement(view.TeamBridgeReactionPicker, {
				state,
				open: true,
				onOpenChange() {},
				children: createElement("button", null, "react"),
			}),
		),
		"",
		"picker",
	);
	assert.equal(
		renderToStaticMarkup(
			createElement(view.TeamBridgeReactions, {
				conversationId: reactionMessage.conversation_id,
				messageId: reactionMessage.id,
				accountId: "acct_self",
				tenantId: "tnt_1",
				reactions: reactionMessage.reactions,
			}),
		),
		"",
		"standalone chips",
	);
	assert.equal(
		renderToStaticMarkup(
			createElement(view.TeamBridgeEmojiPicker, {
				accountId: "acct_self",
				onSelect() {},
				onClose() {},
			}),
		),
		"",
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
		false,
		"a direct row context cannot reach the chips",
	);
});

test("the reaction hook is inert while held and issues no toggle", () => {
	/*
	 * The hook still runs its hooks (a conditional hook would break callers) but
	 * returns an inert state: no rows projected from the message, disabled and
	 * unavailable true, and `choose` a no-op. The toggle spy is the proof that no
	 * reaction read or write is issued.
	 */
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
		void state.choose("👍");
		return createElement(
			"span",
			{
				"data-inert": String(
					state.rows.length === 0 &&
						state.disabled === true &&
						state.unavailable === true,
				),
			},
			"probe",
		);
	}
	const html = renderToStaticMarkup(createElement(Probe));
	assert.match(html, /data-inert="true"/);
	assert.equal(toggles, 0, "no toggle may be issued while held");
});

test("no reaction state is mounted while the hold is on", () => {
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

test("the toolbar counts no reaction control while held", () => {
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
