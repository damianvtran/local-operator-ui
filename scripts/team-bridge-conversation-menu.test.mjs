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
			export { canRenameConversation } from "./src/renderer/src/features/team-bridge/team-bridge-model";
			export { metadataPatch, metadataValidation, editFailure, TeamBridgeEditDraftJournal, renameFailure, normalizedRenameName, TeamBridgeRenameDialog } from "./src/renderer/src/features/team-bridge/team-bridge-rename-dialog";
			// The SAME sonner instance the page's toast manager writes to, so a
			// test can read which toasts were raised without mounting a Toaster.
			export { toast } from "sonner";
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

// ---------------------------------------------------------------- rename

/*
 * RENAME (operator 2026-11-20: "There doesn't seem to be a way to rename a
 * channel in team bridge"). Offered exactly where archive's authority holds
 * (`can_administer`, open, not built-in), widened to groups, never a DM, and
 * only with the daemon's `team_bridge_conversation_rename` capability.
 */
const renameInput = (c) => ({
	renamable: view.canRenameConversation(c),
	wiring: { ...FULL, rename: true },
});

test("rename: right after Add members for an administrator, worded per kind", () => {
	const c = conversation();
	assert.deepEqual(
		sections(c, renameInput(c))[0].map((i) => i.id),
		["view_members", "add_members", "rename"],
	);
	assert.equal(item(c, "rename"), undefined, "no item without the input");
	const group = conversation({ kind: "group", visibility: "private" });
	const groupItem = sections(group, renameInput(group))
		.flat()
		.find((row) => row.id === "rename");
	assert.deepEqual(groupItem, { id: "rename", kind: "group" });
});

test("rename gating: hidden for a non-admin, a DM, a built-in, an archived room, read-only, or no capability", () => {
	const cases = {
		"non-admin": conversation({ can_administer: false }),
		dm: conversation({ kind: "dm", name: undefined }),
		builtin: conversation({ name: "general", builtin: "general" }),
		archived: conversation({ status: "archived" }),
	};
	for (const [label, c] of Object.entries(cases)) {
		assert.equal(view.canRenameConversation(c), false, label);
		assert.ok(!ids(c, renameInput(c)).includes("rename"), label);
	}
	const c = conversation();
	assert.ok(
		!ids(c, { ...renameInput(c), readOnly: true }).includes("rename"),
		"read-only bridge",
	);
	// The capability is folded into `renamable` by the page; absent, no item.
	assert.ok(
		!ids(c, { ...renameInput(c), renamable: false }).includes("rename"),
		"capability absent",
	);
	// Built-in defended in the model too, even if a caller passed renamable.
	const general = cases.builtin;
	assert.ok(
		!ids(general, {
			renamable: true,
			wiring: { ...FULL, rename: true },
		}).includes("rename"),
	);
});

test("renameFailure maps the hub's refusals; normalisation matches create", () => {
	const err = (status, code, details) =>
		Object.assign(new Error("x"), {
			status,
			code,
			detail: details ? { details } : undefined,
		});
	assert.deepEqual(
		view.renameFailure(
			err(409, "conversation_name_taken", {
				conversation_id: "bcv_2",
				name: "launch-2",
			}),
			"typed",
		),
		{ kind: "taken", name: "launch-2" },
	);
	assert.deepEqual(
		view.renameFailure(err(409, "conversation_name_taken"), "typed"),
		{ kind: "taken", name: "typed" },
	);
	assert.equal(
		view.renameFailure(err(409, "conversation_archived"), "x").kind,
		"archived",
	);
	assert.equal(
		view.renameFailure(err(403, "forbidden"), "x").kind,
		"forbidden",
	);
	assert.equal(
		view.renameFailure(err(400, "invalid_request"), "x").kind,
		"invalid",
	);
	// Each rule of the hub's rename sanitiser has its own sentence.
	for (const [rule, kind] of [
		["empty", "empty"],
		["too_long", "too_long"],
		["control_character", "characters"],
		["invisible_character", "characters"],
		["unsupported_space", "characters"],
		["invalid_utf8", "characters"],
		["something_new", "invalid"],
	])
		assert.equal(
			view.renameFailure(
				err(400, "invalid_request", { field: "name", rule }),
				"x",
			).kind,
			kind,
			rule,
		);
	assert.equal(view.renameFailure(err(500, "internal"), "x").kind, "failed");
	assert.equal(view.renameFailure(new Error("ipc"), "x").kind, "failed");
	assert.equal(view.normalizedRenameName("channel", " #QA  Team "), "qa-team");
	assert.equal(
		view.normalizedRenameName("group", "  Launch   crew "),
		"Launch crew",
	);
});

const renameField = () =>
	document.querySelector('[role="dialog"] [data-rename-field]');
const renameSave = () =>
	document.querySelector('[role="dialog"] [data-rename-save]');
const typeName = async (value) => {
	const input = renameField();
	const setter = Object.getOwnPropertyDescriptor(
		dom.window.HTMLInputElement.prototype,
		"value",
	).set;
	await act(async () => {
		setter.call(input, value);
		input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
};

test("rename item: hidden without the capability, opens a prefilled dialog with it", async (t) => {
	const c = conversation();
	const { container, render } = await mount(
		t,
		React.createElement(
			view.TeamBridgePageView,
			pageProps(c, { onRename: async () => {} }),
		),
	);
	const trigger = () =>
		container.querySelector('button[aria-label="Conversation options"]');
	await pointerOpen(trigger());
	assert.ok(!openMenuItems().includes("rename"), "unknown capability: no item");
	await act(async () => {
		document.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	});
	await render(
		React.createElement(
			view.TeamBridgePageView,
			pageProps(c, {
				onRename: async () => {},
				renameCapabilityState: "enabled",
			}),
		),
	);
	await pointerOpen(trigger());
	const items = openMenuItems();
	assert.equal(items[items.indexOf("add_members") + 1], "rename");
	assert.match(
		document.querySelector('[role="menu"] [data-menu-item="rename"]')
			.textContent,
		/Rename channel…/,
	);
	await clickItem("rename");
	assert.equal(renameField().value, "launch");
	assert.equal(renameSave().disabled, true, "unchanged name cannot be saved");
	await typeName("   ");
	assert.equal(renameSave().disabled, true, "empty name cannot be saved");
	// 64 code points is the hub's bound; emoji count once, as they do there.
	await typeName("🚀".repeat(64));
	assert.equal(renameSave().disabled, false, "64 code points is allowed");
	await typeName("🚀".repeat(65));
	assert.equal(renameSave().disabled, true, "65 code points is not");
	assert.match(
		document.querySelector('[role="dialog"] [role="alert"]').textContent,
		/up to 64 characters/,
	);
});

test("rename dialog: Enter submits the normalised name; a taken name is explained inline, then success closes", async (t) => {
	const calls = [];
	let answer = Promise.reject(
		Object.assign(new Error("taken"), {
			status: 409,
			code: "conversation_name_taken",
			detail: { details: { conversation_id: "bcv_x", name: "launch-crew" } },
		}),
	);
	answer.catch(() => {});
	const c = conversation();
	const { container } = await mount(
		t,
		React.createElement(
			view.TeamBridgePageView,
			pageProps(c, {
				renameCapabilityState: "enabled",
				onRename: (row, name) => {
					calls.push([row.id, name]);
					return answer;
				},
			}),
		),
	);
	await pointerOpen(
		container.querySelector('button[aria-label="Conversation options"]'),
	);
	await clickItem("rename");
	await typeName("Launch Crew");
	assert.equal(renameSave().disabled, false);
	await act(async () => {
		renameField().form.requestSubmit();
	});
	await act(async () => {});
	assert.deepEqual(calls, [["bcv_launch", "launch-crew"]]);
	const alert = document.querySelector('[role="dialog"] [role="alert"]');
	assert.ok(alert, "the refusal is shown in the dialog");
	assert.match(alert.textContent, /#launch-crew already exists/);
	assert.equal(renameField().value, "Launch Crew", "typed text kept to edit");
	answer = Promise.resolve({});
	await typeName("launch-team");
	await act(async () => renameSave().click());
	await act(async () => {});
	assert.deepEqual(calls.at(-1), ["bcv_launch", "launch-team"]);
	assert.equal(document.querySelector('[role="dialog"]'), null, "closed");
});

/*
 * REVIEW ROUND 1 (R1 = U1 = Q1, U2, R3 = U3, D2, D3, D4). The page is driven
 * the way the container drives it: the row the dialog was opened for is
 * re-rendered with the optimistic name while the save is in flight and with
 * the rolled-back name after the refusal, as the mutation's cache writes do.
 */
const deferred = () => {
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	promise.catch(() => {});
	return { promise, resolve, reject };
};
const takenError = () =>
	Object.assign(new Error("taken"), {
		status: 409,
		code: "conversation_name_taken",
		detail: { details: { conversation_id: "bcv_x", name: "launch-crew" } },
	});
const renameAlert = () =>
	document.querySelector('[role="dialog"] [role="alert"]');
const pressEscape = () =>
	act(async () => {
		document.activeElement.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	});

test("rename dialog: the optimistic write and the rollback keep the typed name, and an edit clears the refusal", async (t) => {
	const pending = deferred();
	const c = conversation();
	const props = (row) =>
		pageProps(row, {
			renameCapabilityState: "enabled",
			onRename: () => pending.promise,
		});
	const { container, render } = await mount(
		t,
		React.createElement(view.TeamBridgePageView, props(c)),
	);
	await pointerOpen(
		container.querySelector('button[aria-label="Conversation options"]'),
	);
	await clickItem("rename");
	await typeName("Launch Crew");
	await act(async () => renameField().form.requestSubmit());
	// The mutation's optimistic cache write renames the row under the dialog.
	await render(
		React.createElement(
			view.TeamBridgePageView,
			props(conversation({ name: "launch-crew" })),
		),
	);
	assert.equal(renameField().value, "Launch Crew", "optimistic write keeps it");
	assert.equal(renameField().readOnly, true, "read-only while saving (D4)");
	assert.equal(renameSave().disabled, true, "no second save while pending");
	// The refusal rolls the row back.
	pending.reject(takenError());
	await render(React.createElement(view.TeamBridgePageView, props(c)));
	await act(async () => {});
	assert.equal(renameField().value, "Launch Crew", "rollback keeps it");
	assert.equal(renameField().readOnly, false);
	assert.equal(renameSave().disabled, false, "Save is ready for a retry");
	assert.match(renameAlert().textContent, /#launch-crew already exists/);
	assert.equal(renameField().getAttribute("aria-invalid"), "true");
	// D2: `#name` is one isolated run, so an RTL sentence cannot split it.
	assert.equal(
		renameAlert().querySelector("bdi[data-rename-name]").textContent,
		"#launch-crew",
	);
	// U2: the first edit retires the refusal and the invalid state.
	await typeName("Launch Crew 2");
	assert.equal(renameAlert(), null, "the refusal clears on the first edit");
	assert.equal(renameField().getAttribute("aria-invalid"), null);
});

test("rename dialog: archived or forbidden leaves only Cancel", async (t) => {
	for (const [status, code] of [
		[409, "conversation_archived"],
		[403, "forbidden"],
	]) {
		const c = conversation();
		const { container } = await mount(
			t,
			React.createElement(
				view.TeamBridgePageView,
				pageProps(c, {
					renameCapabilityState: "enabled",
					onRename: () => {
						const refusal = Promise.reject(
							Object.assign(new Error(code), { status, code }),
						);
						refusal.catch(() => {});
						return refusal;
					},
				}),
			),
		);
		await pointerOpen(
			container.querySelector('button[aria-label="Conversation options"]'),
		);
		await clickItem("rename");
		await typeName("launch-two");
		await act(async () => renameField().form.requestSubmit());
		await act(async () => {});
		assert.ok(renameAlert(), code);
		assert.equal(renameField().disabled, true, `${code}: field disabled`);
		assert.equal(renameSave().disabled, true, `${code}: Save disabled`);
		await pressEscape();
	}
});

test("rename: an outcome only acts on the dialog open that sent it; a late refusal is a toast", async (t) => {
	const first = deferred();
	const second = deferred();
	const answers = [first, second];
	const c = conversation();
	const { container } = await mount(
		t,
		React.createElement(
			view.TeamBridgePageView,
			pageProps(c, {
				renameCapabilityState: "enabled",
				onRename: () => answers.shift().promise,
			}),
		),
	);
	const openRename = async () => {
		await pointerOpen(
			container.querySelector('button[aria-label="Conversation options"]'),
		);
		await clickItem("rename");
	};
	const toastsBefore = view.toast.getHistory().length;
	// Save, close while saving, reopen: the first request is still in flight.
	await openRename();
	await typeName("launch-one");
	await act(async () => renameField().form.requestSubmit());
	await pressEscape();
	assert.equal(document.querySelector('[role="dialog"]'), null);
	await openRename();
	await typeName("launch-two");
	assert.equal(
		renameSave().disabled,
		true,
		"a reopen does not re-enable Save while the first save is in flight",
	);
	// The first request succeeds: the newer dialog stays open.
	await act(async () => first.resolve({}));
	assert.ok(document.querySelector('[role="dialog"]'), "newer open untouched");
	assert.equal(renameSave().disabled, false, "free once the request settled");
	// The second save is refused after its dialog closed: a toast, not silence,
	// and nothing written into a later dialog.
	await act(async () => renameField().form.requestSubmit());
	await pressEscape();
	await act(async () => second.reject(takenError()));
	const raised = view.toast.getHistory().slice(toastsBefore);
	assert.equal(raised.length, 1, "one toast for the late refusal");
	assert.equal(raised[0].title, "The new name wasn't saved. Try again.");
	await openRename();
	assert.equal(renameAlert(), null, "the late refusal annotates no new dialog");
});

// Metadata tests are DOM/contract fixtures, not rendered pixels or live writes.
const metadataDraft = (patch = {}) => ({
	baselineName: "Legacy Channel",
	baselineTopic: "old",
	name: "Legacy Channel",
	topic: "old",
	pending: false,
	error: null,
	...patch,
});
const editName = () => document.querySelector("[data-edit-name]");
const editTopic = () => document.querySelector("[data-edit-topic]");
const editSave = () =>
	document.querySelector('[role="dialog"] button[type="submit"]');
async function typeMetadata(field, value) {
	const prototype =
		field.tagName === "TEXTAREA"
			? dom.window.HTMLTextAreaElement.prototype
			: dom.window.HTMLInputElement.prototype;
	await act(async () => {
		Object.getOwnPropertyDescriptor(prototype, "value").set.call(field, value);
		field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
}

test("metadata: omission preserves legacy name, explicit clear and code-point validation", () => {
	assert.deepEqual(
		view.metadataPatch("channel", metadataDraft({ topic: "new\ncontext" })),
		{ topic: "new\ncontext" },
	);
	assert.deepEqual(
		view.metadataPatch("channel", metadataDraft({ topic: "  " })),
		{ topic: "" },
	);
	assert.deepEqual(view.metadataPatch("channel", metadataDraft()), {});
	assert.deepEqual(
		view.metadataPatch("channel", metadataDraft({ name: "New Channel" })),
		{ name: "new-channel" },
	);
	assert.equal(view.metadataValidation({ topic: "🚀".repeat(512) }), null);
	assert.equal(
		view.metadataValidation({ topic: "🚀".repeat(513) }).kind,
		"topic_too_long",
	);
	assert.equal(
		view.metadataValidation({ topic: "line 1\nline 2\tmore\r" }),
		null,
	);
	assert.equal(
		view.metadataValidation({ topic: "bad\u0085" }).kind,
		"topic_characters",
	);
	assert.equal(
		view.metadataValidation(
			view.metadataPatch(
				"channel",
				metadataDraft({
					baselineName: "x".repeat(100),
					name: "x".repeat(100),
					topic: "new",
				}),
			),
		),
		null,
	);
	assert.equal(
		view.editFailure(
			{
				status: 400,
				code: "invalid_request",
				detail: { details: { field: "topic", rule: "too_long" } },
			},
			"x",
		).kind,
		"topic_too_long",
	);
});

test("metadata: edit replaces rename, failure retains draft across refetch and reopen", async (t) => {
	const c = conversation({ name: "Legacy Channel", topic: "old" });
	const calls = [];
	let answer = deferred();
	const journal = new view.TeamBridgeEditDraftJournal();
	const props = (row = c) =>
		pageProps(row, {
			metadataDrafts: journal,
			renameCapabilityState: "enabled",
			updateCapabilityState: "enabled",
			onUpdate: (row, patch) => {
				calls.push([row.tenant_id, row.id, patch]);
				return answer.promise;
			},
		});
	const { container, render } = await mount(
		t,
		React.createElement(view.TeamBridgePageView, props()),
	);
	const open = async () => {
		await pointerOpen(
			container.querySelector('button[aria-label="Conversation options"]'),
		);
		await clickItem("rename");
	};
	await open();
	assert.equal(editName().value, "Legacy Channel");
	assert.equal(editSave().disabled, true);
	await typeMetadata(editTopic(), "new\ncontext");
	assert.equal(editSave().disabled, false);
	await act(async () =>
		editTopic().dispatchEvent(
			new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		),
	);
	assert.equal(calls.length, 0, "textarea Enter is not submit");
	await act(async () => editTopic().form.requestSubmit());
	assert.equal(editSave().disabled, true);
	assert.deepEqual(calls[0], [c.tenant_id, c.id, { topic: "new\ncontext" }]);
	await act(async () => editTopic().form.requestSubmit());
	assert.equal(calls.length, 1, "duplicate submit refused");
	await render(
		React.createElement(
			view.TeamBridgePageView,
			props({ ...c, topic: "external update" }),
		),
	);
	assert.equal(editTopic().value, "new\ncontext", "refetch never resets draft");
	await act(async () => answer.reject(new Error("offline")));
	assert.ok(document.querySelector('[role="dialog"] [role="alert"]'));
	assert.equal(editTopic().value, "new\ncontext");
	await pressEscape();
	await open();
	assert.equal(
		editTopic().value,
		"new\ncontext",
		"failed draft retained on reopen",
	);
	answer = deferred();
	await typeMetadata(editTopic(), "");
	await act(async () => editSave().click());
	assert.deepEqual(calls.at(-1)[2], { topic: "" });
	await act(async () => answer.resolve({ name: "Legacy Channel" }));
	assert.equal(document.querySelector('[role="dialog"]'), null);
});

test("metadata: cancel and Escape discard unsent edits without writing", async (t) => {
	const calls = [];
	const c = conversation({ topic: "old" });
	const { container } = await mount(
		t,
		React.createElement(
			view.TeamBridgePageView,
			pageProps(c, {
				updateCapabilityState: "enabled",
				onUpdate: (...args) => {
					calls.push(args);
					return Promise.resolve({});
				},
			}),
		),
	);
	const open = async () => {
		await pointerOpen(
			container.querySelector('button[aria-label="Conversation options"]'),
		);
		await clickItem("rename");
	};
	await open();
	await typeMetadata(editTopic(), "not saved");
	await pressEscape();
	await open();
	assert.equal(editTopic().value, "old");
	await act(async () =>
		[...document.querySelectorAll('[role="dialog"] button')]
			.find((b) => b.textContent === "Cancel")
			.click(),
	);
	assert.equal(calls.length, 0);
});

test("metadata: pending dismissed draft observes settlement after view remount", async (t) => {
	const pending = deferred();
	const journal = new view.TeamBridgeEditDraftJournal();
	const c = conversation({ topic: "old" });
	const props = {
		metadataDrafts: journal,
		updateCapabilityState: "enabled",
		onUpdate: () => pending.promise,
	};
	const { container, render } = await mount(
		t,
		React.createElement(view.TeamBridgePageView, {
			...pageProps(c, props),
			key: "first",
		}),
	);
	const open = async () => {
		await pointerOpen(
			container.querySelector('button[aria-label="Conversation options"]'),
		);
		await clickItem("rename");
	};
	await open();
	await typeMetadata(editTopic(), "pending draft");
	await act(async () => editSave().click());
	await pressEscape();
	await render(
		React.createElement(view.TeamBridgePageView, {
			...pageProps(c, props),
			key: "second",
		}),
	);
	await open();
	assert.equal(editTopic().value, "pending draft");
	assert.equal(editSave().disabled, true);
	await act(async () => pending.reject(new Error("offline")));
	assert.equal(
		editSave().disabled,
		false,
		"new view observes old request settlement",
	);
	assert.equal(editTopic().value, "pending draft");
});

test("metadata: group supports both editable fields and invalid topic disables Save", async (t) => {
	const calls = [];
	const c = conversation({ kind: "group", name: "Legacy Group", topic: "old" });
	const { container } = await mount(
		t,
		React.createElement(
			view.TeamBridgePageView,
			pageProps(c, {
				updateCapabilityState: "enabled",
				onUpdate: (row, patch) => {
					calls.push(patch);
					return Promise.resolve({});
				},
			}),
		),
	);
	await pointerOpen(
		container.querySelector('button[aria-label="Conversation options"]'),
	);
	assert.ok(
		document
			.querySelector('[data-menu-item="rename"]')
			.textContent.includes("Edit group"),
	);
	await clickItem("rename");
	await typeMetadata(editName(), " New   Group ");
	await typeMetadata(editTopic(), "🚀".repeat(513));
	assert.equal(editSave().disabled, true);
	assert.equal(editTopic().getAttribute("aria-invalid"), "true");
	await typeMetadata(editTopic(), "new\ncontext");
	await act(async () => editSave().click());
	assert.deepEqual(calls, [{ name: "New Group", topic: "new\ncontext" }]);
});

test("metadata: unknown update capability never relabels legacy rename or sends topic", async (t) => {
	const calls = [];
	const c = conversation({ topic: "old" });
	const { container } = await mount(
		t,
		React.createElement(
			view.TeamBridgePageView,
			pageProps(c, {
				renameCapabilityState: "enabled",
				updateCapabilityState: "unknown",
				onRename: (row, name) => {
					calls.push(name);
					return Promise.resolve({});
				},
				onUpdate: () => {
					throw new Error("must not dispatch update");
				},
			}),
		),
	);
	await pointerOpen(
		container.querySelector('button[aria-label="Conversation options"]'),
	);
	assert.ok(
		document
			.querySelector('[data-menu-item="rename"]')
			.textContent.includes("Rename channel"),
	);
	await clickItem("rename");
	assert.equal(editTopic(), null);
	await typeName("next");
	await act(async () => renameSave().click());
	assert.deepEqual(calls, ["next"]);
});
