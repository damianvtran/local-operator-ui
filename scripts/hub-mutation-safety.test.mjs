/** The real write hooks, not a copied list of guard calls. MAIN is an explicit
 * typed-status fixture here; native identity/renderer proof is recorded separately. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { isPaintedScrollBox } from "./hub-guard-geometry.mjs";
const require = createRequire(import.meta.url);
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const { JSDOM } = require("jsdom");
const UI_PRIMITIVES = /^@shared\/components\/ui\/(button|switch|dialog)$/;
const ANY_UI_MODULE = /.*/;
const COPY = {
	checking: /Checking the Local Operator backend/,
	disconnected: /Reconnect the Local Operator backend/,
	unsupported: /Update the Local Operator backend/,
	manual: /Manual (?:check|pull)/,
	minimum: /backend.*0\.72\.1/,
	upgrade: /Update the/,
	off: /Incoming updates are off/,
	available: /Manual check and pull remain available/,
	alert: /role="alert"/,
};
const base = `${process.cwd()}/src/renderer/src/shared/api/local-operator`;
const fixed = {
	state: "attached",
	version: "0.72.1",
	url: "http://127.0.0.1:8127",
	instanceId: "synthetic-guard-a",
	pid: 990071,
	reconnecting: false,
	owned: false,
	prefix: "fixture",
	installKind: "fixture",
	desktopAvailable: true,
	pairing: { available: true },
	failures: 0,
	unanswered: 0,
	capabilityStatus: null,
	lastTransportAt: 1,
	detail: "explicit fixture",
	addressSubstitution: null,
};
const state = {
	health: {
		data: { online: true, snapshot: fixed },
		isFetching: false,
		isError: false,
		isPlaceholderData: false,
	},
	records: [],
};
globalThis.__hubGuardTest = state;
// Node's native localStorage getter is not a browser storage fixture.
Object.defineProperty(globalThis, "localStorage", {
	value: undefined,
	configurable: true,
});
const bundle = await build({
	stdin: {
		contents: `export {useHubLinkPolicy} from '${base}/hub-link-hooks.ts';export {useHubLinkActions,useHubSourceResolution} from '${base}/hub-link-actions.ts';export {useHubActions} from '${base}/hub-hooks.ts';export * from '${base}/hub-mutation-safety.ts';export {useHubActionStore} from '${base}/hub-action-store.ts';export {desktopEndpoint} from '${process.cwd()}/src/shared/desktop-contract.ts';export {HubLinkPolicyControls} from '${process.cwd()}/src/renderer/src/features/agents/components/hub-link-policy-controls.tsx';`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	write: false,
	packages: "external",
	external: ["react", "react/jsx-runtime"],
	jsx: "automatic",
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	plugins: [
		{
			name: "explicit-main-status-and-wire",
			setup(b) {
				// This suite isolates backend-version/write safety. Current-account
				// membership is exercised with the real hook in the popover suite.
				b.onResolve({ filter: /hub-link-source$/ }, () => ({
					path: "source",
					namespace: "guard-source",
				}));
				b.onLoad({ filter: /.*/, namespace: "guard-source" }, () => ({
					contents: `import {t} from "@shared/i18n"; export const useHubLinkSource=(link)=>({source:link.visibility==="public"?t("ui.hub.links.source_label_public"):null,organization:null});`,
					resolveDir: process.cwd(),
					loader: "ts",
				}));
				// Inert primitive boundaries make the real component's dialog subtree
				// inspectable by SSR. This is copy/placement proof, not portal/focus QA.
				b.onResolve({ filter: UI_PRIMITIVES }, () => ({
					path: "ui",
					namespace: "guard-ui",
				}));
				b.onLoad({ filter: ANY_UI_MODULE, namespace: "guard-ui" }, () => ({
					contents: `import {createElement as h} from 'react';const D=({children})=>h('div',null,children);export const Button=({children,disabled})=>h('button',{disabled},children);export const Switch=({disabled,checked})=>h('button',{role:'switch',disabled,'aria-checked':checked});export const Dialog=D,DialogDescription=D,DialogFooter=D,DialogHeader=D,DialogTitle=D;export const DialogContent=({children})=>h('section',{'data-unit-dialog':true},children);`,
					loader: "js",
				}));
				b.onResolve(
					{ filter: /^@shared\/hooks\/use-connectivity-status$/ },
					() => ({ path: "health", namespace: "guard-fixture" }),
				);
				b.onResolve({ filter: /^\.\/desktop-api$/ }, (args) =>
					/hub-(?:link-hooks|link-actions|hooks)\.ts$/.test(args.importer)
						? { path: "transport", namespace: "guard-fixture" }
						: undefined,
				);
				b.onLoad({ filter: /.*/, namespace: "guard-fixture" }, (args) => ({
					contents:
						args.path === "health"
							? "export const useServerHealth=()=>globalThis.__hubGuardTest.health;"
							: `export {DesktopControlError,isDeadlineExceeded,userFacingMessage} from '${base}/desktop-api.ts';export async function desktopResult(input){globalThis.__hubGuardTest.records.push(input);return {reports:[],status:{items:[],credential:'ok'},links:{links:[],unresolved:[]},link_id:input.linkId,policy:{subscribe:true,auto_push:false,revision:'fixture-rev'}};}`,
					loader: "ts",
					resolveDir: process.cwd(),
				}));
			},
		},
	],
});
const mod = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
	require,
	mod,
	mod.exports,
);
const api = mod.exports;
const pause = () => new Promise((resolve) => setTimeout(resolve, 5));
function bridge(snapshot = fixed) {
	const listeners = new Set();
	return {
		getStatus: async () => snapshot,
		onStatusChange(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		emit(s) {
			for (const fn of listeners) fn(s);
		},
		listeners,
	};
}

test("capture labels obey the real IPC length guard and policy path follows the actual contract", () => {
	const source = readFileSync("src/main/dev-driver-ipc.ts", "utf8");
	const literal = source.match(/^const FRAME_LABEL = \/(.*)\/;$/m);
	assert(
		literal,
		"read the actual capture validator, never invent a weaker guard",
	);
	const validator = new RegExp(literal[1]);
	const rejected =
		"hub-core-guard-1380x900-local-operator-dark-fixture-enabled-policy-off";
	assert.equal(validator.test(rejected), false);
	for (const suffix of [
		"fixture-policy-off",
		"old-core-disabled",
		"fixture-browse-zero",
	])
		assert.equal(
			validator.test(`hub-core-guard-1380x900-local-operator-dark-${suffix}`),
			true,
		);
	const endpoint = api.desktopEndpoint({
		op: "hub.policy",
		requestId: "synthetic-policy",
		linkId: "link-public-agent",
		expectedPolicyRevision: "fixture-rev",
		subscribe: false,
	});
	assert.equal(endpoint.method, "PATCH");
	assert.equal(endpoint.path, "/v1/desktop/hub/links/link-public-agent");
	console.log(
		`actual IPC label negative: ${rejected.length} chars REFUSED; short labels accepted; actual policy endpoint ${endpoint.method} ${endpoint.path}`,
	);
});

test("painted geometry rejects both zero-wrapper and horizontal-overflow negative controls", () => {
	const good = { w: 900, h: 700, cw: 900, ch: 700, sw: 900 };
	assert.equal(isPaintedScrollBox(good), true);
	assert.equal(isPaintedScrollBox({ w: 0, h: 0, cw: 0, ch: 0, sw: 0 }), false);
	assert.equal(isPaintedScrollBox({ ...good, sw: 901 }), false);
	assert.equal(isPaintedScrollBox(null), false);
	console.log(
		"geometry negative controls: zero-wrapper REFUSED, horizontal-overflow REFUSED, actual-size positive ACCEPTED",
	);
});

test("strict published core minimum, identity, and uncertainty fail closed", () => {
	for (const value of [
		null,
		undefined,
		"",
		"Unknown (update required)",
		"0.71.5",
		"0.72.0",
		"0.72.1rc1",
		"0.72.1-rc.1",
		"0.72.1.dev1",
		"0.72.2-dev.1",
		"v0.72.1",
		"0.72.01",
		" 0.72.1",
		"0.72.1 trailing",
		"0.72.1\n",
		"0.72.1\r\n",
		"999999999999999999999.0.0",
	])
		assert.equal(api.hubMutationVersionSafe(value), false, String(value));
	for (const value of ["0.72.1", "0.72.2", "0.73.0", "1.0.0"])
		assert.equal(api.hubMutationVersionSafe(value), true, value);
	for (const state of [
		"connecting",
		"degraded",
		"detached",
		"replaced",
		"wedged",
	])
		assert.equal(
			api.hubMutationSnapshotSafe({ ...fixed, state }),
			false,
			state,
		);
	for (const patch of [
		{ instanceId: null },
		{ url: null },
		{ pid: null },
		{ pid: 0 },
	])
		assert.equal(api.hubMutationSnapshotSafe({ ...fixed, ...patch }), false);
});

test("fresh invoke, newer push, and target identity fence stale positive results", async () => {
	let calls = 0;
	const run = async () => ++calls;
	for (const now of [
		{ ...fixed, version: "0.71.5" },
		{ ...fixed, state: "detached" },
		{ ...fixed, instanceId: "synthetic-b" },
		{ ...fixed, pid: 990072 },
		{ ...fixed, url: "http://127.0.0.1:8128" },
	]) {
		const b = bridge(now);
		await assert.rejects(
			api.guardHubMutation(run, fixed, b),
			api.HubMutationUpgradeRequired,
		);
		assert.equal(b.listeners.size, 0);
	}
	const failed = bridge();
	failed.getStatus = async () => {
		throw Error("fixture IPC refused");
	};
	await assert.rejects(
		api.guardHubMutation(run, fixed, failed),
		api.HubMutationUpgradeRequired,
	);
	for (const pushed of [
		{ ...fixed, version: "0.71.5" },
		{ ...fixed, state: "detached" },
		{ ...fixed, version: "0.72.2", instanceId: "synthetic-replacement" },
	]) {
		const b = bridge();
		let resolve;
		b.getStatus = () =>
			new Promise((r) => {
				resolve = r;
			});
		const result = api.guardHubMutation(run, fixed, b);
		b.emit(pushed);
		resolve(fixed);
		await assert.rejects(result, api.HubMutationUpgradeRequired);
		assert.equal(b.listeners.size, 0);
	}
	assert.equal(calls, 0);
	const ok = bridge();
	assert.equal(await api.guardHubMutation(run, fixed, ok), 1);
	assert.equal(ok.listeners.size, 0);
	// A completed request is not replayed just because a status push arrived in flight.
	let finish;
	const b = bridge();
	const running = api.guardHubMutation(
		() => {
			calls++;
			return new Promise((r) => {
				finish = r;
			});
		},
		fixed,
		b,
	);
	await pause();
	b.emit({ ...fixed, version: "0.71.5" });
	finish("accepted before change");
	assert.equal(await running, "accepted before change");
	assert.equal(calls, 2);
	console.log(
		"guard negatives: old/unknown/disconnected/replaced/late-positive blocked; accepted in-flight request not replayed",
	);
});

test("backend copy distinguishes initial, disconnected and unsupported states inside consent", () => {
	const { renderToStaticMarkup } = require("react-dom/server");
	const savedHealth = state.health;
	globalThis.window = { api: { backend: bridge() } };
	const direction = {
		state: "idle",
		effective: false,
		reason: null,
		retryable: false,
	};
	const link = {
		link_id: "unit-link",
		kind: "agent",
		visibility: "public",
		tenant_name: null,
		remote_revision: "rev-1",
		policy: { subscribe: false, auto_push: false, revision: "policy-1" },
		eligibility: { can_auto_push: true, reason: null },
		pull: direction,
		push: direction,
	};
	try {
		for (const [label, health, expected] of [
			["initial", { data: undefined, isFetching: true }, COPY.checking],
			[
				"placeholder",
				{ data: { snapshot: fixed }, isPlaceholderData: true },
				COPY.checking,
			],
			[
				"disconnected",
				{ data: { snapshot: { ...fixed, state: "detached" } } },
				COPY.disconnected,
			],
			[
				"error",
				{ data: { snapshot: fixed }, isError: true },
				COPY.disconnected,
			],
			[
				"old",
				{ data: { snapshot: { ...fixed, version: "0.71.5" } } },
				COPY.unsupported,
			],
			[
				"prerelease",
				{ data: { snapshot: { ...fixed, version: "0.72.2-dev" } } },
				COPY.unsupported,
			],
			[
				"replacement",
				{ data: { snapshot: { ...fixed, state: "replaced" } } },
				COPY.disconnected,
			],
		]) {
			state.health = {
				isFetching: false,
				isError: false,
				isPlaceholderData: false,
				...health,
			};
			const client = new QueryClient();
			const html = renderToStaticMarkup(
				React.createElement(
					QueryClientProvider,
					{ client },
					React.createElement(api.HubLinkPolicyControls, { link }),
				),
			);
			const dom = new JSDOM(html);
			const dialog = dom.window.document.querySelector("[data-unit-dialog]");
			assert.match(
				dialog.querySelector('[role="alert"]').textContent,
				expected,
				label,
			);
			assert.equal(
				[...dialog.querySelectorAll("button")].at(-1).disabled,
				true,
				label,
			);
			assert.doesNotMatch(html, COPY.manual, label);
			if (label === "old" || label === "prerelease")
				assert.match(dialog.textContent, COPY.minimum);
			if (label === "initial")
				assert.doesNotMatch(dialog.textContent, COPY.upgrade);
			dom.window.close();
			client.clear();
		}
		state.health = {
			data: { snapshot: fixed },
			isFetching: true,
			isError: false,
			isPlaceholderData: false,
		};
		const client = new QueryClient();
		const html = renderToStaticMarkup(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(api.HubLinkPolicyControls, { link }),
			),
		);
		assert.match(html, COPY.off);
		assert.match(html, COPY.available);
		assert.doesNotMatch(html, COPY.alert);
		client.clear();
	} finally {
		state.health = savedHealth;
		globalThis.window = undefined;
	}
});

test("mounted actual policy/link/source/legacy hooks fence every write arm and retain read eligibility", async () => {
	const dom = new JSDOM('<div id="root"></div>', {
		url: "http://fixture.invalid",
	});
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, "localStorage", {
		value: dom.window.localStorage,
		configurable: true,
	});
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const root = createRoot(document.getElementById("root"));
	let exposed;
	function Probe() {
		exposed = {
			policy: api.useHubLinkPolicy(),
			link: api.useHubLinkActions({
				link_id: "fixture-link",
				kind: "agent",
				name: "fixture",
			}),
			resolve: api.useHubSourceResolution(),
			legacy: api.useHubActions(),
			safety: api.useHubMutationSafety(),
		};
		return null;
	}
	const render = () =>
		act(async () => {
			root.render(
				React.createElement(
					QueryClientProvider,
					{ client },
					React.createElement(Probe),
				),
			);
			await pause();
		});
	const link = {
		link_id: "fixture-link",
		policy: { revision: "fixture-rev", subscribe: true, auto_push: false },
	};
	const cases = (x) => [
		[
			"policy",
			() => x.policy.mutateAsync({ link, patch: { subscribe: false } }),
		],
		[
			"check",
			() => x.link.mutateAsync({ action: "check", linkId: link.link_id }),
		],
		[
			"pull-preview",
			() =>
				x.link.mutateAsync({
					action: "apply",
					linkId: link.link_id,
					preview: true,
				}),
		],
		[
			/*
			 * The incoming confirm is a plain item-addressed apply: core has no
			 * pull receipt (its apply route recomputes the merge), so the only
			 * choice a confirm can carry is `prefer`.
			 */
			"pull-apply",
			() =>
				x.link.mutateAsync({
					action: "apply",
					linkId: link.link_id,
					prefer: "local",
				}),
		],
		...["pull", "push"].map((direction) => [
			`retry-${direction}`,
			() =>
				x.link.mutateAsync({
					action: "retry",
					linkId: link.link_id,
					direction,
				}),
		]),
		[
			"push-preview",
			() => x.link.mutateAsync({ action: "preview", linkId: link.link_id }),
		],
		[
			"push-confirm",
			() =>
				x.link.mutateAsync({
					action: "confirm",
					linkId: link.link_id,
					previewReceipt: "reviewed-receipt",
				}),
		],
		[
			"source-resolve",
			() =>
				x.resolve.mutateAsync({
					kind: "agent",
					localId: "fixture-local",
					name: "fixture",
					hubSource: "https://fixture.invalid",
					visibility: "public",
					tenantId: null,
				}),
		],
		["legacy-apply", () => x.legacy.applyItem("agent", "fixture")],
		["legacy-retry", () => x.legacy.retryItem("agent", "fixture")],
		["legacy-check", () => x.legacy.checkNow()],
		["legacy-applyAll", () => x.legacy.applyAll("agent")],
	];
	try {
		window.api = { backend: bridge() };
		await render();
		assert.equal(exposed.safety.canWrite, true);
		const retained = cases(exposed);
		for (const [name, invoke] of retained) {
			const before = state.records.length;
			await act(async () => {
				await invoke();
				await pause();
			});
			assert.equal(state.records.length, before + 1, name);
		}
		assert.deepEqual(
			new Set(state.records.map((x) => x.op)),
			new Set([
				"hub.policy",
				"hub.check",
				"hub.apply",
				"hub.retry",
				"hub.push",
				"hub.applyAll",
			]),
		);
		const positive = state.records.length;
		for (const actual of [
			{ ...fixed, version: "0.71.5" },
			{ ...fixed, version: null },
			{ ...fixed, state: "detached" },
			{ ...fixed, instanceId: "synthetic-other" },
		]) {
			window.api.backend = bridge(actual);
			for (const [name, invoke] of retained) {
				await act(async () => {
					try {
						await invoke();
						assert(name.startsWith("legacy-"), `${name} must refuse`);
					} catch (e) {
						assert(
							e instanceof api.HubMutationUpgradeRequired,
							`${name}: ${e}`,
						);
					}
					await pause();
				});
			}
		}
		assert.equal(
			state.records.length,
			positive,
			"retained callbacks on actual old/unknown/detached/replaced MAIN send ZERO writes",
		);
		state.health = { ...state.health, isFetching: true };
		await render();
		assert.equal(
			exposed.safety.canWrite,
			true,
			"verified ordinary refetch stays focusable",
		);
		assert.equal(exposed.safety.upgradeMessage, null);
		state.health = { ...state.health, isFetching: false };
		for (const key of ["isError", "isPlaceholderData"]) {
			state.health = { ...state.health, [key]: true };
			await render();
			assert.equal(exposed.safety.canWrite, false, key);
			state.health = { ...state.health, [key]: false };
		}
		state.health = {
			...state.health,
			data: { online: true, snapshot: { ...fixed, version: null } },
		};
		await render();
		assert.equal(exposed.safety.canWrite, false);
		assert.match(
			exposed.safety.upgradeMessage,
			/Update the Local Operator backend to a published release 0\.72\.1 or newer/,
		);
		assert.doesNotMatch(exposed.safety.upgradeMessage, /outdated|old version/i);
		console.log(
			`actual hooks: ${positive} fixed-version arms transmitted; ${retained.length * 4} stale old/unknown/disconnected/identity callbacks -> ZERO additional writes; verified normal poll keeps controls eligible; dispatch still verifies MAIN`,
		);
	} finally {
		await act(async () => root.unmount());
		client.clear();
		api.useHubActionStore.getState().reset();
		dom.window.close();
		globalThis.window = undefined;
		globalThis.document = undefined;
		globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
	}
});
