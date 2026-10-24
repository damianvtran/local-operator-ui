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
])
	globalThis[name] = dom.window[name];
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
	external: ["react", "react-dom"],
	loader: { ".css": "empty" },
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
				b.onResolve({ filter: SIDEBAR }, () => ({
					path: "sidebar",
					namespace: "fixture",
				}));
				b.onLoad({ filter: ANY, namespace: "fixture" }, () => ({
					loader: "js",
					contents: `export const rowCurrent=${role};`,
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
async function mount({ empty = false } = {}) {
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
						return reply({
							conversations: fixture.empty
								? []
								: [{ ...conversation(), tenant_id: tenant }],
						});
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
							empty
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
			empty
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
