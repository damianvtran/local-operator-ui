import assert from "node:assert/strict";
import { readFileSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * INVITING PEOPLE AND THEIR AGENTS INTO A CONVERSATION.
 *
 * The operator's complaint was that there was no intuitive way to add a human or
 * an agent to a group or channel. The server routes already existed; what was
 * missing was one discoverable control, a picker that shows peers who exist but
 * are NOT reachable (with the reason), multi-select with a single confirm, and an
 * invite that fails IN PLACE instead of hanging.
 *
 * THREE LAYERS, each asserting what only it can prove:
 *
 *  - MODEL (`team-bridge-members-model.ts`): which candidates are offered, which
 *    are disabled and why, and which authority the add/remove routes require.
 *    Pure functions, asserted by name.
 *  - VIEW (`team-bridge-add-members.tsx`): the picker's own markup — People and
 *    Agents as separate groups, a non-enabled peer shown disabled with its
 *    reason, an existing member non-addable, the empty directory.
 *  - INTERACTION: the same shipped component mounted in jsdom, driven the way a
 *    person drives it — tick several rows, press confirm, read what the caller
 *    was handed. This is the only layer that can prove "invite several in one
 *    action", and that a failed write leaves the dialog usable rather than stuck.
 *
 * WHY jsdom RATHER THAN `renderToStaticMarkup`: the picker is a Radix `Dialog`,
 * whose content is a portal, and a server render drops portals. The house
 * pattern for interactive surfaces (`agent-messages-dialog.test.mjs`) mounts the
 * real component into jsdom instead; this file follows it, with the same caveat
 * — jsdom has NO layout, so nothing here claims a rendered size or a pixel.
 *
 * NOT RE-PROVED HERE: the desktop wire shape for `team_bridge.conversations.
 * members.add` is pinned by `desktop-contract.test.mjs` (route body is the member
 * array, tenant_id a query parameter), so this file asserts the UI hands the
 * caller every selected member and stops at that boundary.
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
			export { TeamBridgeAddMembersView } from "./src/renderer/src/features/team-bridge/team-bridge-add-members";
			export { TeamBridgePageView } from "./src/renderer/src/features/team-bridge/team-bridge-page";
			export { canInviteMembers, canRemoveMembers, currentMembers, memberCandidates } from "./src/renderer/src/features/team-bridge/team-bridge-members-model";
		`,
		resolveDir: ROOT,
		sourcefile: "team-bridge-members.mjs",
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
	`./_team-bridge-members-${process.pid}.mjs`,
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

/** The English copy these assertions read; the catalogue owns the strings. */
const COPY = {
	people: "People",
	agents: "Agents and chiefs of staff",
	bridgeOff: "Team Bridge is not enabled for this person",
	alreadyMember: "Already active or invited",
	agentNotPermitted: "This conversation does not allow agents",
	emptyDirectory: "Nobody in this organization can be invited.",
	mutationError: "The member change was not saved. Try again.",
	confirmInvitations: /Send invitations/,
	confirmSome: (n) => new RegExp(`Send ${n} invitation`),
};

const conversation = (overrides = {}) => ({
	id: "bcv_article_search",
	tenant_id: "tnt_minerva",
	kind: "group",
	name: "article-search-reindex",
	visibility: "private",
	agent_capable: true,
	status: "open",
	created_by: "acct_self",
	last_message_at: "2026-10-28T12:00:00.000Z",
	latest_seq: 12,
	members: [
		{
			account_id: "acct_self",
			kind: "human",
			display_label: "Damian Tran",
			role: "owner",
			state: "active",
		},
		{
			account_id: "acct_ben",
			kind: "human",
			display_label: "Ben Tran",
			role: "member",
			state: "active",
		},
		{
			// An agent participant is keyed by its OWNER's account: the hub's
			// member key is (account, endpoint), so this row and Ben's directory
			// agent are the same seat.
			account_id: "acct_ben",
			kind: "agent",
			display_label: "Juno",
			role: "member",
			state: "invited",
			joined_seq: 0,
		},
	],
	last_read_seq: 12,
	unread_count: 0,
	muted: false,
	can_administer: true,
	...overrides,
});

/** `bridge_state: "none"` is a person the directory lists but nobody can reach. */
const directory = [
	{
		account_id: "acct_self",
		display_label: "Damian Tran",
		role: "owner",
		bridge_enabled: true,
		bridge_state: "active",
		agent: {
			endpoint_id: "bep_aida",
			name: "Aida",
			state: "active",
		},
	},
	{
		account_id: "acct_ben",
		display_label: "Ben Tran",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active",
		agent: {
			endpoint_id: "bep_juno",
			name: "Juno",
			state: "active",
		},
	},
	{
		account_id: "acct_ada",
		display_label: "Ada Okafor",
		role: "member",
		bridge_enabled: false,
		bridge_state: "none",
	},
	{
		account_id: "acct_sherman",
		display_label: "Sherman Lee",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active",
		agent: {
			endpoint_id: "bep_orion",
			name: "Orion",
			state: "active",
		},
	},
];

const chiefLabel = (agent, person) => `${agent} (${person})`;

// ---------------------------------------------------------------- model

test("the invite route's prerequisites mirror the hub's own rule", () => {
	const active = conversation();
	assert.equal(view.canInviteMembers(active, "acct_self"), true);
	assert.equal(
		view.canInviteMembers(active, "acct_ben"),
		true,
		"any active human member may invite, not only the owner",
	);
	assert.equal(
		view.canInviteMembers(
			conversation({ kind: "dm", name: null }),
			"acct_self",
		),
		false,
		"a DM has no member administration",
	);
	assert.equal(
		view.canInviteMembers(conversation({ builtin: true }), "acct_self"),
		false,
		"a built-in channel is the hub's, not the caller's",
	);
	assert.equal(
		view.canInviteMembers(conversation({ status: "archived" }), "acct_self"),
		false,
		"an archived conversation takes no new members",
	);
	assert.equal(
		view.canInviteMembers(active, "acct_stranger"),
		false,
		"an unresolved or non-member account fails closed",
	);
});

test("remove is the owner's route and never an agent's", () => {
	assert.equal(view.canRemoveMembers(conversation(), "acct_self"), true);
	assert.equal(
		view.canRemoveMembers(conversation(), "acct_ben"),
		false,
		"a plain member may invite but not remove",
	);
	const rows = view.currentMembers(
		conversation(),
		directory,
		"acct_self",
		chiefLabel,
		true,
	);
	assert.deepEqual(
		rows.map((row) => [row.member.account_id, row.member.kind, row.removable]),
		[
			["acct_self", "human", false],
			["acct_ben", "human", true],
			["acct_ben", "agent", false],
		],
		"the owner's own row and every agent row carry no remove control",
	);
});

test("the roster keeps unreachable peers, disabled, instead of hiding them", () => {
	const candidates = view.memberCandidates(
		conversation(),
		directory,
		"acct_self",
		chiefLabel,
	);
	const byKey = new Map(
		candidates.map((candidate) => [
			`${candidate.recipient.kind}:${candidate.recipient.accountId}`,
			candidate,
		]),
	);
	assert.equal(
		byKey.get("human:acct_ada")?.disabledReason,
		"bridge_unavailable",
		"a peer whose bridge is off is SHOWN with its reason, not dropped",
	);
	assert.equal(
		byKey.get("human:acct_ben")?.disabledReason,
		"already_member",
		"an active member cannot be invited twice",
	);
	assert.equal(
		byKey.get("agent:acct_ben")?.disabledReason,
		"already_member",
		"an INVITED agent is already in the room",
	);
	assert.equal(
		byKey.get("human:acct_sherman")?.disabledReason,
		null,
		"a reachable peer is addable",
	);
	assert.equal(
		byKey.get("agent:acct_sherman")?.recipient.label,
		"Orion (Sherman Lee)",
		"an agent row carries its owner in the label",
	);
	assert.equal(
		byKey.get("agent:acct_self")?.disabledReason,
		null,
		"the reader's own chief of staff is offerable: a group is not a DM",
	);
});

test("a departed or declined person can be invited again", () => {
	const candidates = view.memberCandidates(
		conversation({
			members: [
				{
					account_id: "acct_self",
					kind: "human",
					display_label: "Damian Tran",
					role: "owner",
					state: "active",
				},
				{
					account_id: "acct_ada",
					kind: "human",
					display_label: "Ada Okafor",
					role: "member",
					state: "removed",
				},
			],
		}),
		[{ ...directory[2], bridge_enabled: true, bridge_state: "active" }],
		"acct_self",
		chiefLabel,
	);
	const ada = candidates.find((row) => row.recipient.accountId === "acct_ada");
	assert.equal(ada?.disabledReason, null);
});

test("a conversation that refuses agents says so on every agent row", () => {
	const candidates = view.memberCandidates(
		conversation({
			agent_capable: false,
			members: [
				{
					account_id: "acct_self",
					kind: "human",
					display_label: "Damian Tran",
					role: "owner",
					state: "active",
				},
			],
		}),
		directory,
		"acct_self",
		chiefLabel,
	);
	const agents = candidates.filter((row) => row.recipient.kind === "agent");
	assert.ok(agents.length > 0, "the agents are still listed");
	for (const row of agents) {
		assert.equal(row.disabledReason, "agent_not_permitted");
	}
});

test("the current-members list holds members, not history", () => {
	const rows = view.currentMembers(
		conversation({
			members: [
				{
					account_id: "acct_self",
					kind: "human",
					display_label: "Damian Tran",
					role: "owner",
					state: "active",
				},
				{
					account_id: "acct_gone",
					kind: "human",
					display_label: "Gone Person",
					role: "member",
					state: "left",
				},
				{
					account_id: "acct_declined",
					kind: "human",
					display_label: "Declined Person",
					role: "member",
					state: "removed",
				},
			],
		}),
		[],
		"acct_self",
		chiefLabel,
		false,
	);
	assert.deepEqual(
		rows.map((row) => row.member.account_id),
		["acct_self"],
		"a person who left or declined is not listed as a member of the room",
	);
});

// ------------------------------------------------------------ view helpers

const mounted = [];
after(async () => {
	for (const unmount of mounted) await unmount();
});

/**
 * Mount the picker into jsdom and hand back the document plus the recorded write.
 *
 * `render` re-renders with overrides, which is how the error and pending states
 * are entered: they are props, so the caller drives them exactly as the page does.
 */
async function mount(t, props = {}) {
	const writes = [];
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const base = {
		open: true,
		conversation: conversation(),
		people: directory,
		selfAccountId: "acct_self",
		peopleState: "ready",
		canInvite: true,
		canRemove: true,
		onClose: () => {},
		onAdd: (members) => writes.push(members),
		onRemove: () => {},
		...props,
	};
	const render = async (overrides = {}) =>
		act(async () =>
			root.render(
				React.createElement(view.TeamBridgeAddMembersView, {
					...base,
					...overrides,
				}),
			),
		);
	await render();
	const unmount = async () => {
		await act(async () => root.unmount());
		container.remove();
	};
	mounted.push(unmount);
	t.after(unmount);
	return { render, writes, document: dom.window.document };
}

/*
 * A row is a `fieldset > div`; its title is the first `span > span` in the
 * text column and its control is the house `Checkbox` (a React button with
 * role="checkbox"), not a raw input. Selecting by structure keeps these
 * helpers honest about the markup that actually ships.
 */
const rows = (body) => [...body.querySelectorAll("fieldset > div")];
const rowTitle = (row) => row.querySelector("span > span")?.textContent;
const rowFor = (body, name) => rows(body).find((row) => rowTitle(row) === name);
const checkboxIn = (row) => row.querySelector('[role="checkbox"]');
const buttonNamed = (body, pattern) =>
	[...body.querySelectorAll("button")].find((button) =>
		pattern.test(button.textContent ?? ""),
	);

// ---------------------------------------------------------------- view

test("the picker lists People and Agents as separate groups", async (t) => {
	const { document: body } = await mount(t);
	const headings = [...body.querySelectorAll("p")].filter((node) =>
		[COPY.people, COPY.agents].includes(node.textContent.trim()),
	);
	assert.deepEqual(
		headings.map((node) => node.textContent.trim()),
		[COPY.people, COPY.agents],
		"the two headings are present, people first",
	);
	const peopleSection = headings[0].parentElement;
	const agentSection = headings[1].parentElement;
	assert.ok(
		peopleSection.textContent.includes("Sherman Lee"),
		"a person sits under People",
	);
	assert.ok(
		!peopleSection.textContent.includes("Orion (Sherman Lee)"),
		"an agent does NOT sit under People",
	);
	assert.ok(
		agentSection.textContent.includes("Orion (Sherman Lee)"),
		"the same person's agent sits under Agents",
	);
	assert.ok(
		agentSection.textContent.includes("Aida (Damian Tran)"),
		"the reader's own chief of staff is offered",
	);
});

test("a peer whose bridge is off renders disabled with the reason", async (t) => {
	const { document: body } = await mount(t);
	const row = rowFor(body, "Ada Okafor");
	assert.ok(row, "the unreachable peer is visible, not hidden");
	assert.equal(checkboxIn(row).disabled, true);
	assert.ok(
		row.textContent.includes(COPY.bridgeOff),
		`the row states why (${COPY.bridgeOff})`,
	);
});

test("an existing member is shown as such and cannot be re-added", async (t) => {
	const { document: body } = await mount(t);
	const row = rowFor(body, "Ben Tran");
	assert.equal(checkboxIn(row).disabled, true);
	assert.ok(row.textContent.includes(COPY.alreadyMember));
	const agentRow = rowFor(body, "Juno (Ben Tran)");
	assert.equal(checkboxIn(agentRow).disabled, true);
	assert.ok(
		agentRow.textContent.includes(COPY.alreadyMember),
		"an invited agent is in the room already, so it says so rather than re-offering",
	);
});

test("an empty directory states that, rather than an empty list", async (t) => {
	const { document: body } = await mount(t, { people: [] });
	assert.ok(
		body.body.textContent.includes(COPY.emptyDirectory),
		"no people and no agents is its own message",
	);
});

test("a load failure offers a retry that names the organization", async (t) => {
	const retries = [];
	const { document: body } = await mount(t, {
		peopleState: "error",
		onRetryMembers: (tenantId) => {
			retries.push(tenantId);
		},
	});
	const retry = [...body.querySelectorAll("button")].find(
		(button) => button.textContent.trim() === "Try again",
	);
	assert.ok(retry, "the failure is recoverable from the dialog");
	await act(async () => retry.click());
	// The merged view mounts one directory read per organization, so a retry that
	// named no tenant could only re-run whichever read happened to be handy - the
	// bug review round 1 found, where the button did nothing at all.
	assert.deepEqual(
		retries,
		["tnt_minerva"],
		"the retry addresses the conversation's own organization",
	);
});

// --------------------------------------------------------- interaction

test("inviting several people and agents is one action", async (t) => {
	const { document: body, writes } = await mount(t);
	await act(async () => checkboxIn(rowFor(body, "Sherman Lee")).click());
	await act(async () => checkboxIn(rowFor(body, "Aida (Damian Tran)")).click());
	const confirm = buttonNamed(body, COPY.confirmSome(2));
	assert.ok(confirm, "the confirm button counts what will be sent");
	assert.equal(confirm.disabled, false);
	await act(async () => confirm.click());
	assert.equal(writes.length, 1, "one confirm sends one request");
	assert.deepEqual(
		writes[0]
			.map((member) => [member.kind, member.account_id])
			.sort(([kindA], [kindB]) => kindA.localeCompare(kindB)),
		[
			["agent", "acct_self"],
			["human", "acct_sherman"],
		],
		"every selected person AND agent rides the same call",
	);
	const agentWrite = writes[0].find((member) => member.kind === "agent");
	assert.equal(
		agentWrite.endpoint_id,
		"bep_aida",
		"an agent rides the request with the endpoint the hub addresses",
	);
});

test("opening the picker puts the keyboard in the filter, not on a remove", async (t) => {
	const { document: body } = await mount(t);
	// Radix focuses the dialog's first focusable node. Before this rule that was
	// the first row's remove control, so Enter on a freshly opened dialog would
	// have removed a member instead of narrowing the list.
	const focused = body.activeElement;
	assert.equal(focused?.getAttribute("type"), "text");
	assert.equal(
		focused?.getAttribute("aria-label"),
		"Search people and agents",
		"the filter owns the first focus",
	);
});

test("nothing selected sends nothing", async (t) => {
	const { document: body, writes } = await mount(t);
	const confirm = buttonNamed(body, COPY.confirmInvitations);
	assert.ok(confirm);
	assert.equal(confirm.disabled, true);
	await act(async () => confirm.click());
	assert.equal(writes.length, 0);
});

test("a failed invitation says why in place and leaves the dialog usable", async (t) => {
	const { document: body, render, writes } = await mount(t);
	await act(async () => checkboxIn(rowFor(body, "Sherman Lee")).click());

	// The page sets this flag from the rejected mutation, which is exactly the
	// state the operator met before: a write that failed with nothing said.
	await render({ mutationError: true });
	assert.ok(
		body.body.textContent.includes(COPY.mutationError),
		"the failure is stated in the dialog",
	);
	assert.equal(
		body.querySelector('[role="alert"]')?.textContent,
		COPY.mutationError,
		"and announced to assistive technology",
	);
	const confirm = buttonNamed(body, COPY.confirmSome(1));
	assert.equal(
		confirm.disabled,
		false,
		"the selection survived, so the retry is one press away",
	);

	// A second attempt: the caller clears the flag, and the dialog is NOT stuck —
	// the same rows are still interactive and the retry reaches the caller.
	await render({ mutationError: false });
	assert.equal(body.body.textContent.includes(COPY.mutationError), false);
	assert.equal(
		checkboxIn(rowFor(body, "Orion (Sherman Lee)")).disabled,
		false,
		"another row can still be ticked after a failure",
	);
	await act(async () =>
		checkboxIn(rowFor(body, "Orion (Sherman Lee)")).click(),
	);
	await act(async () => buttonNamed(body, COPY.confirmSome(2)).click());
	assert.equal(writes.length, 1, "the retry reaches the caller");
	assert.deepEqual(
		writes[0].map((member) => member.account_id).sort(),
		["acct_sherman", "acct_sherman"],
		"the person and their agent, both from the retry",
	);
});

/**
 * THE PAGE OWNS THE `.catch`, so only a mount of the PAGE can prove the failure
 * is stated. The picker's error prop is a rendering fact; this case drives the
 * rejected write through `TeamBridgePageView`, the same component the app mounts,
 * so deleting the page's catch turns this red rather than leaving the suite green.
 */
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
		// The page names a conversation's organization; one row is the minimum
		// the merged-scope label logic reads.
		organizations: [
			{ tenantId: "tnt_minerva", name: "Minerva", role: "owner", unread: 0 },
		],
	};
	// The page reads through react-query; a provider is part of mounting it. The
	// client's reads have no desktop transport here, so they settle as errors -
	// which is exactly the state this test needs the FAILED WRITE to outrank.
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
	return { render, document: dom.window.document };
}

test("an invitation the hub refuses is stated by the page, in place", async (t) => {
	let attempts = 0;
	const { document: body } = await mountPage(t, {
		onAddMembers: async () => {
			attempts += 1;
			throw new Error("hub refused");
		},
	});
	// The header control is labelled, not an icon-only glyph (design review D2).
	const opener = buttonNamed(body, ADD_MEMBERS_BUTTON);
	assert.ok(opener, "the header control is the one entry point");
	await act(async () => opener.click());
	await act(async () => checkboxIn(rowFor(body, "Sherman Lee")).click());
	const confirm = buttonNamed(body, COPY.confirmSome(1));
	await act(async () => confirm.click());
	// The rejection lands after the click resolves; let the queue drain.
	await act(async () => {
		await Promise.resolve();
	});
	assert.equal(
		attempts,
		1,
		"the write was attempted once, not retried behind the reader",
	);
	assert.equal(
		body.querySelector('[role="alert"]')?.textContent,
		COPY.mutationError,
		"the page states the failure in the dialog",
	);
	assert.ok(
		body.body.textContent.includes("Conversation members"),
		"and the dialog is still there to retry from",
	);
	const retry = buttonNamed(body, COPY.confirmSome(1));
	assert.equal(retry.disabled, false, "the selection survived the refusal");
});

test("a write in flight closes no door and takes no second press", async (t) => {
	const onClose = [];
	const { document: body } = await mount(t, {
		pendingKey: "add",
		onClose: () => onClose.push(true),
	});
	await act(async () => checkboxIn(rowFor(body, "Sherman Lee")).click());
	const confirm = buttonNamed(body, COPY.confirmInvitations);
	assert.equal(confirm.disabled, true, "a second press cannot double-invite");
	const cancel = [...body.querySelectorAll("button")].find(
		(button) => button.textContent.trim() === "Cancel",
	);
	assert.equal(
		cancel.disabled,
		true,
		"the dialog cannot be dismissed out from under a write",
	);
	// Disabling the button is only half the rule: the picker's own close path
	// refuses while a write is in flight, and the page decides whether it may.
	await act(async () => cancel.click());
	assert.deepEqual(
		onClose,
		[],
		"and pressing it reaches no close handler while the write is pending",
	);
});

test("a read-only caller sees the roster but no way to add", async (t) => {
	const { document: body } = await mount(t, {
		canInvite: false,
		canRemove: false,
	});
	assert.equal(
		checkboxIn(rowFor(body, "Sherman Lee")).disabled,
		true,
		"no candidate is addable",
	);
	assert.equal(
		buttonNamed(body, COPY.confirmInvitations).disabled,
		true,
		"and the confirm is not a live action",
	);
});
