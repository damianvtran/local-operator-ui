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
		contents: `export {useHubLinkPolicy} from '${base}/hub-link-hooks.ts';export {useHubLinkActions,useHubSourceResolution} from '${base}/hub-link-actions.ts';export {useHubActions} from '${base}/hub-hooks.ts';export * from '${base}/hub-mutation-safety.ts';export {useHubActionStore} from '${base}/hub-action-store.ts';export {desktopEndpoint} from '${process.cwd()}/src/shared/desktop-contract.ts';`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	write: false,
	packages: "external",
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	plugins: [
		{
			name: "explicit-main-status-and-wire",
			setup(b) {
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
			link: api.useHubLinkActions("fixture-link"),
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
			"pull-confirm",
			() =>
				x.link.mutateAsync({
					action: "apply",
					linkId: link.link_id,
					confirmApply: true,
					previewReceipt: "reviewed-receipt",
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
		for (const key of ["isFetching", "isError", "isPlaceholderData"]) {
			state.health = { ...state.health, [key]: true };
			await render();
			assert.equal(exposed.safety.canWrite, false, key);
			if (key === "isFetching")
				assert.equal(
					exposed.safety.upgradeMessage,
					null,
					"healthy background polling must not flash an upgrade warning",
				);
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
			/Hub changes require core 0\.72\.1 or newer/,
		);
		assert.doesNotMatch(exposed.safety.upgradeMessage, /outdated|old version/i);
		console.log(
			`actual hooks: ${positive} fixed-version arms transmitted; ${retained.length * 4} stale old/unknown/disconnected/identity callbacks -> ZERO additional writes; normal poll only blocks Hub writes, no upgrade flash`,
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
