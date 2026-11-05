import assert from "node:assert/strict";
import { readFileSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE CONVERSATION MENU (operator 2026-11-04): "there's no option to leave a
 * channel ... an ellipsis/context menu on each channel/group to ... join/leave/
 * see members, mute/update notification preferences", and "remove our agents
 * from the channels in addition to ourselves".
 *
 *  - MODEL: `conversationMenuSections` per viewer and conversation type, the
 *    own-agent remove/add authority, the request guard that keeps a stranger's
 *    endpoint off the consent route, and the leave cascade (with and without
 *    `team_bridge_leave_withdraws_agent`, including the partial failure).
 *  - VIEW / PAGE: the header "…" and a rail row's "…" draw the SAME items in
 *    the same order; right-click opens that menu; the trigger takes no flow
 *    space; leave and own-agent writes go through the confirm with the right
 *    request; Escape closes the menu (Radix).
 *
 * jsdom has no layout: the no-shift claim is asserted on the trigger's class
 * (absolute, reserved slot); the Storybook frames under
 * docs/pr-evidence/team-bridge-conversation-menu/ show the pixels.
 */

// jsdom's realm for DOM/event plumbing. Geometry belongs to the browser capture.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		/* jsdom context-bound accessors */
	}
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/*
 * THE DESKTOP BRIDGE, INERT. The page mounts the shared composer, whose own
 * effects reach the bridge on mount — the transcription manager subscribes to
 * `start-speech-to-text` and the composer asks `get-platform-info` — so an
 * absent `window.electron` throws inside the effect and fails the mount before
 * the assertion. This file is about the invite picker, so a bridge that answers
 * "nothing" is the honest stand-in; `agents-composer-mount.test.mjs` states the
 * same recipe for the same reason.
 */
globalThis.window.electron = {
	ipcRenderer: {
		on: () => () => {},
		removeListener: () => {},
		send: () => {},
		invoke: async (channel) =>
			channel === "get-platform-info" ? { platform: "darwin" } : {},
	},
};
// Radix's dialog asks for these on mount; jsdom ships neither.
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.DOMRect ??= class {
	constructor() {
		this.x = 0;
		this.y = 0;
	}
};
const { createRoot } = await import("react-dom/client");

/*
 * THE RAIL'S ONE IMPORT FROM THE CHAT SIDEBAR IS ITS SELECTED-ROW ROLE.
 * `team-bridge-rail.tsx` imports `rowCurrent` from `chat-sidebar.tsx`, which drags
 * MUI and the whole chat tree into a node bundle. The stub exports the SAME
 * literal, read from the shipped source, so the page still renders the real class
 * string without that weight - the same seam `team-bridge-directory.test.mjs` uses.
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
/** The rail's one import from the chat sidebar, and this file's own filter. */
const CHAT_SIDEBAR_MODULE = /chat\/components\/chat-sidebar$/;
const ANY_MODULE = /.*/;

const chatSidebarStub = {
	name: "chat-sidebar-stub",
	setup(pluginBuild) {
		pluginBuild.onResolve({ filter: CHAT_SIDEBAR_MODULE }, () => ({
			path: "chat-sidebar-stub",
			namespace: "stub",
		}));
		pluginBuild.onLoad({ filter: ANY_MODULE, namespace: "stub" }, () => ({
			contents: `export const rowCurrent = ${rowCurrentLiteral};`,
			loader: "js",
		}));
	},
};

const ROOT = process.cwd();
const bundled = await build({
	stdin: {
		contents: `
			export { TeamBridgePageView } from "./src/renderer/src/features/team-bridge/team-bridge-page";
			export { ConversationRailRow, ROW_MENU_TRIGGER } from "./src/renderer/src/features/team-bridge/team-bridge-rail";
			export { TeamBridgeConversationMenu } from "./src/renderer/src/features/team-bridge/team-bridge-conversation-menu";
			export * from "./src/renderer/src/features/team-bridge/team-bridge-conversation-menu-model";
			export { memberRowAction } from "./src/renderer/src/features/team-bridge/team-bridge-members-model";
		`,
		resolveDir: ROOT,
		sourcefile: "team-bridge-conversation-menu.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	/*
	 * ONLY THE PACKAGES THE SUITE ITSELF IMPORTS STAY EXTERNAL, so Node still
	 * holds ONE React and the component's hooks and the test's `act` agree about
	 * the same component.
	 *
	 * WHY NOT `packages: "external"` (what this file used until the fold). That
	 * handed the whole bare-import graph to Node's ESM resolver. Once the page's
	 * rewrite reached `shared/themes/base-theme.ts`, which imports
	 * `@mui/material/styles`, the bundle carried that bare DIRECTORY import
	 * straight through and Node refused it — `ERR_UNSUPPORTED_DIR_IMPORT`,
	 * "Cannot find module .../node_modules/@mui/material/styles" — before a
	 * single assertion ran. Bundling everything the suite does not itself import
	 * keeps the identity guarantee while letting the app's own dependency graph
	 * resolve the way the app's bundler does. `team-bridge-directory.test.mjs`
	 * hit the same import first and states the same recipe.
	 */
	external: [
		"@tanstack/react-query",
		"react",
		"react-dom",
		"react-dom/client",
		"react-router-dom",
		"react/jsx-runtime",
	],
	// Vite's `import.meta.env` is read at IMPORT time by the app's config loader,
	// which the page's chain pulls in (`load-config.ts`): bundling for node leaves
	// it undefined and the module throws before any assertion
	// (`browser-chrome.test.mjs` records the same trap). The URL is dead on purpose.
	define: { "import.meta.env": "__viteEnv" },
	/*
	 * BOTH SHIMS THE APP'S BUNDLER GIVES THE SAME MODULES. `__viteEnv` is Vite's
	 * `import.meta.env`; `require` is what a CJS dependency inside an ESM bundle
	 * needs, resolved from THIS file the way the app resolves it.
	 */
	banner: {
		js: 'const __viteEnv = {}; import { createRequire as __loCreateRequire } from "node:module"; const require = __loCreateRequire(import.meta.url);',
	},
	jsx: "automatic",
	write: false,
	// The page now mounts the shared composer, which pulls the brand mark (.png)
	// and the fonts; a `dataurl` rather than a file keeps the harness asset-free.
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
		// The shared composer imports the brand mark through this alias.
		"@assets": `${ROOT}/src/renderer/src/assets`,
	},
});
// Node resolves bare imports relative to the module's own URL, and a data: URL
// has no directory to resolve from. The bundle is written beside this test,
// imported, and removed on exit (the pattern `team-bridge-archive.test.mjs` uses).
const bundlePath = new URL(
	`./_team-bridge-conversation-menu-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundled.outputFiles[0].text);
process.on("exit", () => {
	try {
		unlinkSync(bundlePath.pathname);
	} catch {
		// already gone
	}
});
const view = await import(bundlePath.href);
after(() => {
	dom.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

// ---------------------------------------------------------------- fixtures

const SELF = "acct_self";
const human = (
	account_id,
	display_label,
	role = "member",
	state = "active",
) => ({
	account_id,
	kind: "human",
	display_label,
	role,
	state,
});
const agent = (account_id, display_label, state, endpoint_id) => ({
	account_id,
	kind: "agent",
	display_label,
	role: "member",
	state: state ?? "active",
	notify: "all",
	...(endpoint_id ? { endpoint_id } : {}),
});
const OWN_AGENT = agent(SELF, "Aida", "active", "bep_aida");
const BEN_AGENT = agent("acct_ben", "Juno", "active", "bep_juno");

const conversation = (overrides = {}) => ({
	id: "bcv_launch",
	tenant_id: "tnt_minerva",
	kind: "channel",
	name: "launch",
	visibility: "tenant",
	agent_capable: true,
	status: "open",
	created_by: SELF,
	last_message_at: "2026-11-04T12:00:00.000Z",
	latest_seq: 12,
	members: [
		human(SELF, "Damian Tran", "owner"),
		human("acct_ben", "Ben Tran"),
		OWN_AGENT,
		BEN_AGENT,
	],
	last_read_seq: 12,
	unread_count: 0,
	muted: false,
	notify: "all",
	can_administer: true,
	...overrides,
});
const withoutOwnAgent = (c) => ({
	...c,
	members: c.members.filter(
		(m) => !(m.kind === "agent" && m.account_id === SELF),
	),
});
const selfPerson = {
	account_id: SELF,
	display_label: "Damian Tran",
	role: "owner",
	bridge_enabled: true,
	bridge_state: "active",
	agent: { endpoint_id: "bep_aida", name: "Aida", state: "active" },
};
const FULL = {
	viewMembers: true,
	addMembers: true,
	join: true,
	notify: true,
	agentNotify: true,
	ownAgent: true,
	leave: true,
	archive: true,
};
const sections = (c, extra = {}) =>
	view.conversationMenuSections({
		conversation: c,
		selfAccountId: SELF,
		selfPerson,
		agentNotifyEnabled: true,
		archivable: c.can_administer === true && !c.builtin,
		wiring: FULL,
		...extra,
	});
const ids = (c, extra) =>
	sections(c, extra)
		.flat()
		.map((item) => item.id);
const item = (c, id) =>
	sections(c)
		.flat()
		.find((row) => row.id === id);

// ---------------------------------------------------------------- model

test("channel, reader owns it with an own active agent: every section in order", () => {
	assert.deepEqual(
		sections(conversation()).map((s) => s.map((i) => i.id)),
		[
			["view_members", "add_members"],
			["notify", "agent_notify"],
			["remove_agent", "leave", "archive"],
		],
	);
	assert.deepEqual(item(conversation(), "remove_agent"), {
		id: "remove_agent",
		agentName: "Aida",
		action: "withdraw",
		endpointId: "bep_aida",
	});
	assert.equal(item(conversation(), "leave").kind, "channel");
});

test("group: Leave group; an invited own agent is a decline", () => {
	const c = conversation({
		kind: "group",
		visibility: "private",
		members: [
			human(SELF, "Damian Tran", "owner"),
			agent(SELF, "Aida", "invited", "bep_aida"),
		],
	});
	assert.equal(item(c, "leave").kind, "group");
	assert.equal(item(c, "remove_agent").action, "decline");
	assert.ok(
		!ids(c).includes("agent_notify"),
		"wake group needs an ACTIVE agent",
	);
});

test("DM: only the notification items apply", () => {
	const c = conversation({
		kind: "dm",
		name: undefined,
		can_administer: false,
	});
	assert.deepEqual(ids(c), ["notify", "agent_notify"]);
});

test("#general: Leave disabled with the org-wide reason; own agent withdraw, then accept", () => {
	const general = conversation({
		builtin: "general",
		name: "general",
		can_administer: false,
		members: [human(SELF, "Damian Tran"), OWN_AGENT],
	});
	assert.deepEqual(item(general, "leave"), {
		id: "leave",
		kind: "channel",
		disabledReason: "org_wide_membership",
	});
	assert.equal(item(general, "remove_agent").action, "withdraw");
	assert.ok(!ids(general).includes("add_members"), "no invites to a built-in");
	assert.ok(!ids(general).includes("archive"));
	// After a withdraw the hub keeps the row as `left`: re-admitted by accept.
	const withdrawn = {
		...general,
		members: [human(SELF, "Damian Tran"), { ...OWN_AGENT, state: "left" }],
	};
	assert.deepEqual(item(withdrawn, "add_agent"), {
		id: "add_agent",
		agentName: "Aida",
		action: "accept",
		endpointId: "bep_aida",
	});
	assert.deepEqual(
		view.ownAgentRequest(
			withdrawn,
			SELF,
			selfPerson,
			item(withdrawn, "add_agent"),
		),
		{ op: "accept", endpointId: "bep_aida" },
	);
	// No row yet: the hub would 404 member_not_found, so the item says why.
	const noRow = withoutOwnAgent(general);
	assert.equal(
		item(noRow, "remove_agent").disabledReason,
		"general_not_member_yet",
	);
	assert.equal(
		view.ownAgentRequest(noRow, SELF, selfPerson, item(noRow, "remove_agent")),
		null,
	);
	assert.equal(view.isMemberNotFound({ code: "member_not_found" }), true);
	// `invited` never occurs in derived #general: it is not a departed row.
	const invitedOnly = {
		...general,
		members: [human(SELF, "Damian Tran"), { ...OWN_AGENT, state: "invited" }],
	};
	assert.equal(item(invitedOnly, "add_agent"), undefined);
});

test("#humans: Leave disabled, no agent item; #agents: Leave allowed, agent remove disabled", () => {
	const humans = conversation({
		builtin: "humans",
		name: "humans",
		can_administer: false,
		members: [human(SELF, "Damian Tran")],
	});
	assert.equal(item(humans, "leave").disabledReason, "org_wide_membership");
	assert.equal(item(humans, "remove_agent"), undefined);
	assert.equal(item(humans, "add_agent"), undefined);
	const agents = conversation({
		builtin: "agents",
		name: "agents",
		can_administer: false,
		members: [human(SELF, "Damian Tran"), OWN_AGENT],
	});
	assert.equal(item(agents, "leave").disabledReason, undefined);
	assert.equal(item(agents, "remove_agent").disabledReason, "agents_builtin");
	assert.equal(
		view.ownAgentRequest(
			agents,
			SELF,
			selfPerson,
			item(agents, "remove_agent"),
		),
		null,
		"a disabled item never yields a request",
	);
});

test("discoverable channel the reader is not in: View is absent, Join offered, nothing else", () => {
	const preview = conversation({
		discoverable: true,
		member: false,
		can_administer: false,
		members: [],
	});
	assert.deepEqual(ids(preview), ["join"]);
});

test("archived and read-only: no write items", () => {
	assert.deepEqual(ids(conversation({ status: "archived" })), ["view_members"]);
	assert.deepEqual(ids(conversation(), { readOnly: true }), ["view_members"]);
});

test("someone else's agent never gets an item; the request guard refuses its endpoint", () => {
	const c = conversation();
	const all = sections(c).flat();
	assert.ok(!all.some((i) => "endpointId" in i && i.endpointId === "bep_juno"));
	// A forged/stale item naming Ben's endpoint never becomes a request.
	for (const forged of [
		{
			id: "remove_agent",
			agentName: "Juno",
			action: "withdraw",
			endpointId: "bep_juno",
		},
		{
			id: "add_agent",
			agentName: "Juno",
			action: "add",
			endpointId: "bep_juno",
		},
		{
			id: "add_agent",
			agentName: "Juno",
			action: "accept",
			endpointId: "bep_juno",
		},
	])
		assert.equal(
			view.ownAgentRequest(c, SELF, selfPerson, forged),
			null,
			forged.action,
		);
	// Members panel: own agent removable without manage rights, Ben's not.
	const nonOwner = conversation({
		members: [
			human("acct_ben", "Ben Tran", "owner"),
			human(SELF, "Damian Tran"),
			OWN_AGENT,
			BEN_AGENT,
		],
	});
	assert.equal(view.memberRowAction(nonOwner, OWN_AGENT, SELF), "withdraw");
	assert.equal(view.memberRowAction(nonOwner, BEN_AGENT, SELF), null);
});

test("re-add after removal: an ordinary channel invites the reader's own endpoint", () => {
	const removed = {
		...conversation(),
		members: [
			human(SELF, "Damian Tran", "owner"),
			{ ...OWN_AGENT, state: "left" },
		],
	};
	const add = item(removed, "add_agent");
	assert.deepEqual(add, {
		id: "add_agent",
		agentName: "Aida",
		action: "add",
		endpointId: "bep_aida",
		disabledReason: undefined,
	});
	assert.deepEqual(view.ownAgentRequest(removed, SELF, selfPerson, add), {
		op: "add",
		member: {
			account_id: SELF,
			kind: "agent",
			endpoint_id: "bep_aida",
			display_label: "Aida",
		},
	});
	// Not agent-capable: drawn, disabled, with its reason.
	const humansOnly = {
		...withoutOwnAgent(conversation()),
		agent_capable: false,
	};
	assert.equal(
		item(humansOnly, "add_agent").disabledReason,
		"agent_not_permitted",
	);
});

// ---------------------------------------------------------------- leave cascade

const recorder = (failWithdraw = null) => {
	const calls = [];
	return {
		calls,
		leave: async () => calls.push("leave"),
		withdraw: async (endpointId) => {
			calls.push(`withdraw:${endpointId}`);
			if (failWithdraw) throw failWithdraw;
		},
	};
};

test("leave WITH team_bridge_leave_withdraws_agent: leave only", async () => {
	const r = recorder();
	const outcome = await view.leaveWithAgentCascade({
		...r,
		serverWithdrawsAgent: true,
		ownActiveAgent: OWN_AGENT,
	});
	assert.deepEqual(outcome, { status: "left" });
	assert.deepEqual(r.calls, ["leave"]);
});

test("leave WITHOUT the capability: leave, then withdraw the own active agent", async () => {
	const r = recorder();
	assert.deepEqual(
		await view.leaveWithAgentCascade({
			...r,
			serverWithdrawsAgent: false,
			ownActiveAgent: OWN_AGENT,
		}),
		{ status: "left" },
	);
	assert.deepEqual(r.calls, ["leave", "withdraw:bep_aida"]);
	const none = recorder();
	await view.leaveWithAgentCascade({
		...none,
		serverWithdrawsAgent: false,
		ownActiveAgent: null,
	});
	assert.deepEqual(none.calls, ["leave"], "no agent here: nothing to withdraw");
});

test("leave partial failure: reported as partial, never as success; a failed leave rejects", async () => {
	const boom = Object.assign(new Error("refused"), { code: "rate_limited" });
	const r = recorder(boom);
	const outcome = await view.leaveWithAgentCascade({
		...r,
		serverWithdrawsAgent: false,
		ownActiveAgent: OWN_AGENT,
	});
	assert.equal(outcome.status, "partial");
	assert.equal(outcome.endpointId, "bep_aida");
	assert.equal(outcome.error, boom);
	const failedLeave = recorder();
	failedLeave.leave = async () => {
		throw new Error("leave refused");
	};
	await assert.rejects(
		view.leaveWithAgentCascade({
			...failedLeave,
			serverWithdrawsAgent: false,
			ownActiveAgent: OWN_AGENT,
		}),
		/leave refused/,
	);
	assert.deepEqual(failedLeave.calls, [], "no withdraw after a refused leave");
	assert.equal(view.withdrawAlreadyDone(boom), false);
});

/* R2: the hub's "nothing active to withdraw" is 409 `invalid_transition` with
   `details.rule=not_active` (agent-server consentTarget), relayed by core and
   kept by the transport as `DesktopControlError.detail` - the same shape
   `invitationFailureKind` reads. A bare `code: "not_active"` never arrives. */
test("withdrawAlreadyDone matches the hub's real refusal shape", () => {
	const refusal = (code, rule) =>
		Object.assign(new Error("refused"), {
			status: 409,
			code,
			detail: { code, details: { rule } },
		});
	assert.equal(
		view.withdrawAlreadyDone(refusal("invalid_transition", "not_active")),
		true,
	);
	assert.equal(
		view.withdrawAlreadyDone({ code: "member_not_found" }),
		true,
		"no row at all is also nothing to withdraw",
	);
	// Negative controls: the old fixture shape and other rules are failures.
	assert.equal(view.withdrawAlreadyDone({ code: "not_active" }), false);
	assert.equal(
		view.withdrawAlreadyDone(refusal("invalid_transition", "builtin")),
		false,
	);
	assert.equal(view.withdrawAlreadyDone(refusal("rate_limited")), false);
});

/* R1: built-ins never cascade. Leave is refused in #general/#humans, so only
   #agents reaches the cascade, and there the hub refuses consent
   (`rule=builtin`): a client withdraw would turn every leave into a permanent
   "partial". */
test("leave in #agents: exactly one request, never a partial, even with an own active agent", async () => {
	const r = recorder(
		Object.assign(new Error("builtin"), {
			code: "invalid_transition",
			detail: { details: { rule: "builtin" } },
		}),
	);
	const outcome = await view.leaveWithAgentCascade({
		...r,
		serverWithdrawsAgent: false,
		ownActiveAgent: OWN_AGENT,
		builtin: "agents",
	});
	assert.deepEqual(outcome, { status: "left" });
	assert.deepEqual(r.calls, ["leave"]);
	// Negative control: the same inputs on an ordinary channel DO cascade, and
	// that same refusal is reported as partial - so the #agents pass above is
	// the built-in check, not a recorder that never withdraws.
	const control = recorder(
		Object.assign(new Error("builtin"), { code: "invalid_transition" }),
	);
	const controlOutcome = await view.leaveWithAgentCascade({
		...control,
		serverWithdrawsAgent: false,
		ownActiveAgent: OWN_AGENT,
		builtin: null,
	});
	assert.equal(controlOutcome.status, "partial");
	assert.deepEqual(control.calls, ["leave", "withdraw:bep_aida"]);
});

/* R3: the hub does not serialize `owner_opted_out`, so a #general row removed
   for a pause looks like an opt-out; its accept refusals get their own copy. */
test("#general re-add refusals: not_opted_out and agent_not_permitted are recognised", () => {
	assert.equal(
		view.generalRejoinRefused({
			code: "invalid_transition",
			detail: { details: { rule: "not_opted_out" } },
		}),
		true,
	);
	assert.equal(
		view.generalRejoinRefused({ code: "agent_not_permitted" }),
		true,
	);
	assert.equal(
		view.generalRejoinRefused({
			code: "invalid_transition",
			detail: { details: { rule: "builtin" } },
		}),
		false,
	);
	assert.equal(view.generalRejoinRefused({ code: "rate_limited" }), false);
});

test("leaving lands on #general, not the rail neighbour", () => {
	const rows = [
		conversation({ id: "bcv_a", name: "alpha" }),
		conversation({ id: "bcv_general", name: "general", builtin: "general" }),
		conversation({ id: "bcv_launch", name: "launch" }),
		conversation({ id: "bcv_z", name: "zeta" }),
	];
	assert.deepEqual(view.landingAfterLeave(rows, "bcv_launch"), {
		type: "conversation",
		id: "bcv_general",
	});
});

// ---------------------------------------------------------------- view

async function mount(t, element) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const render = (el) =>
		act(async () =>
			root.render(
				React.createElement(QueryClientProvider, { client: queryClient }, el),
			),
		);
	await render(element);
	t.after(async () => {
		await act(async () => root.unmount());
		container.remove();
	});
	return { container, render };
}
const openMenuItems = () =>
	[
		...document.querySelectorAll(
			'[role="menu"] [data-menu-item], [role="menu"] [role="menuitemradio"]',
		),
	].map(
		(node) =>
			node.getAttribute("data-menu-item") ?? `radio:${node.textContent}`,
	);
/* Radix opens a DropdownMenu on pointerdown or on Enter/Space/ArrowDown.
   jsdom ships no PointerEvent, so the KEYBOARD path opens it here - which is
   also the path a keyboard reader takes, so it is the one worth pinning. */
const pointerOpen = async (trigger) => {
	assert.ok(trigger, "menu trigger present");
	await act(async () => {
		trigger.focus();
		trigger.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		);
	});
};

const pageProps = (c, extra = {}) => ({
	conversations: [
		c,
		conversation({
			id: "bcv_general",
			name: "general",
			builtin: "general",
			can_administer: false,
			members: [human(SELF, "Damian Tran"), OWN_AGENT],
		}),
	],
	target: { type: "conversation", id: c.id },
	messages: [],
	onTarget: () => {},
	onNewChannel: () => {},
	onScopeChange: () => {},
	people: [selfPerson],
	peopleState: "ready",
	selfAccountId: SELF,
	organizations: [
		{ tenantId: "tnt_minerva", name: "Minerva", role: "owner", unread: 0 },
	],
	agentNotifyCapabilityState: "enabled",
	onNotifyChange: () => {},
	onAgentNotifyChange: () => {},
	onAddMembers: () => Promise.resolve(),
	onMenuLeave: () => Promise.resolve({ status: "left" }),
	onMenuOwnAgent: () => Promise.resolve(),
	onMenuJoin: () => {},
	onArchive: () => {},
	onOpenMembersFor: () => {},
	...extra,
});

test("the header '…' and the row '…' draw the same items in the same order", async (t) => {
	const c = conversation();
	const { container } = await mount(
		t,
		React.createElement(view.TeamBridgePageView, pageProps(c)),
	);
	const header = container.querySelector(
		'button[aria-label="Conversation options"]',
	);
	assert.ok(header, "header trigger");
	await pointerOpen(header);
	const fromHeader = openMenuItems();
	assert.ok(
		fromHeader.includes("leave") && fromHeader.includes("remove_agent"),
		fromHeader.join(),
	);
	await act(async () => {
		document.activeElement.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	});
	assert.equal(
		document.querySelector('[role="menu"]'),
		null,
		"Escape closes (Radix)",
	);
	const row = container.querySelector(
		'button[aria-label="More actions for launch"]',
	);
	assert.ok(row, "row trigger");
	await pointerOpen(row);
	assert.deepEqual(openMenuItems(), fromHeader);
});

test("right-click on a row opens that row's menu; no menu, no preventDefault", async (t) => {
	const c = conversation();
	const { container } = await mount(
		t,
		React.createElement(view.TeamBridgePageView, pageProps(c)),
	);
	const rowButton = container.querySelector(
		'[data-conversation-id="bcv_launch"]',
	);
	const event = new dom.window.MouseEvent("contextmenu", {
		bubbles: true,
		cancelable: true,
	});
	await act(async () => rowButton.dispatchEvent(event));
	assert.equal(event.defaultPrevented, true);
	assert.ok(openMenuItems().includes("leave"));
	// Read-only: no menu is built, so the platform menu is left alone.
	const { container: ro } = await mount(
		t,
		React.createElement(
			view.TeamBridgePageView,
			pageProps(c, { readOnly: true }),
		),
	);
	const roRow = ro.querySelector('[data-conversation-id="bcv_launch"]');
	const roEvent = new dom.window.MouseEvent("contextmenu", {
		bubbles: true,
		cancelable: true,
	});
	await act(async () => roRow.dispatchEvent(roEvent));
	assert.equal(roEvent.defaultPrevented, false);
});

test("the row trigger takes no flow space: absolute, in the reserved trailing slot", async (t) => {
	assert.match(view.ROW_MENU_TRIGGER, /(^| )absolute( |$)/);
	assert.match(view.ROW_MENU_TRIGGER, /end-\[3px\]/);
	assert.match(view.ROW_MENU_TRIGGER, /opacity-0/);
	assert.match(view.ROW_MENU_TRIGGER, /group-hover\/row:opacity-100/);
	assert.match(view.ROW_MENU_TRIGGER, /group-focus-within\/row:opacity-100/);
	const c = conversation({ unread_count: 2 });
	const { container } = await mount(
		t,
		React.createElement(view.TeamBridgePageView, pageProps(c)),
	);
	const trigger = container.querySelector(
		'button[aria-label="More actions for launch"]',
	);
	assert.equal(trigger.className, view.ROW_MENU_TRIGGER);
	// It is a sibling of the row button, not inside it: the label's box is unchanged.
	assert.equal(trigger.closest("[data-conversation-id]"), null);
});

const clickItem = async (id) => {
	const node = document.querySelector(`[role="menu"] [data-menu-item="${id}"]`);
	assert.ok(node, `menu item ${id}`);
	await act(async () => node.click());
};
/* The confirm is the footer's danger/primary button; the dialog also carries
   a corner close button, so pick it by its label, not by position. */
const confirmDialog = async () => {
	const buttons = [
		...document.querySelectorAll('[role="dialog"] button'),
	].filter((node) =>
		/^(Leave|Remove|Add|Decline)$/.test(node.textContent.trim()),
	);
	assert.equal(buttons.length, 1, "one confirm button");
	await act(async () => buttons[0].click());
	await act(async () => {});
};

test("Leave: confirm, then the leave write; selected room lands on #general", async (t) => {
	const calls = [];
	const targets = [];
	const c = conversation();
	const { container } = await mount(
		t,
		React.createElement(
			view.TeamBridgePageView,
			pageProps(c, {
				onMenuLeave: async (row) => {
					calls.push(row.id);
					return { status: "left" };
				},
				onTarget: (next) => targets.push(next),
			}),
		),
	);
	await pointerOpen(
		container.querySelector('button[aria-label="Conversation options"]'),
	);
	await clickItem("leave");
	assert.match(
		document.querySelector('[role="dialog"]').textContent,
		/Leave launch\?/,
	);
	assert.deepEqual(calls, [], "nothing written before the confirm");
	await confirmDialog();
	assert.deepEqual(calls, ["bcv_launch"]);
	assert.deepEqual(targets.at(-1), { type: "conversation", id: "bcv_general" });
});

test("Remove my agent: confirm, then a withdraw naming only the own endpoint", async (t) => {
	const requests = [];
	const c = conversation();
	const { container } = await mount(
		t,
		React.createElement(
			view.TeamBridgePageView,
			pageProps(c, {
				onMenuOwnAgent: async (row, request) =>
					requests.push([row.id, request]),
			}),
		),
	);
	await pointerOpen(
		container.querySelector('button[aria-label="More actions for launch"]'),
	);
	assert.match(
		document.querySelector('[data-menu-item="remove_agent"]').textContent,
		/Remove Aida/,
	);
	await clickItem("remove_agent");
	assert.match(
		document.querySelector('[role="dialog"]').textContent,
		/Remove Aida from launch\?/,
	);
	await confirmDialog();
	assert.deepEqual(requests, [
		["bcv_launch", { op: "withdraw", endpointId: "bep_aida" }],
	]);
});

test("#general withdraw before the agent has a row: the 404 reads as 'not in #general yet'", async (t) => {
	const general = conversation({
		id: "bcv_general",
		name: "general",
		builtin: "general",
		can_administer: false,
		members: [human(SELF, "Damian Tran"), OWN_AGENT],
	});
	const { container } = await mount(
		t,
		React.createElement(
			view.TeamBridgePageView,
			pageProps(general, {
				conversations: [general],
				onMenuOwnAgent: async () => {
					throw Object.assign(new Error("404"), { code: "member_not_found" });
				},
			}),
		),
	);
	await pointerOpen(
		container.querySelector('button[aria-label="Conversation options"]'),
	);
	await clickItem("remove_agent");
	await confirmDialog();
	await act(async () => {});
	assert.match(
		document.querySelector('[role="dialog"] [role="alert"]').textContent,
		/Your agent isn’t in #general yet/,
	);
});

test("#agents leave: the confirm says the agent STAYS, never that it leaves with you", async (t) => {
	const agents = conversation({
		id: "bcv_agents",
		name: "agents",
		builtin: "agents",
		can_administer: false,
		members: [human(SELF, "Damian Tran"), OWN_AGENT],
	});
	const { container } = await mount(
		t,
		React.createElement(
			view.TeamBridgePageView,
			pageProps(agents, { conversations: [agents] }),
		),
	);
	await pointerOpen(
		container.querySelector('button[aria-label="Conversation options"]'),
	);
	await clickItem("leave");
	const text = document.querySelector('[role="dialog"]').textContent;
	assert.match(text, /Your agent stays in #agents; pause it to take it out\./);
	assert.doesNotMatch(text, /leaves with you/);
});

test("an ordinary channel's leave confirm still says the agent leaves with you (control)", async (t) => {
	const { container } = await mount(
		t,
		React.createElement(view.TeamBridgePageView, pageProps(conversation())),
	);
	await pointerOpen(
		container.querySelector('button[aria-label="Conversation options"]'),
	);
	await clickItem("leave");
	const text = document.querySelector('[role="dialog"]').textContent;
	assert.match(text, /your agent leaves with you/);
	assert.doesNotMatch(text, /stays in/);
});

test("Q1: removing an INVITED own agent is a decline, worded as the members panel words it", async (t) => {
	const requests = [];
	const c = conversation({
		kind: "group",
		visibility: "private",
		name: "Ben Two",
		members: [
			human(SELF, "Damian Tran", "owner"),
			agent(SELF, "Aida", "invited", "bep_aida"),
		],
	});
	const { container } = await mount(
		t,
		React.createElement(
			view.TeamBridgePageView,
			pageProps(c, {
				onMenuOwnAgent: async (row, request) =>
					requests.push([row.id, request]),
			}),
		),
	);
	await pointerOpen(
		container.querySelector('button[aria-label="Conversation options"]'),
	);
	await clickItem("remove_agent");
	const text = document.querySelector('[role="dialog"]').textContent;
	assert.match(text, /Decline the invitation for Aida\?/);
	assert.match(text, /Aida will not join Ben Two\./);
	assert.doesNotMatch(text, /stops receiving messages/);
	await confirmDialog();
	assert.equal(requests.length, 1);
	assert.equal(requests[0][1].op, "decline");
});

test("R3: a refused #general re-add says the agent can't rejoin, not 'wasn't saved'", async (t) => {
	const general = conversation({
		id: "bcv_general",
		name: "general",
		builtin: "general",
		can_administer: false,
		members: [human(SELF, "Damian Tran"), { ...OWN_AGENT, state: "removed" }],
	});
	const refusals = [
		{
			code: "invalid_transition",
			detail: { details: { rule: "not_opted_out" } },
		},
		{ code: "agent_not_permitted" },
	];
	for (const refusal of refusals) {
		const { container } = await mount(
			t,
			React.createElement(
				view.TeamBridgePageView,
				pageProps(general, {
					conversations: [general],
					onMenuOwnAgent: async () => {
						throw Object.assign(new Error("refused"), refusal);
					},
				}),
			),
		);
		await pointerOpen(
			container.querySelector('button[aria-label="Conversation options"]'),
		);
		await clickItem("add_agent");
		await confirmDialog();
		await act(async () => {});
		assert.match(
			document.querySelector('[role="dialog"] [role="alert"]').textContent,
			/Your agent can’t rejoin #general right now\. Check it isn’t paused\./,
			refusal.code,
		);
		await act(async () =>
			[...document.querySelectorAll('[role="dialog"] button')]
				.find((n) => n.textContent.trim() === "Cancel")
				.click(),
		);
		container.remove();
	}
});

test("the partial-leave line states the true state and offers the retry", async (t) => {
	let retried = 0;
	const { container } = await mount(
		t,
		React.createElement(
			view.TeamBridgePageView,
			pageProps(conversation(), {
				partialLeave: { name: "launch", retrying: false, retryFailed: false },
				onRetryPartialLeave: () => {
					retried += 1;
				},
				onDismissPartialLeave: () => {},
			}),
		),
	);
	const line = container.querySelector("[data-partial-leave]");
	assert.match(
		line.textContent,
		/You left launch\. Your agent is still in this conversation\./,
	);
	await act(async () => [...line.querySelectorAll("button")][0].click());
	assert.equal(retried, 1);
});
