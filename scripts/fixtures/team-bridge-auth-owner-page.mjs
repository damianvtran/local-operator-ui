import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { relative } from "node:path";
import { after } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/* Reuses reviewer e5's exact corrected rollback witness (retained entry
 * 4db25e80537b4f6b8bf1652667d2c7a5), based on the 7cf4626d51 fixture.
 * Page, auth/user query, membership, commissionAccountRead, API parsers and
 * shipped singleton QueryClient are REAL. Only preload transport and unrelated
 * sidebar decoration are fixtures. No optimistic-send implementation is added.
 * Controlled transport proves app-code isolation, not native/JWT atomic reads. */
const dom = new JSDOM("<!doctype html><body></body>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;

/*
 * THE DESKTOP BRIDGE, INERT. The page mounts the shared composer, whose mount
 * registers the global dictation chord (`use-speech-to-text-manager.ts` reads
 * `window.electron.ipcRenderer`), so a DOM probe needs the preload surface to
 * exist. A call that answers nothing is the honest stand-in for a bridge this rig
 * does not have - `agents-composer-mount.test.mjs` states the same stub.
 */
dom.window.electron = {
	ipcRenderer: {
		on: () => () => {},
		removeListener: () => {},
		send: () => {},
		invoke: async () => ({}),
	},
};
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
for (const name of [
	"HTMLElement",
	"Element",
	"Node",
	"NodeFilter",
	"MutationObserver",
	"DocumentFragment",
	"CustomEvent",
	"HTMLInputElement",
	"HTMLTextAreaElement",
	"HTMLButtonElement",
	/* Radix menus read these globals while opening and positioning. */
	"MouseEvent",
	"KeyboardEvent",
	"FocusEvent",
])
	globalThis[name] = dom.window[name];
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.DOMRect ??= dom.window.DOMRect;
dom.window.Element.prototype.hasPointerCapture ??= () => false;
dom.window.Element.prototype.setPointerCapture ??= () => {};
dom.window.Element.prototype.releasePointerCapture ??= () => {};
globalThis.getComputedStyle = dom.window.getComputedStyle;
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const SIDEBAR = /chat\/components\/chat-sidebar$/;
const ANY = /.*/;
const SOURCE = /\/src\/.*\.(?:tsx?|json)$/;
const role = readFileSync(
	"src/renderer/src/features/chat/components/chat-sidebar.tsx",
	"utf8",
).match(/export const rowCurrent =\s*("[^"]+")/)?.[1];
assert.ok(role);
const bundle = await build({
	stdin: {
		contents: `import React from 'react';
 import {useRadientUserQuery} from './src/renderer/src/shared/hooks/use-radient-user-query';
 import {useTeamBridgeNavItem} from './src/renderer/src/features/team-bridge/team-bridge-nav';
 export {commissionAccountRead,radientUserKeys} from './src/renderer/src/shared/hooks/use-radient-user-query';
 export {queryClient} from './src/renderer/src/shared/api/query-client';
 export {TeamBridgeApi} from './src/renderer/src/shared/api/local-operator/team-bridge-api';
 export {desktopRequestSchema, desktopEndpoint} from './src/shared/desktop-contract';
 export function AuthPrincipal(){const auth=useRadientUserQuery();const nav=useTeamBridgeNavItem(true);return React.createElement(React.Fragment,null,React.createElement('output',{'data-auth-principal':auth.user?.account?.id??'unresolved'},auth.user?.account?.id??'unresolved'),React.createElement('output',{'data-nav-attention':true},String(nav?.attention??0)));}
 export {recorded as toasts} from 'sonner';
 export {TeamBridgePage} from './src/renderer/src/features/team-bridge/team-bridge-page';
 export {teamBridgeKeys} from './src/renderer/src/features/team-bridge/use-team-bridge';
 export {teamBridgeViewingConversation} from './src/renderer/src/features/team-bridge/team-bridge-viewing';
 export {QueryClient,QueryClientProvider} from '@tanstack/react-query';
 export {MemoryRouter} from 'react-router-dom';`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	external: ["@tanstack/react-query", "react", "react-dom"],
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
	// Bundling it keeps this container probe on the real component tree; a `dataurl`
	// rather than a file keeps the fixture asset-free.
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
	tsconfig: "tsconfig.app.json",
	write: false,
	plugins: [
		{
			name: "unrelated-boundaries",
			setup(b) {
				// Exact, isolated RED control: compile only changed source files from the
				// original release ref; never replace files in this or another worktree.
				const baselineRef = process.env.TEAM_BRIDGE_AUTH_BASELINE;
				if (baselineRef) {
					assert.equal(baselineRef, "39164868fc15bd7971a1df625ef99e53c209e08f");
					const git = (...args) =>
						execFileSync("git", args, { encoding: "utf8" });
					const paths = git("diff", "--name-only", baselineRef, "--", "src")
						.trim()
						.split("\n")
						.filter(Boolean);
					const baseFiles = new Set(
						git("ls-tree", "-r", "--name-only", baselineRef, "--", "src")
							.trim()
							.split("\n"),
					);
					const baseline = new Map(
						paths
							.filter((path) => baseFiles.has(path))
							.map((path) => [path, git("show", `${baselineRef}:${path}`)]),
					);
					b.onLoad({ filter: SOURCE }, ({ path }) => {
						const contents = baseline.get(relative(process.cwd(), path));
						if (contents === undefined) return;
						return {
							contents,
							loader: path.endsWith(".tsx")
								? "tsx"
								: path.endsWith(".json")
									? "json"
									: "ts",
						};
					});
				}
				// sonner is the toast manager's one edge. The shipped manager (dedupe,
				// transport-text rewrite) runs for real and lands here, so a test can read
				// exactly what a person would be shown.
				b.onResolve({ filter: /^sonner$/ }, () => ({
					path: "sonner-recorder",
					namespace: "fixture",
				}));
				// OPT-IN (TEAM_BRIDGE_PLAIN_MENUS=1): Radix's dropdown costs ~330 s to OPEN
				// under jsdom (floating-ui + aria-hidden walks over the whole page), so a
				// suite that must click through a menu swaps in a plain-DOM one with the same
				// parts. It is an edge like the transport: the page, its handlers and the
				// dialogs they open are the shipped ones; only the popup's positioning is
				// replaced. The real menu is exercised in a browser (Storybook captures).
				if (process.env.TEAM_BRIDGE_PLAIN_MENUS === "1")
					b.onResolve({ filter: /components\/ui\/dropdown-menu$/ }, () => ({
						path: "plain-dropdown-menu",
						namespace: "fixture",
					}));
				b.onResolve({ filter: SIDEBAR }, () => ({
					path: "sidebar",
					namespace: "fixture",
				}));
				b.onLoad({ filter: ANY, namespace: "fixture" }, ({ path }) => ({
					loader: "js",
					contents:
						path === "sonner-recorder"
							? `export const recorded=[];
const push=(m)=>{recorded.push(String(m));return recorded.length;};
export const toast=Object.assign((m)=>push(m),{error:push,success:push,info:push,warning:push,loading:push,dismiss:()=>{},message:push});
export const Toaster=()=>null;`
							: path === "plain-dropdown-menu"
								? `import React from "react";
const Ctx=React.createContext(null);
export const DropdownMenu=({children})=>{const [open,setOpen]=React.useState(false);return React.createElement(Ctx.Provider,{value:{open,setOpen}},children);};
export const DropdownMenuTrigger=({children,asChild})=>{const c=React.useContext(Ctx);const child=React.Children.only(children);return React.cloneElement(child,{onClick:(e)=>{child.props.onClick?.(e);c.setOpen(!c.open);}});};
export const DropdownMenuContent=({children})=>{const c=React.useContext(Ctx);return c.open?React.createElement("div",{role:"menu"},children):null;};
export const DropdownMenuItem=({children,onSelect,onClick})=>{const c=React.useContext(Ctx);return React.createElement("div",{role:"menuitem",onClick:(e)=>{onClick?.(e);onSelect?.(e);c.setOpen(false);}},children);};
const Pass=({children})=>React.createElement(React.Fragment,null,children);
export const DropdownMenuGroup=Pass,DropdownMenuPortal=Pass,DropdownMenuSub=Pass,DropdownMenuRadioGroup=Pass,DropdownMenuSubTrigger=Pass,DropdownMenuSubContent=Pass,DropdownMenuCheckboxItem=DropdownMenuItem,DropdownMenuRadioItem=DropdownMenuItem,DropdownMenuLabel=Pass,DropdownMenuSeparator=()=>null,DropdownMenuShortcut=Pass;`
								: `export const rowCurrent=${role};`,
				}));
			},
		},
	],
});
const compiled = new Module(
	`${process.cwd()}/scripts/pending-owner-container-runtime.cjs`,
);
compiled.filename = `${process.cwd()}/scripts/pending-owner-container-runtime.cjs`;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const ui = compiled.exports;
const now = "2026-10-23T12:00:00Z";
const person = (id) => ({
	account_id: id,
	kind: "human",
	display_label: id,
	state: "active",
	role: "member",
});
const conversation = (id = "bcv_shared") => ({
	id,
	tenant_id: "org_shared",
	kind: "group",
	name: "Shared thread",
	visibility: "private",
	agent_capable: false,
	status: "open",
	created_by: "acct_a",
	last_message_at: now,
	latest_seq: 0,
	members: [person("acct_a"), person("acct_b")],
	last_read_seq: 0,
	unread_count: 0,
	muted: false,
});
const reply = (result) => ({ status: 200, body: { result } });
const delay = () =>
	act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
async function until(predicate, label) {
	for (let i = 0; i < 150; i++) {
		if (predicate()) return;
		await delay();
	}
	assert.fail(`timed out: ${label}`);
}
function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
async function mount({ empty = false, lifecycle = null } = {}) {
	localStorage.clear();
	const fixture = {
		account: "acct_a",
		tenant: "org_shared",
		refuse: true,
		calls: [],
		messages: new Map(),
		createGate: null,
		postGate: null,
		empty,
		generation: "A",
		enabled: true,
		readOnly: false,
		ownerGuard: 1,
		authGate: null,
		statusGate: null,
		historyGate: null,
		refuseHistory: new Set(),
		/* ARCHIVE SCENARIO (review round 1, U1). `lifecycle` rows, when set, REPLACE the
		   single group the other suites use: the live list answers the open ones and
		   the archived list (`status=archived`) the archived ones, exactly as agent-server
		   does. `historyByConversation` answers per-id history; `notAMember` names ids
		   whose history is refused with the server's typed 403. `lifecycleCalls` records
		   every archive/unarchive/delete the page makes. */
		lifecycle,
		historyByConversation: new Map(),
		notAMember: new Set(),
		lifecycleCalls: [],
		deleteFailure: null,
		lifecycleFailure: null,
	};
	window.api = {
		desktop: {
			request: async (request) => {
				// The fake server captures ownership at dispatch, just as an authenticated
				// request does. A late A reply must not silently become B's server history.
				const owner = fixture.account;
				const tenant = fixture.tenant;
				const generation = fixture.generation;
				const ownerKey = JSON.stringify([owner, tenant]);
				fixture.calls.push({ owner, tenant, ...request });
				switch (request.op) {
					case "capabilities":
						return reply({
							desktop_available: true,
							features: {
								radient: 1,
								team_bridge_conversations: 1,
								team_bridge_threads: 1,
								team_bridge_reactions: 1,
								team_bridge_conversation_owner_guard: fixture.ownerGuard,
							},
						});
					case "radient.request":
						if (request.control.operation === "account" && fixture.authGate)
							await fixture.authGate.promise;
						return reply({
							data: {
								result:
									request.control.operation === "account"
										? {
												account: {
													id: owner,
													name: owner,
													email: `${owner}@fixture.invalid`,
												},
												identity: {},
											}
										: { memberships: [] },
							},
						});
					case "team_bridge.status":
						if (fixture.statusGate) await fixture.statusGate.promise;
						return reply({
							capability: 1,
							state: "ready",
							read_only: fixture.readOnly,
							account_id: owner,
							tenant_id: tenant,
							surface_state: "D",
							visibility: {
								settings: true,
								inbox: true,
								account_door: true,
								onboarding: false,
							},
							update_required: false,
							local: {
								enabled: fixture.enabled,
								onboarding: "done",
								session: "present",
							},
							status: {
								tenants: [
									{
										tenant_id: "org_shared",
										tenant_name: "Shared",
										eligible: true,
										endpoint: null,
									},
									{
										tenant_id: "org_other",
										tenant_name: "Other",
										eligible: true,
										endpoint: null,
									},
								],
							},
							consent: null,
							error: null,
						});
					case "team_bridge.conversations.list":
						if (fixture.lifecycle) {
							const wanted = request.status ?? "open";
							return reply({
								conversations: fixture.lifecycle.filter(
									(row) => row.status === wanted,
								),
							});
						}
						return reply({
							conversations: fixture.empty
								? []
								: [{ ...conversation(), tenant_id: tenant }],
						});
					case "team_bridge.conversations.lifecycle": {
						fixture.lifecycleCalls.push({
							op: request.action,
							id: request.conversation_id,
						});
						if (fixture.lifecycleFailure)
							return fixture.lifecycleFailure(request);
						for (const row of fixture.lifecycle ?? [])
							if (row.id === request.conversation_id)
								row.status = request.action === "archive" ? "archived" : "open";
						return reply({ id: request.conversation_id });
					}
					case "team_bridge.conversations.delete":
						fixture.lifecycleCalls.push({
							op: request.op,
							id: request.conversation_id,
						});
						if (fixture.deleteFailure) return fixture.deleteFailure(request);
						fixture.lifecycle = (fixture.lifecycle ?? []).filter(
							(row) => row.id !== request.conversation_id,
						);
						return reply({ deleted: true });
					case "team_bridge.directory":
						return reply({
							members: ["Peer", "Other peer"].map((name, index) => ({
								account_id: `acct_peer_${index}`,
								display_label: name,
								role: "member",
								bridge_enabled: true,
								bridge_state: "active",
							})),
						});
					case "team_bridge.unread":
						return reply({
							total: owner === "acct_a" ? 7 : 2,
							organizations: [],
							conversations: [],
						});
					case "team_bridge.messages.list":
						if (fixture.historyGate) await fixture.historyGate.promise;
						if (fixture.notAMember.has(request.conversation_id))
							return {
								status: 403,
								body: {
									detail: { code: "not_a_member", text: "Not a member" },
								},
							};
						if (fixture.historyByConversation.has(request.conversation_id)) {
							fixture.calls.push({ historyFor: request.conversation_id });
							return reply({
								messages: fixture.historyByConversation.get(
									request.conversation_id,
								),
								has_more: false,
							});
						}
						if (fixture.refuseHistory.has(owner))
							return {
								status: 404,
								body: { detail: "Conversation unavailable to this account" },
							};
						return reply({
							messages: fixture.messages.get(ownerKey) ?? [],
							has_more: false,
						});
					case "team_bridge.conversations.create":
						if (fixture.createGate) await fixture.createGate.promise;
						return reply({
							...conversation(`created-${generation}`),
							tenant_id: tenant,
						});
					case "team_bridge.messages.send":
						if (fixture.postGate) await fixture.postGate.promise;
						if (fixture.refuse)
							return { status: 503, body: { detail: "transport refused" } };
						fixture.messages.set(ownerKey, [
							{
								id: `msg_${owner}`,
								conversation_id: request.conversation_id,
								seq: 1,
								sender: person(owner),
								body: request.body,
								origin: "human",
								created_at: now,
								client_ref: request.client_ref,
							},
						]);
						return reply({ id: `msg_${owner}` });
					case "team_bridge.read":
						return reply({
							conversation_id: request.conversation_id,
							last_read_seq: request.seq ?? 0,
							unread_count: 0,
							muted: false,
						});
					default:
						return reply({});
				}
			},
		},
	};
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const client = ui.queryClient;
	client.clear();
	const ownedQueries = new Set();
	const stopTracking = client
		.getQueryCache()
		.subscribe((event) => ownedQueries.add(event.query));
	const frames = [];
	const render = () =>
		root.render(
			React.createElement(
				ui.QueryClientProvider,
				{ client },
				React.createElement(
					ui.MemoryRouter,
					{
						initialEntries: [
							empty || lifecycle
								? "/team-bridge?tenant=org_shared"
								: "/team-bridge?tenant=org_shared&conversation=bcv_shared",
						],
					},
					React.createElement(
						React.Profiler,
						{
							id: "owner-boundary",
							// A final DOM assertion misses an effect-only reset leaking for one commit.
							// The profiler observes every committed production tree before passive effects.
							onRender: () => {
								const liveAccount = client.getQueryData(
									ui.radientUserKeys.user(),
								)?.account?.id;
								const status = client.getQueryData(
									ui.teamBridgeKeys.statusFor
										? ui.teamBridgeKeys.statusFor(liveAccount)
										: ui.teamBridgeKeys.status,
								);
								frames.push({
									account: status?.account_id,
									auth: client.getQueryData(ui.radientUserKeys.user())?.account
										?.id,
									tenant: status?.tenant_id,
									nav: host.querySelector("[data-nav-attention]")?.textContent,
									text: host.textContent,
									draft: host.querySelector("textarea")?.value ?? "",
								});
							},
						},
						React.createElement(
							React.Fragment,
							null,
							React.createElement(ui.AuthPrincipal),
							React.createElement(ui.TeamBridgePage),
						),
					),
				),
			),
		);
	await act(async () => render());
	await until(
		() =>
			empty || lifecycle
				? host.textContent.includes("Peer")
				: host.querySelector("textarea"),
		"production container ready",
	);
	return {
		host,
		fixture,
		client,
		frames,
		render,
		async changeAuth(accountId) {
			fixture.account = accountId;
			fixture.generation = accountId === "acct_a" ? "A" : "B";
			await act(async () => ui.commissionAccountRead(client));
			await act(async () =>
				client.invalidateQueries({ queryKey: ui.teamBridgeKeys.status }),
			);
			await delay();
		},
		async close() {
			await act(async () => root.unmount());
			fixture.authGate?.resolve();
			fixture.statusGate?.resolve();
			fixture.historyGate?.resolve();
			fixture.createGate?.resolve();
			fixture.postGate?.resolve();
			await act(async () => client.cancelQueries());
			await delay();
			for (const mutation of client.getMutationCache().getAll())
				mutation.destroy();
			client.clear();
			// A cancelled Query.fetch finally can schedule GC after removal. Destroy
			// every owned query after its cancellation settles, including removed ones.
			await delay();
			for (const query of ownedQueries) query.destroy();
			stopTracking();
			host.remove();
		},
	};
}
async function type(host, body) {
	const field = host.querySelector("textarea");
	assert.ok(field);
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			window.HTMLTextAreaElement.prototype,
			"value",
		).set.call(field, body);
		field.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
}
async function send(host) {
	const button = [...host.querySelectorAll("button")].find((b) =>
		["Send", "Send message"].includes(b.getAttribute("aria-label")),
	);
	assert.ok(
		button && !button.disabled,
		JSON.stringify({
			buttons: [...host.querySelectorAll("button")].map((b) => [
				b.textContent,
				b.getAttribute("aria-label"),
				b.disabled,
			]),
			field: host.querySelector("textarea")?.value,
			text: host.textContent,
		}),
	);
	await act(async () => button.click());
}

export { mount, ui, type, send, until, delay, deferred };
