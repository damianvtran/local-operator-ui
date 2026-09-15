/*
 * The launch-argument path, end to end within this process (R1-4).
 *
 * WHY THIS FILE EXISTS. B3's mechanism - main puts the click's session id into
 * the window's own argv, preload reads it before the first paint, and the store
 * refuses to let the persisted conversation win - was exercised by NOTHING.
 * `grep -rn "open-session\|readOpenSessionArgv\|initialSession" scripts/` found no
 * test, and both halves are pure functions over data a test can build: the argv
 * reader, and the merge rule that keeps a launch id from being overwritten
 * during hydration. A silent regression in either shows the user the wrong
 * conversation in a window that was created to show a specific one, which is
 * the flash this change exists to remove.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const reactStandIn = `const R = () => globalThis.__reactRuntime;
export const useState = (...a) => R().useState(...a);
export const useEffect = (...a) => R().useEffect(...a);
export const useLayoutEffect = (...a) => R().useLayoutEffect(...a);
export const useInsertionEffect = () => {};
export const useRef = (...a) => R().useRef(...a);
export const useCallback = (...a) => R().useCallback(...a);
export const useMemo = (...a) => R().useMemo(...a);
export const useSyncExternalStore = (...a) => R().useSyncExternalStore(...a);
export const useDebugValue = () => {};
export const createElement = () => ({});
export const Fragment = Symbol("fragment");
export default { useState, useEffect, useLayoutEffect, useInsertionEffect, useRef, useCallback, useMemo, useSyncExternalStore, useDebugValue, createElement, Fragment };`;

const bundle = await build({
	stdin: {
		contents: `
			export { OPEN_SESSION_FLAG, OPEN_CATALOGUE_FLAG, readLaunchTarget, readOpenSessionArgv } from "./src/shared/open-session";
			export { mergePersistedSession, useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";
		`,
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
			name: "launch-session-fixture",
			setup(builder) {
				builder.onResolve({ filter: /local-operator\/desktop-api$/ }, () => ({
					path: "transport",
					namespace: "launch-fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "launch-fixture" }, () => ({
					// The same stand-in `reconnect-page-gap.test.mjs` uses, and
					// deliberately the whole surface rather than the three names this
					// file's entry point happens to need: the store's import graph
					// reaches the desktop transport through the session hook, and a
					// trimmed fixture fails at BUILD time the moment that graph grows
					// - a maintenance trap rather than a narrower test.
					contents: `
						export class DesktopControlError extends Error {}
						export class UserFacingError extends Error {}
						export const userFacingMessage = (error) => String(error?.message ?? error);
						export const desktopResult = (request) => globalThis.__launchRequest(request);
						export const subscribeDesktopStream = (args, onEvent) => globalThis.__launchSubscribe(args, onEvent);`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
				builder.onResolve({ filter: /^react$/ }, () => ({
					path: "react",
					namespace: "launch-react",
				}));
				builder.onLoad({ filter: /.*/, namespace: "launch-react" }, () => ({
					contents: reactStandIn,
					loader: "js",
				}));
			},
		},
	],
});
const module_ = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	OPEN_SESSION_FLAG,
	OPEN_CATALOGUE_FLAG,
	readLaunchTarget,
	readOpenSessionArgv,
	mergePersistedSession,
	useCanonicalSessionsStore,
} = module_;

/** The id shape the whole path validates on: 12 lowercase hex characters. */
const SESSION = "a1b2c3d4e5f6";
const OTHER = "0f0e0d0c0b0a";

/**
 * Stand in for the preload's two launch fields, as `window.api.desktop`.
 *
 * TWO fields and not one, because that is the fix: `initialSession: null` is
 * what an ordinary launch looks like, so the catalogue intent needs its own
 * field to travel in (review round 2, R2-1).
 */
function withLaunchArgument(value, run, { catalogue = false } = {}) {
	const previous = globalThis.window;
	globalThis.window = {
		api: { desktop: { initialSession: value, initialCatalogue: catalogue } },
	};
	try {
		return run();
	} finally {
		globalThis.window = previous;
	}
}

test("readOpenSessionArgv accepts both spellings, last wins, and validates the id", () => {
	// Both spellings are real: `--open-session <id>` is what the launcher writes
	// and `--open-session=<id>` is what a hand-typed command line produces, and
	// Electron's `second-instance` hands over whichever the shell received.
	assert.equal(
		readOpenSessionArgv([OPEN_SESSION_FLAG, SESSION]),
		SESSION,
		"the space-separated spelling",
	);
	assert.equal(
		readOpenSessionArgv([`${OPEN_SESSION_FLAG}=${SESSION}`]),
		SESSION,
		"the equals spelling",
	);
	// LAST wins: a second launch that names another conversation is the newer
	// request, and taking the first would reopen the stale one.
	assert.equal(
		readOpenSessionArgv([
			OPEN_SESSION_FLAG,
			OTHER,
			`${OPEN_SESSION_FLAG}=${SESSION}`,
		]),
		SESSION,
		"the last occurrence wins",
	);
	// The id shape is validated at BOTH ends of the path, so a malformed one
	// cannot reach `setActiveSession` or a navigation.
	for (const bad of [
		[OPEN_SESSION_FLAG, "not-a-session"],
		[OPEN_SESSION_FLAG, "A1B2C3D4E5F6"],
		[OPEN_SESSION_FLAG, "a1b2c3d4e5f"],
		[OPEN_SESSION_FLAG, "a1b2c3d4e5f6a"],
		[`${OPEN_SESSION_FLAG}=`],
	]) {
		assert.equal(readOpenSessionArgv(bad), null, JSON.stringify(bad));
	}
	// A trailing flag with no value is the argv a shell produces when the id is
	// lost, and it must read as "no launch conversation" rather than as the flag.
	assert.equal(readOpenSessionArgv([OPEN_SESSION_FLAG]), null);
	assert.equal(
		readOpenSessionArgv(["electron", ".", OPEN_SESSION_FLAG]),
		null,
		"a trailing flag with no value",
	);
	assert.equal(readOpenSessionArgv(["--other", SESSION]), null);
});

test("the launch argument outranks the persisted conversation in the merge", () => {
	// The half that makes the id true of the FIRST render: `persist` hydrates
	// after the store is created, and a merge that let the persisted value
	// through would put the wrong conversation back for exactly as long as the
	// renderer takes to correct itself - the flash B3 removes.
	const current = { ...useCanonicalSessionsStore.getState(), activeSessionId: null };
	const persisted = { activeSessionId: OTHER };
	assert.equal(
		withLaunchArgument(SESSION, () =>
			mergePersistedSession(persisted, { ...current, activeSessionId: null })
				.activeSessionId,
		),
		SESSION,
		"the launch id wins over the persisted one",
	);
	// With no launch argument the persisted conversation is the user's own last
	// position and stays untouched.
	assert.equal(
		withLaunchArgument(null, () =>
			mergePersistedSession(persisted, current).activeSessionId,
		),
		OTHER,
	);
	// Everything else hydration restores still comes from storage: the override
	// is one field, not a merge that discards the persisted state.
	const restored = withLaunchArgument(SESSION, () =>
		mergePersistedSession({ activeSessionId: OTHER, cwd: "/tmp/from-storage" }, {
			...current,
			cwd: "~",
		}),
	);
	assert.equal(restored.cwd, "/tmp/from-storage");
	assert.equal(restored.activeSessionId, SESSION);
});

test("a windowless import reads as no launch argument rather than throwing", () => {
	// The store is imported in contexts with no `window` (this harness, and any
	// node tooling that walks the renderer tree). `launchSession()` reads through
	// a guard for exactly that reason, and the honest answer there is "no launch
	// argument" - not an exception that would take the module down at import.
	assert.equal(globalThis.window, undefined);
	assert.equal(useCanonicalSessionsStore.getState().activeSessionId, null);
});


test("readLaunchTarget resolves three intents, with the named one outranking the catalogue", () => {
	// The bug this type exists to prevent was two intents sharing a VALUE, so the
	// three are asserted as three distinct answers rather than as truthiness.
	assert.deepEqual(readLaunchTarget(["electron", "."]), { kind: "restore" });
	assert.deepEqual(readLaunchTarget([OPEN_SESSION_FLAG, SESSION]), {
		kind: "session",
		sessionId: SESSION,
	});
	assert.deepEqual(readLaunchTarget([OPEN_CATALOGUE_FLAG]), { kind: "catalogue" });
	// Naming a conversation is the more specific instruction, so a launcher that
	// passes both lands on the conversation rather than on the list.
	assert.deepEqual(readLaunchTarget([OPEN_CATALOGUE_FLAG, OPEN_SESSION_FLAG, SESSION]), {
		kind: "session",
		sessionId: SESSION,
	});
	// A malformed id counts as ABSENT rather than as a session, and the catalogue
	// flag beside it is then the surviving instruction - a bad launch degrades to
	// the list rather than to a broken start.
	assert.deepEqual(readLaunchTarget([OPEN_CATALOGUE_FLAG, OPEN_SESSION_FLAG, "nope"]), {
		kind: "catalogue",
	});
});

test("a catalogue launch clears the persisted conversation instead of restoring it", () => {
	/*
	 * REVIEW ROUND 2, R2-1, as the reviewer reproduced it: `openSessionInWindow(null)`
	 * created a window with no argv flag, preload reported `initialSession: null`,
	 * and `mergePersistedSession` treated that as an ordinary launch and restored
	 * the persisted `activeSessionId` - so a burst digest's click reopened the last
	 * conversation instead of the catalogue the banner named.
	 *
	 * A persisted NON-NULL conversation is the whole point of the case: with
	 * nothing persisted there is no difference to observe, which is why the
	 * original notifier test (which stops at a mocked `reopen(null)`) could not
	 * detect it.
	 */
	const current = { ...useCanonicalSessionsStore.getState(), activeSessionId: null };
	const persisted = { activeSessionId: OTHER };
	assert.equal(
		withLaunchArgument(null, () => mergePersistedSession(persisted, current).activeSessionId, {
			catalogue: true,
		}),
		null,
		"the catalogue intent did not survive hydration",
	);
	// ...and it is still ONE field: the rest of the persisted state comes through.
	const restored = withLaunchArgument(
		null,
		() => mergePersistedSession({ activeSessionId: OTHER, cwd: "/tmp/from-storage" }, current),
		{ catalogue: true },
	);
	assert.equal(restored.cwd, "/tmp/from-storage");
	// The default that an ordinary launch keeps: no flag, no catalogue, persisted
	// conversation restored. Asserted beside the case above because the fix must
	// not have turned every windowless launch into a catalogue landing.
	assert.equal(
		withLaunchArgument(null, () => mergePersistedSession(persisted, current).activeSessionId),
		OTHER,
	);
	// A named conversation still outranks the persisted one, catalogue or not.
	assert.equal(
		withLaunchArgument(
			SESSION,
			() => mergePersistedSession(persisted, current).activeSessionId,
			{ catalogue: true },
		),
		SESSION,
	);
});

test("the initial render already reflects a catalogue launch", () => {
	// `persist` hydrates after the store is created, so the store's own initial
	// value is the first frame a recreated window paints. For a catalogue launch
	// that must be "no active session" rather than a stale persisted id.
	assert.equal(
		withLaunchArgument(null, () => useCanonicalSessionsStore.getState().activeSessionId, {
			catalogue: true,
		}),
		null,
	);
});
