import assert from "node:assert/strict";
import { readFileSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE MEMBERS PANEL (header count -> right drawer, operator 2026-11-04).
 *
 * Three layers, the same split `team-bridge-members.test.mjs` uses:
 *
 *  - MODEL: the authority table in `team-bridge-members-model.ts`, asserted
 *    row by row - owner / non-owner, the reader's own human row, own agent
 *    invited vs active, someone else's agent, built-in #general vs #agents,
 *    a DM and an archived conversation. These are the hub's own rules (agreed
 *    with the Team Bridge hub owner); a regression here offers a control the
 *    server will refuse, or hides one it would accept.
 *  - WIRE: the new `team_bridge.conversations.leave` op and consent `withdraw`
 *    reach core's routes in the shape core's models accept
 *    (`ConversationConsentIn`: withdraw carries no consent_version).
 *  - VIEW / PAGE: the shipped panel in jsdom - rows, search threshold, the
 *    confirm naming member and conversation, Escape returning focus to the
 *    header count, mutual exclusion with nothing else open, and LIVE UPDATE:
 *    a new `conversation` prop (what a refetch or a join/leave event hands the
 *    page) re-renders the rows without remounting.
 *
 * jsdom has no layout: nothing here claims a size or a pixel; the Storybook
 * captures under docs/pr-evidence/team-bridge-members-panel/ do that.
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
const ADD_MEMBERS_BUTTON = /Add members/;

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
			export { TeamBridgeMembersPanel } from "./src/renderer/src/features/team-bridge/team-bridge-members-panel";
			export { TeamBridgePageView } from "./src/renderer/src/features/team-bridge/team-bridge-page";
			export { memberPanelNote, memberPanelRows, memberRowAction, otherAgentRemovable, MEMBER_PANEL_SEARCH_THRESHOLD } from "./src/renderer/src/features/team-bridge/team-bridge-members-model";
			export { desktopRequestSchema, desktopEndpoint } from "./src/shared/desktop-contract";
			export { setLocale } from "./src/renderer/src/shared/i18n";
		`,
		resolveDir: ROOT,
		sourcefile: "team-bridge-members-panel.mjs",
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
	`./_team-bridge-members-panel-${process.pid}.mjs`,
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
const agent = (account_id, display_label, state = "active", extra = {}) => ({
	account_id,
	kind: "agent",
	display_label,
	role: "member",
	state,
	...extra,
});

/** The reader (acct_self) owns the group; Ben is a member; both have agents. */
const conversation = (overrides = {}) => ({
	id: "bcv_qa",
	tenant_id: "tnt_minerva",
	kind: "group",
	name: "qa-coordination",
	visibility: "private",
	agent_capable: true,
	status: "open",
	created_by: "acct_self",
	last_message_at: "2026-11-02T12:00:00.000Z",
	latest_seq: 12,
	members: [
		human("acct_self", "Damian Tran", "owner"),
		human("acct_ben", "Ben Tran"),
		agent("acct_self", "Aida", "active", { endpoint_id: "bep_aida" }),
		agent("acct_ben", "Juno", "invited"),
		human("acct_gone", "Gone Person", "member", "left"),
	],
	last_read_seq: 12,
	unread_count: 0,
	muted: false,
	can_administer: true,
	...overrides,
});

const directory = [
	{
		account_id: "acct_self",
		display_label: "Damian Tran",
		role: "owner",
		bridge_enabled: true,
		bridge_state: "active",
		agent: { endpoint_id: "bep_aida", name: "Aida", state: "active" },
	},
	{
		account_id: "acct_ben",
		display_label: "Ben Tran",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active",
		agent: { endpoint_id: "bep_juno", name: "Juno", state: "active" },
	},
];

const chiefLabel = (agentName, person) => `${agentName} (${person})`;
const actionFor = (c, member, self = "acct_self") =>
	view.memberRowAction(c, member, self);
const SELF = human("acct_self", "Damian Tran", "owner");
const SELF_MEMBER = human("acct_self", "Damian Tran");
const BEN = human("acct_ben", "Ben Tran");
const OWN_AGENT = agent("acct_self", "Aida");
const OWN_AGENT_INVITED = agent("acct_self", "Aida", "invited");
const BEN_AGENT = agent("acct_ben", "Juno");

// ---------------------------------------------------------------- model

test("owner: removes another person, leaves themselves", () => {
	const c = conversation();
	assert.equal(actionFor(c, BEN), "remove");
	assert.equal(actionFor(c, SELF), "leave");
});

test("non-owner: no remove on anyone else, Leave on self", () => {
	const c = conversation({
		members: [human("acct_owner", "Owner", "owner"), SELF_MEMBER, BEN],
	});
	assert.equal(actionFor(c, BEN), null);
	assert.equal(actionFor(c, human("acct_owner", "Owner", "owner")), null);
	assert.equal(actionFor(c, SELF_MEMBER), "leave");
});

test("own agent: withdraw when active, decline when invited; nobody else's", () => {
	const c = conversation();
	assert.equal(actionFor(c, OWN_AGENT), "withdraw");
	assert.equal(actionFor(c, OWN_AGENT_INVITED), "decline");
	// Someone else's agent: no route can address it yet, even for the owner.
	assert.equal(actionFor(c, BEN_AGENT), null);
	assert.equal(view.otherAgentRemovable(c, BEN_AGENT), false);
});

test("built-ins: #general and #humans offer nothing; #agents allows Leave only", () => {
	for (const builtin of ["general", "humans"]) {
		const c = conversation({ kind: "channel", builtin });
		assert.equal(actionFor(c, BEN), null, `${builtin} remove`);
		assert.equal(actionFor(c, SELF), null, `${builtin} leave`);
		assert.equal(actionFor(c, OWN_AGENT), null, `${builtin} own agent`);
		assert.equal(view.memberPanelNote(c), builtin);
	}
	const agents = conversation({ kind: "channel", builtin: "agents" });
	assert.equal(actionFor(agents, BEN), null);
	assert.equal(actionFor(agents, SELF), "leave");
	assert.equal(actionFor(agents, OWN_AGENT), null);
	assert.equal(view.memberPanelNote(agents), "agents");
});

test("a DM and an archived conversation are read-only", () => {
	const dm = conversation({ kind: "dm" });
	const archived = conversation({ status: "archived" });
	for (const c of [dm, archived])
		for (const member of [BEN, SELF, OWN_AGENT, OWN_AGENT_INVITED])
			assert.equal(actionFor(c, member), null);
	assert.equal(view.memberPanelNote(dm), "dm");
	assert.equal(view.memberPanelNote(archived), null);
});

test("an unresolved reader gets no controls (fail closed)", () => {
	const c = conversation();
	for (const member of [BEN, SELF, OWN_AGENT])
		assert.equal(view.memberRowAction(c, member, undefined), null);
});

test("rows: current members only, owner first, invited agent is pending approval", () => {
	const rows = view.memberPanelRows(
		conversation(),
		directory,
		"acct_self",
		chiefLabel,
		"en",
	);
	assert.deepEqual(
		rows.map((row) => [
			row.label,
			row.state,
			row.self,
			row.ownAgent,
			row.action,
		]),
		[
			["Damian Tran", "active", true, false, "leave"],
			["Aida (Damian Tran)", "active", false, true, "withdraw"],
			["Ben Tran", "active", false, false, "remove"],
			["Juno (Ben Tran)", "pending_approval", false, false, null],
		],
	);
	// "Gone Person" (left) is history, not membership.
	assert.ok(!rows.some((row) => row.label === "Gone Person"));
	// An invited PERSON stays "invited": only an agent waits on an owner.
	const invitedPerson = view.memberPanelRows(
		conversation({
			members: [SELF, human("acct_ada", "Ada", "member", "invited")],
		}),
		[],
		"acct_self",
		chiefLabel,
	);
	assert.equal(invitedPerson[1].state, "invited");
});

// ---------------------------------------------------------------- wire

test("leave reaches core's POST .../leave with the owner receipt in the query", () => {
	const request = view.desktopRequestSchema.parse({
		op: "team_bridge.conversations.leave",
		conversation_id: "bcv_qa",
		tenant_id: "tnt_minerva",
		expected_account_id: "acct_self",
	});
	const endpoint = view.desktopEndpoint(request);
	assert.equal(endpoint.method, "POST");
	assert.equal(
		endpoint.path,
		"/v1/desktop/team-bridge/conversations/bcv_qa/leave?tenant_id=tnt_minerva&expected_account_id=acct_self",
	);
	assert.equal(endpoint.body, undefined);
});

test("consent withdraw carries no version and may pin an endpoint", () => {
	const request = view.desktopRequestSchema.parse({
		op: "team_bridge.conversations.consent",
		conversation_id: "bcv_qa",
		account_id: "acct_self",
		tenant_id: "tnt_minerva",
		decision: "withdraw",
		endpoint_id: "bep_aida",
	});
	assert.deepEqual(view.desktopEndpoint(request).body, {
		tenant_id: "tnt_minerva",
		decision: "withdraw",
		endpoint_id: "bep_aida",
	});
	// Core refuses a version on withdraw and requires one on accept/decline.
	assert.equal(
		view.desktopRequestSchema.safeParse({
			op: "team_bridge.conversations.consent",
			conversation_id: "bcv_qa",
			account_id: "acct_self",
			decision: "withdraw",
			consent_version: "1",
		}).success,
		false,
	);
	assert.equal(
		view.desktopRequestSchema.safeParse({
			op: "team_bridge.conversations.consent",
			conversation_id: "bcv_qa",
			account_id: "acct_self",
			decision: "decline",
		}).success,
		false,
	);
	// The existing accept shape is unchanged.
	assert.equal(
		view.desktopRequestSchema.safeParse({
			op: "team_bridge.conversations.consent",
			conversation_id: "bcv_qa",
			account_id: "acct_self",
			decision: "accept",
			consent_version: "1",
		}).success,
		true,
	);
});

// ---------------------------------------------------------------- view

async function mountPanel(t, props = {}) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const calls = [];
	const base = {
		conversation: conversation(),
		people: directory,
		selfAccountId: "acct_self",
		conversationName: "qa-coordination",
		onAddMembers: () => calls.push(["add"]),
		onAction: async (row, action) => calls.push([action, row.key]),
		onClose: () => calls.push(["close"]),
		...props,
	};
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const render = async (overrides = {}) =>
		act(async () =>
			root.render(
				React.createElement(
					QueryClientProvider,
					{ client: queryClient },
					React.createElement(view.TeamBridgeMembersPanel, {
						...base,
						...overrides,
					}),
				),
			),
		);
	await render();
	t.after(async () => {
		await act(async () => root.unmount());
		container.remove();
	});
	return { render, calls, container, body: dom.window.document };
}

const rowNames = (container) =>
	[...container.querySelectorAll("li p")].map((p) => p.textContent);

test("the panel lists People then Agents with their chips", async (t) => {
	const { container } = await mountPanel(t);
	const headings = [...container.querySelectorAll("h3")].map(
		(h) => h.textContent,
	);
	assert.deepEqual(headings, ["People", "Agents"]);
	assert.deepEqual(rowNames(container), [
		"Damian Tran (you) · Owner",
		"Ben Tran",
		"Aida (Damian Tran)",
		"Juno (Ben Tran)",
	]);
	assert.match(container.textContent, /Owner/);
	assert.match(container.textContent, /Pending approval/);
	/* Owner is a role in quiet text after the name (design round 1, D4), not
	   one more status chip beside Invited / Pending approval. */
	const owner = [...container.querySelectorAll("li p span")].find((s) =>
		/Owner/.test(s.textContent),
	);
	assert.ok(owner, "Owner sits inside the name line");
	assert.match(owner.className, /text-ink-dim/);
	// Eight or fewer members: no search box.
	assert.equal(container.querySelector("input"), null);
	// Add members is offered because the page passed it.
	assert.ok(
		[...container.querySelectorAll("button")].some((b) =>
			/Add members/.test(b.textContent),
		),
	);
});

test("live update: a refreshed conversation re-renders the rows in place", async (t) => {
	const { render, container } = await mountPanel(t);
	assert.equal(rowNames(container).length, 4);
	const before = container.querySelector("aside");
	// What a refetch or a member-joined event hands the page: a new object.
	await render({
		conversation: conversation({
			members: [
				...conversation().members.filter((m) => m.account_id !== "acct_ben"),
				human("acct_ada", "Ada Okafor"),
			],
		}),
	});
	assert.equal(container.querySelector("aside"), before, "not remounted");
	assert.deepEqual(rowNames(container), [
		"Damian Tran (you) · Owner",
		"Ada Okafor",
		"Aida (Damian Tran)",
	]);
});

test("search appears past eight members, filters, and says when nothing matches", async (t) => {
	const many = Array.from({ length: 12 }, (_, i) =>
		human(`acct_${i}`, `Person ${String(i).padStart(2, "0")}`),
	);
	const { container } = await mountPanel(t, {
		conversation: conversation({ members: [SELF, ...many] }),
		initialQuery: "person 1",
	});
	assert.ok(container.querySelector("input"));
	assert.deepEqual(rowNames(container), ["Person 10", "Person 11"]);
	const { container: none } = await mountPanel(t, {
		conversation: conversation({ members: [SELF, ...many] }),
		initialQuery: "zzz",
	});
	assert.equal(rowNames(none).length, 0);
	assert.match(none.textContent, /No current members match your search\./);
});

test("remove asks first, naming the member and the conversation", async (t) => {
	const { calls, container, body } = await mountPanel(t);
	const remove = container.querySelector(
		'button[aria-label="Remove Ben Tran from conversation"]',
	);
	assert.ok(remove, "owner sees remove on Ben");
	assert.equal(
		container.querySelector(
			'button[aria-label="Remove Juno (Ben Tran) from conversation"]',
		),
		null,
		"no control on someone else's agent",
	);
	await act(async () => remove.click());
	const dialog = body.querySelector('[role="dialog"]');
	assert.match(dialog.textContent, /Remove Ben Tran from qa-coordination\?/);
	const confirm = [...dialog.querySelectorAll("button")].find(
		(b) => b.textContent === "Remove",
	);
	await act(async () => confirm.click());
	assert.deepEqual(calls.at(-1), ["remove", "human:acct_ben"]);
});

test("removing an invited person says the invitation is withdrawn", async (t) => {
	const { container, body } = await mountPanel(t, {
		conversation: conversation({
			members: [
				...conversation().members,
				human("acct_ivy", "Ivy Invited", "member", "invited"),
			],
		}),
	});
	const dialogBody = async (label) => {
		await act(async () =>
			container.querySelector(`button[aria-label="${label}"]`).click(),
		);
		const text = body.querySelector('[role="dialog"] p').textContent;
		const cancel = [...body.querySelectorAll('[role="dialog"] button')].find(
			(b) => b.textContent === "Cancel",
		);
		await act(async () => cancel.click());
		return text;
	};
	assert.equal(
		await dialogBody("Remove Ivy Invited from conversation"),
		"Their invitation will be withdrawn. You can invite them again later.",
	);
	assert.equal(
		await dialogBody("Remove Ben Tran from conversation"),
		"They’ll stop getting this conversation’s messages. You can invite them again later.",
	);
});

test("ur: the built-in channel name is isolated LTR inside the RTL note", async (t) => {
	view.setLocale("ur");
	t.after(() => view.setLocale("en"));
	const { container } = await mountPanel(t, {
		conversation: conversation({
			kind: "channel",
			builtin: "general",
			name: "general",
		}),
		onAddMembers: undefined,
	});
	const note = [...container.querySelectorAll("aside p")].find((p) =>
		p.textContent.includes("general"),
	);
	assert.ok(note, "the #general note renders");
	// FSI ... PDI around the whole name, so `#` cannot resolve to the RTL run.
	assert.ok(
		note.textContent.includes("\u2066#general\u2069"),
		JSON.stringify(note.textContent),
	);
});

test("after Cancel, one Escape closes the panel (no tooltip in the way)", async (t) => {
	const { calls, container, body } = await mountPanel(t);
	const action = container.querySelector(
		'button[aria-label="Remove Ben Tran from conversation"]',
	);
	// A real click focuses the button; jsdom's `click()` does not.
	await act(async () => {
		action.focus();
		action.click();
	});
	const cancel = [...body.querySelectorAll('[role="dialog"] button')].find(
		(b) => b.textContent === "Cancel",
	);
	await act(async () => cancel.click());
	/* Where focus lands in a real browser (QA round 1 row 18). jsdom's dialog
	   teardown leaves it on BODY, so it is placed here, after that teardown. */
	await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
	await act(async () => action.focus());
	assert.ok(
		body.querySelector('[role="tooltip"]') === null,
		"returned focus does not open the label",
	);
	await act(async () => {
		action.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	assert.deepEqual(calls.at(-1), ["close"]);
});

test("a refused action is stated inline and the panel stays open", async (t) => {
	const { container, body } = await mountPanel(t, {
		onAction: async () => {
			throw new Error("refused");
		},
	});
	await act(async () =>
		container
			.querySelector('button[aria-label="Leave this conversation"]')
			.click(),
	);
	const leave = [...body.querySelectorAll('[role="dialog"] button')].find(
		(b) => b.textContent === "Leave",
	);
	await act(async () => leave.click());
	assert.match(
		container.querySelector('[role="alert"]').textContent,
		/The member change was not saved/,
	);
	assert.ok(container.querySelector("aside"));
});

test("#general: no controls, one quiet explanation, no Add members", async (t) => {
	const { container } = await mountPanel(t, {
		conversation: conversation({
			kind: "channel",
			builtin: "general",
			name: "general",
		}),
		onAddMembers: undefined,
	});
	assert.equal(container.querySelectorAll("li button").length, 0);
	assert.match(
		container.textContent,
		/Everyone in the organization is a member of #general\. Mute it instead of leaving\./,
	);
	assert.ok(
		![...container.querySelectorAll("button")].some((b) =>
			/Add members/.test(b.textContent),
		),
	);
});

// ---------------------------------------------------------------- page

async function mountPage(t, overrides = {}) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const base = {
		conversations: [conversation()],
		target: { type: "conversation", id: conversation().id },
		messages: [],
		onTarget: () => {},
		onNewChannel: () => {},
		onScopeChange: () => {},
		people: directory,
		peopleState: "ready",
		selfAccountId: "acct_self",
		organizations: [
			{ tenantId: "tnt_minerva", name: "Minerva", role: "owner", unread: 0 },
		],
	};
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const render = async (next = {}) =>
		act(async () =>
			root.render(
				React.createElement(
					QueryClientProvider,
					{ client: queryClient },
					React.createElement(view.TeamBridgePageView, {
						...base,
						...overrides,
						...next,
					}),
				),
			),
		);
	await render();
	t.after(async () => {
		await act(async () => root.unmount());
		container.remove();
	});
	return { render, container, body: dom.window.document };
}

test("the header count is a button that opens the panel; Escape returns focus to it", async (t) => {
	// No invitations, so the single-line count (the two-line one is below).
	const settled = conversation({
		members: conversation().members.filter((m) => m.state !== "invited"),
	});
	const { container, body } = await mountPage(t, {
		conversations: [settled],
	});
	const count = container.querySelector('button[aria-label="View 3 members"]');
	assert.ok(count, "count is a named button");
	assert.equal(count.textContent, "3 members");
	assert.equal(container.querySelector('aside[aria-label="Members"]'), null);
	await act(async () => {
		count.focus();
		count.click();
	});
	const panel = container.querySelector('aside[aria-label="Members"]');
	assert.ok(panel, "panel opened");
	assert.equal(count.getAttribute("aria-expanded"), "true");
	assert.equal(body.activeElement?.getAttribute("aria-label"), "Close members");
	await act(async () => {
		body.activeElement.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	assert.equal(container.querySelector('aside[aria-label="Members"]'), null);
	assert.equal(body.activeElement, count, "focus back on the count");
});

test("invitations: the count names both numbers", async (t) => {
	const { container } = await mountPage(t);
	// conversation() carries one invited agent (Juno), so the two-line variant.
	const count = container.querySelector('button[aria-label^="View "]');
	assert.ok(count);
	assert.equal(
		count.getAttribute("aria-label"),
		"View 3 active members, 1 invited",
	);
});

test("leaving through the page moves the selection off the room", async (t) => {
	const targets = [];
	const general = conversation({
		id: "bcv_general",
		kind: "channel",
		builtin: "general",
		name: "general",
	});
	const { container, body } = await mountPage(t, {
		conversations: [conversation(), general],
		onTarget: (next) => targets.push(next),
		onMemberSelfAction: async (_c, action) => {
			assert.equal(action, "leave");
		},
		initialMembersPanelOpen: true,
	});
	await act(async () =>
		container
			.querySelector('button[aria-label="Leave this conversation"]')
			.click(),
	);
	const leave = [...body.querySelectorAll('[role="dialog"] button')].find(
		(b) => b.textContent === "Leave",
	);
	await act(async () => leave.click());
	assert.ok(
		targets.some((next) => next && next.id === "bcv_general"),
		JSON.stringify(targets),
	);
});

test("withdraw through the page hands the row's endpoint to the callback", async (t) => {
	const calls = [];
	const { container, body } = await mountPage(t, {
		onMemberSelfAction: async (_c, action, endpoint) => {
			calls.push([action, endpoint]);
		},
		initialMembersPanelOpen: true,
	});
	await act(async () =>
		container
			.querySelector(
				'button[aria-label="Remove Aida (Damian Tran) from conversation"]',
			)
			.click(),
	);
	const remove = [...body.querySelectorAll('[role="dialog"] button')].find(
		(b) => b.textContent === "Remove",
	);
	await act(async () => remove.click());
	assert.deepEqual(calls, [["withdraw", "bep_aida"]]);
});

test("a new selection closes the panel and leaves focus where the reader put it", async (t) => {
	const other = conversation({ id: "bcv_other", name: "other-room" });
	const { container, body, render } = await mountPage(t, {
		conversations: [conversation(), other],
	});
	const count = () => container.querySelector('button[aria-label^="View "]');
	await act(async () => {
		count().focus();
		count().click();
	});
	assert.ok(container.querySelector('aside[aria-label="Members"]'));
	assert.equal(body.activeElement?.getAttribute("aria-label"), "Close members");
	// The reader moves to another rail row: that control holds focus.
	const elsewhere = body.createElement("button");
	body.body.append(elsewhere);
	t.after(() => elsewhere.remove());
	elsewhere.focus();
	await render({ target: { type: "conversation", id: "bcv_other" } });
	/* Booleans, not nodes: a failing `assert.equal` on a jsdom element inspects
	   the whole document and exhausts the heap before it can report. */
	assert.ok(
		container.querySelector('aside[aria-label="Members"]') === null,
		"the panel does not follow the reader into another room",
	);
	assert.ok(body.activeElement === elsewhere, "focus was not pulled");
	assert.equal(count().getAttribute("aria-expanded"), "false");
	// A refetch of the same room (a new object, same id) keeps an open panel.
	await act(async () => count().click());
	await render({
		conversations: [conversation(), { ...other }],
		target: { type: "conversation", id: "bcv_other" },
	});
	assert.ok(container.querySelector('aside[aria-label="Members"]'));
});
