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
 * THE RESTART PIN, and why the instrument below models re-renders. The
 * withdrawal once sat in the heartbeat effect's cleanup, whose deps include
 * `subscriptionId` — and a stream restart drops that to null while the same
 * conversation stays on screen — so every SSE reconnect withdrew a conversation
 * the pane was still displaying. That bug lives on the dep-change path: a
 * changed dep runs the effect's previous cleanup, and only a re-render can
 * express it, so `mount()` now hands back a `rerender` that replays the hook
 * against the same cells with React's dep semantics.
 *
 * The hook is bundled and driven through a React stand-in rather than rendered,
 * the same instrument `reconnect-page-gap.test.mjs` uses and for the same
 * reason: what is asserted is the CALL the shipped hook makes, not a frame.
 */

const reactStandIn = `
let cells = [];
let cursor = 0;
let block = 0;
const starts = new Map();
const slot = () => {
	const index = cursor++;
	if (!cells[index]) cells[index] = { block };
	return cells[index];
};
globalThis.__beginMount = () => {
	block += 1;
	cursor = cells.length;
	starts.set(block, cursor);
	return block;
};
globalThis.__rerenderBlock = (id) => {
	cursor = starts.get(id);
};
globalThis.__unmountBlock = (id) => {
	for (const cell of cells) {
		if (cell.block !== id || !cell.cleanup) continue;
		const cleanup = cell.cleanup;
		cell.cleanup = undefined;
		cleanup();
	}
};
const changed = (cell, deps) =>
	!cell.deps ||
	!deps ||
	cell.deps.length !== deps.length ||
	cell.deps.some((value, index) => !Object.is(value, deps[index]));
export const useEffect = (fn, deps) => {
	const cell = slot();
	if (!changed(cell, deps)) return;
	/*
	 * React's dep semantics: a changed dep runs the effect's previous cleanup
	 * before the next effect. The withdrawal used to live in a cleanup whose
	 * deps included the subscription id, so this reconciliation — and not a
	 * fresh mount — is the event that bug turned on.
	 */
	cell.cleanup?.();
	cell.deps = deps;
	globalThis.__effects.push(() => {
		cell.cleanup = fn();
	});
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
const RESTARTED_SUBSCRIPTION = "c".repeat(32);

/**
 * Drive the shipped hook through the stand-in, and hand back its teardown.
 *
 * `mount` opens a fresh cell block — a component mounting with its own identity
 * — and the returned teardown carries `rerender`, which replays the hook
 * against that same block with React's dep semantics: a changed dep runs the
 * effect's previous cleanup, an unchanged one runs nothing. `rerender` is what
 * drives a subscription restart; a fresh mount cannot say that a dep changed
 * under an already-running pane.
 */
const mounted = [];

function mount(sessionId, subscriptionId) {
	const block = globalThis.__beginMount();
	const render = (nextSessionId, nextSubscriptionId) => {
		globalThis.__effects = [];
		useDesktopWatchLease(nextSessionId, nextSubscriptionId);
		for (const effect of globalThis.__effects.splice(0)) effect();
	};
	render(sessionId, subscriptionId);
	const rerender = (nextSessionId, nextSubscriptionId) => {
		globalThis.__rerenderBlock(block);
		render(nextSessionId, nextSubscriptionId);
	};
	const unmount = () => {
		globalThis.__unmountBlock(block);
	};
	unmount.rerender = rerender;
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
	const pane = mount(SESSION, SUBSCRIPTION);
	pane.rerender(OTHER, SUBSCRIPTION);
	assert.deepEqual(
		releases,
		[{ sessionId: SESSION }],
		"the pane withdrew the conversation it left, and not the one it moved to",
	);
	pane();
	assert.deepEqual(
		releases,
		[{ sessionId: SESSION }, { sessionId: OTHER }],
		"the pane's own leave withdraws its own conversation",
	);
});

test("a subscription restart re-runs the heartbeat and withdraws nothing", () => {
	/*
	 * THE LIVE BUG THIS PIN EXISTS FOR. A stream restart — every SSE reconnect on
	 * a busy machine — drops `subscriptionId` to null while the SAME conversation
	 * stays on screen, and the next `open` frame establishes a new id. With the
	 * withdrawal riding the heartbeat effect's cleanup, each of those transitions
	 * withdrew the displayed conversation; main's machine-wide presence then
	 * reported `session_id: ""` for a window that was still showing one.
	 */
	const { heartbeats, releases } = installBridge();
	const pane = mount(SESSION, SUBSCRIPTION);
	assert.equal(heartbeats.length, 1, "the mount sent no first beat");
	pane.rerender(SESSION, null);
	assert.equal(heartbeats.length, 1, "a beat was sent without a subscription");
	assert.equal(
		releases.length,
		0,
		"the stream's end withdrew the conversation the pane still displays",
	);
	pane.rerender(SESSION, RESTARTED_SUBSCRIPTION);
	assert.equal(heartbeats.length, 2, "the restarted subscription did not beat");
	assert.equal(
		releases.length,
		0,
		"re-establishing the stream withdrew the displayed conversation",
	);
	pane();
	assert.deepEqual(
		releases,
		[{ sessionId: SESSION }],
		"a genuine leave must still withdraw, exactly once",
	);
});

test("no beat is sent for a subscription id the backend would reject", () => {
	/*
	 * The hook early-returns on a falsy subscription id and on one that is not
	 * the backend's `[a-f0-9]{32}`; sending the lease anyway earns a 422 on every
	 * beat. "Sends nothing" is only meaningful next to the cases that do send.
	 */
	for (const [sessionId, subscriptionId] of [
		[undefined, SUBSCRIPTION],
		[SESSION, null],
		[SESSION, "not-a-subscription-id"],
		[SESSION, "b".repeat(31)],
	]) {
		const { heartbeats } = installBridge();
		const unmount = mount(sessionId, subscriptionId);
		assert.equal(
			heartbeats.length,
			0,
			`no lease is sent for ${String(sessionId)}/${String(subscriptionId)}`,
		);
		unmount();
	}
});

test("a leave withdraws by the session id alone, even when no lease was sent", () => {
	/*
	 * The withdrawal is keyed on the session, not on a live subscription: a
	 * stream that has already ended must not strand main's "showing A" until the
	 * report's own TTL, and main's `releaseWatch` is identity-safe, so a release
	 * for a report that does not exist clears nothing.
	 */
	for (const [sessionId, subscriptionId, expected] of [
		[undefined, SUBSCRIPTION, []],
		[SESSION, null, [{ sessionId: SESSION }]],
		[SESSION, "not-a-subscription-id", [{ sessionId: SESSION }]],
		[SESSION, "b".repeat(31), [{ sessionId: SESSION }]],
	]) {
		const { releases } = installBridge();
		const unmount = mount(sessionId, subscriptionId);
		unmount();
		assert.deepEqual(
			releases,
			expected,
			`${String(sessionId)}/${String(subscriptionId)} withdrew ${JSON.stringify(releases)}`,
		);
	}
});
