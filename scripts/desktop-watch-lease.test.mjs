import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * The renderer's half of R2-4: the hook that WITHDRAWS the displayed
 * conversation when the pane leaves it.
 *
 * WHY THIS FILE EXISTS (review round 3, R3-4). `releaseWatchHeartbeat` was
 * referenced by the preload/IPC plumbing and by exactly one place in the app —
 * the cleanup at the foot of `use-desktop-watch-lease.ts` — and nothing in the
 * suite touched it. Deleting those two cleanup lines therefore left every test
 * green while restoring R2-4's defect (main kept renewing "showing A" every
 * beat, and the backend, which believes fresh presence, went on suppressing A's
 * banner while no pane displayed it). The notifier half was well covered; this
 * is the caller.
 *
 * The hook is bundled and driven through a React stand-in rather than rendered,
 * the same instrument `reconnect-page-gap.test.mjs` uses and for the same
 * reason: what is asserted is the CALL the shipped hook makes, not a frame.
 */

const reactStandIn = `
let cells = [];
let cursor = 0;
const slot = () => {
	const index = cursor++;
	if (!cells[index]) cells[index] = {};
	return cells[index];
};
export const useEffect = (fn, deps) => {
	const cell = slot();
	const changed =
		!cell.deps ||
		!deps ||
		cell.deps.length !== deps.length ||
		cell.deps.some((value, index) => !Object.is(value, deps[index]));
	if (changed) {
		cell.deps = deps;
		globalThis.__effects.push(fn);
	}
};
export const useLayoutEffect = useEffect;
export const useInsertionEffect = () => {};
export const useState = (init) => {
	const cell = slot();
	if (!("state" in cell)) cell.state = typeof init === "function" ? init() : init;
	return [cell.state, (next) => { cell.state = typeof next === "function" ? next(cell.state) : next; }];
};
export const useRef = (init) => {
	const cell = slot();
	if (!("ref" in cell)) cell.ref = { current: init };
	return cell.ref;
};
export const useCallback = (fn) => fn;
export const useMemo = (fn) => fn();
export const useSyncExternalStore = () => undefined;
export const useDebugValue = () => {};
export const createElement = () => null;
export const Fragment = Symbol("fragment");
export default { useEffect, useLayoutEffect, useInsertionEffect, useState, useRef, useCallback, useMemo, useSyncExternalStore, useDebugValue, createElement, Fragment };
`;

const bundle = await build({
	stdin: {
		contents: `export { useDesktopWatchLease } from "./src/renderer/src/shared/hooks/use-desktop-watch-lease";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	plugins: [
		{
			name: "desktop-watch-lease-fixture",
			setup(builder) {
				// The JSON transport is not this file's subject: the native path is
				// installed below, and only its absence reaches this module.
				builder.onResolve({ filter: /local-operator\/desktop-api$/ }, () => ({
					path: "transport",
					namespace: "lease-fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "lease-fixture" }, () => ({
					contents: `
						export class DesktopControlError extends Error {}
						export class UserFacingError extends Error {}
						export const userFacingMessage = (error) => String(error?.message ?? error);
						export const desktopResult = (request) => globalThis.__leaseRequests.push(request);`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
				/*
				 * Its OWN namespace: esbuild takes the first onLoad whose filter and
				 * namespace match, so a second handler in `lease-fixture` would never
				 * be reached (the transport handler above matches every path there,
				 * and the react import would resolve to the transport's contents).
				 */
				builder.onResolve({ filter: /^react$/ }, () => ({
					path: "react",
					namespace: "lease-react",
				}));
				builder.onLoad({ filter: /.*/, namespace: "lease-react" }, () => ({
					contents: reactStandIn,
					loader: "js",
					resolveDir: process.cwd(),
				}));
			},
		},
	],
});
const bundlePath = new URL(
	"./_desktop-watch-lease.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { useDesktopWatchLease } = await import(bundlePath.href);
// Unlinked as soon as the graph is evaluated, so no build artifact survives a
// crash mid-run and none can be committed by accident.
await unlink(bundlePath);

const SUBSCRIPTION = "a".repeat(32);
const SESSION = "123456abcdef";
const OTHER = "654321fedcba";

/** Drive the shipped hook through the stand-in, and hand back its teardown. */
const mounted = [];

function mount(sessionId, subscriptionId) {
	const cleanups = [];
	globalThis.__effects = [];
	globalThis.__cursor = 0;
	const slots = [];
	// The stand-in keeps its cells in module state; a fresh mount starts at zero,
	// which is what a component that mounted with a different identity does.
	useDesktopWatchLease(sessionId, subscriptionId);
	const flush = globalThis.__effects.splice(0);
	for (const effect of flush) {
		const cleanup = effect();
		if (typeof cleanup === "function") cleanups.push(cleanup);
	}
	const unmount = () => {
		for (const cleanup of cleanups.splice(0)) cleanup();
	};
	/*
	 * Registered as well as returned: a failed assertion would otherwise skip the
	 * cleanup, and the hook's 15 s interval would keep the whole run alive — a
	 * suite that HANGS on failure is worse than one that fails.
	 */
	mounted.push(unmount);
	return unmount;
}

/** A window with the native bridge main exposes, recording what the hook sends. */
function installBridge() {
	const heartbeats = [];
	const releases = [];
	// A live effect registers visibility/focus/blur listeners and a 15 s interval,
	// so the stand-in window and document have to carry the listener pair: a
	// missing one throws inside the effect and the cleanup (and so the release
	// this file is about) never runs.
	const listeners = {
		addEventListener: () => {},
		removeEventListener: () => {},
	};
	globalThis.window = {
		...listeners,
		api: {
			desktop: {
				watchHeartbeat: (args) => heartbeats.push(args),
				releaseWatchHeartbeat: (args) => releases.push(args),
			},
		},
	};
	globalThis.document = {
		...listeners,
		visibilityState: "visible",
		hasFocus: () => true,
	};
	return { heartbeats, releases };
}

after(() => {
	for (const unmount of mounted.splice(0)) unmount();
});

test("the pane withdraws its conversation when it unmounts", () => {
	const { releases } = installBridge();
	const unmount = mount(SESSION, SUBSCRIPTION);
	assert.equal(
		releases.length,
		0,
		"nothing is withdrawn while the pane is displayed",
	);
	unmount();
	assert.deepEqual(
		releases,
		[{ sessionId: SESSION }],
		"the cleanup withdraws the conversation the pane was displaying",
	);
});

test("the pane withdraws the conversation it LEAVES when the session changes", () => {
	/*
	 * The navigation case this fix exists for: leaving conversation A for B (or
	 * for the catalogue) re-runs the effect, so the cleanup that fires names A
	 * while the pane is already on B. An implementation that released whatever is
	 * current, or released nothing, is what R2-4 was.
	 */
	const { releases } = installBridge();
	const unmountA = mount(SESSION, SUBSCRIPTION);
	unmountA();
	const unmountB = mount(OTHER, SUBSCRIPTION);
	assert.deepEqual(
		releases,
		[{ sessionId: SESSION }],
		"the pane withdrew the conversation it left, and not the one it moved to",
	);
	unmountB();
	assert.deepEqual(releases.at(-1), { sessionId: OTHER });
});

test("a pane that never held a valid lease withdraws nothing", () => {
	/*
	 * The hook early-returns on a falsy session id and on a subscription id that
	 * is not the backend's `[a-f0-9]{32}`, so there is nothing displayed to
	 * withdraw — and main's `releaseWatch` would otherwise be asked to clear a
	 * report that does not exist. Both directions are asserted, because "sends
	 * nothing" is only meaningful next to the case that does send.
	 */
	for (const [sessionId, subscriptionId] of [
		[undefined, SUBSCRIPTION],
		[SESSION, null],
		[SESSION, "not-a-subscription-id"],
		[SESSION, "b".repeat(31)],
	]) {
		const { heartbeats, releases } = installBridge();
		const unmount = mount(sessionId, subscriptionId);
		assert.equal(
			heartbeats.length,
			0,
			`no lease is sent for ${String(sessionId)}/${String(subscriptionId)}`,
		);
		unmount();
		assert.equal(
			releases.length,
			0,
			`nothing is withdrawn for ${String(sessionId)}/${String(subscriptionId)}`,
		);
	}
});
